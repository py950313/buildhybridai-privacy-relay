import type { ChatSession } from 'firebase/ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { PRODUCT_NAME } from './config/product';
import { estimateTokens } from './detect/chunk';
import { detect } from './detect/engine';
import { guessLang } from './detect/nano';
import type { Entity } from './detect/types';
import { placeholdersIn, restore } from './relay/placeholders';
import { buildPrompt, joinCustom } from './relay/prompts';
import { decideRoute, outputLang, type OutLang, type Route, type Task } from './relay/router';
import { countByType, draftFrom, prepareOutgoing, type Draft } from './relay/session';
import { classifyTask, prepareDeviceModel, runLocal, sendCloud, startCloudChat } from './services/ai';
import {
  detectionLayers, GLINER_SIZE_MB, glinerDisabled, glinerLayer, hasGlinerConsent, pickVariant, probeNano,
  setGlinerConsent, tierOf, type NanoState,
} from './services/capabilities';
import { DEFAULT_CONFIG, loadConfig, type AppConfig } from './services/config';
import { saveReceipt, type ReceiptStats, type Scenario } from './services/receipts';
import { Composer, type RouteChoice } from './ui/Composer';
import { Confirm } from './ui/Confirm';
import { StatusBar, type GlinerState } from './ui/StatusBar';
import { TurnView, type Turn } from './ui/TurnView';

type Pending = { kind: 'first' | 'followup'; task: Task; target: OutLang; body: string };
type Phase = 'idle' | 'running' | 'detecting' | 'confirm' | 'sending';

function describeError(e: unknown): string {
  if (!navigator.onLine) return 'You are offline. Nothing was sent.';
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|timed out|abort/i.test(msg)) return 'The cloud model did not answer within 60 seconds. Try again.';
  return `The request failed: ${msg.slice(0, 200)}`;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [nano, setNano] = useState<NanoState>('absent');
  const [nanoProgress, setNanoProgress] = useState<number | null>(null);
  const [gliner, setGliner] = useState<GlinerState>(glinerDisabled() ? 'disabled' : 'needs-consent');
  const [glinerVariant, setGlinerVariant] = useState<string | null>(null);
  const [glinerSize, setGlinerSize] = useState<number | null>(null);
  const [glinerMsg, setGlinerMsg] = useState('');
  const [online, setOnline] = useState(navigator.onLine);

  const [scenario, setScenario] = useState<Scenario>('email');
  const [task, setTask] = useState<Task>('rewrite');
  const [target, setTarget] = useState<OutLang>('en');
  const [instruction, setInstruction] = useState('');
  const [content, setContent] = useState('');
  const [choice, setChoice] = useState<RouteChoice>('auto');

  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [table, setTable] = useState<Entity[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [followup, setFollowup] = useState('');
  const [error, setError] = useState('');
  const chat = useRef<ChatSession | null>(null);
  const turnId = useRef(0);

  const nanoReady = nano === 'available';
  const glinerReady = gliner === 'ready';
  const tier = tierOf(glinerReady, nanoReady);

  const startGliner = () => {
    setGlinerConsent();
    setGliner('loading');
    const layer = glinerLayer(setGlinerMsg);
    layer.init().then(
      () => { setGliner('ready'); setGlinerVariant(layer.variantName); },
      () => setGliner('failed'),
    );
  };

  useEffect(() => {
    loadConfig().then(setConfig);
    probeNano().then(setNano);
    if (!glinerDisabled()) {
      pickVariant().then((v) => setGlinerSize(GLINER_SIZE_MB[v.name]));
      if (hasGlinerConsent()) startGliner();
    }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  const body = task === 'custom' ? joinCustom(instruction, content) : content;
  const lang = guessLang(body);
  const routeInput = { tokens: estimateTokens(body), lang, nanoReady, maxTokens: config.localRouteMaxTokens, translateTarget: target };
  const decision = useMemo(() => {
    if (task === 'custom' && nanoReady) {
      return { route: 'local' as Route, reason: 'Custom instruction: classified on this device when you run it' };
    }
    return decideRoute({ ...routeInput, task: task === 'custom' ? 'analyze' : task });
  }, [task, nanoReady, routeInput.tokens, lang, target, config.localRouteMaxTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTurn = (t: Omit<Turn, 'id'>) => {
    const id = ++turnId.current;
    setTurns((ts) => [...ts, { ...t, id }]);
    return id;
  };
  const record = (id: number, stats: ReceiptStats) => {
    saveReceipt(stats).then(
      () => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, receiptNote: 'Statistics saved (counts only, no text).' } : t))),
      () => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, receiptNote: 'Statistics were not saved.' } : t))),
    );
  };

  async function runLocalTurn() {
    setPhase('running');
    const t0 = performance.now();
    try {
      const out = await runLocal(buildPrompt(task, body, target), lang, outputLang(task, lang, target));
      const latencyMs = performance.now() - t0;
      const id = addTurn({ route: 'local', provider: 'Gemini Nano', input: body, output: { local: out }, latencyMs });
      record(id, { scenario, route: 'local', provider: 'gemini', maskedCounts: {}, inputChars: body.length, latencyMs });
    } catch (e) {
      addTurn({ route: 'local', provider: 'Gemini Nano', input: body, error: `On-device model failed: ${e instanceof Error ? e.message : e}` });
    }
    setPhase('idle');
  }

  async function startDetection(p: Pending) {
    setError('');
    setPhase('detecting');
    try {
      const layers = detectionLayers({ glinerReady, nanoReady, zh: config.nanoZhDetection });
      const r = await detect(p.body, { layers, chunkTokens: config.detectChunkTokens, overlapTokens: config.detectOverlapTokens });
      setDraft(draftFrom(r));
      setPending(p);
      setPhase('confirm');
    } catch (e) {
      setError(`Detection failed: ${e instanceof Error ? e.message : e}`);
      setPhase('idle');
    }
  }

  async function submit() {
    setError('');
    let route = choice === 'auto' ? decision.route : choice;
    if (task === 'custom' && choice === 'auto' && nanoReady) {
      setPhase('running');
      route = decideRoute({ ...routeInput, task: await classifyTask(instruction) }).route;
    }
    if (route === 'local') return runLocalTurn();
    if (!online) {
      setPhase('idle');
      setError('You are offline. Cloud tasks need a connection.');
      return;
    }
    await startDetection({ kind: 'first', task, target, body });
  }

  async function send() {
    if (!draft || !pending) return;
    if (!navigator.onLine) {
      setError('You are offline. Nothing was sent.');
      return;
    }
    let out;
    try {
      out = prepareOutgoing(draft, table, (b) => (pending.kind === 'first' ? buildPrompt(pending.task, b, pending.target) : b));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setPhase('sending');
    const sentPlaceholders = placeholdersIn(out.masked, out.table);
    const kept = out.table.filter((e) => sentPlaceholders.includes(e.placeholder));
    const model = scenario === 'contract' || scenario === 'health' ? config.cloudModelComplex : config.cloudModelDefault;
    const t0 = performance.now();
    setTable(out.table);
    try {
      chat.current ??= startCloudChat(model);
      const resp = await sendCloud(chat.current, out.masked);
      const latencyMs = performance.now() - t0;
      const id = addTurn({ route: 'cloud', provider: model, input: pending.body, sent: out.masked, kept, latencyMs,
        output: restore(resp, out.table, sentPlaceholders) });
      record(id, { scenario, route: 'cloud', provider: 'gemini', maskedCounts: countByType(out.mentions), inputChars: pending.body.length, latencyMs });
    } catch (e) {
      addTurn({ route: 'cloud', provider: model, input: pending.body, sent: out.masked, kept, error: describeError(e) });
    }
    setDraft(null);
    setPending(null);
    setFollowup('');
    setPhase('idle');
  }

  function clearAll() {
    chat.current = null;
    setTable([]);
    setTurns([]);
    setDraft(null);
    setPending(null);
    setContent('');
    setInstruction('');
    setFollowup('');
    setError('');
    setPhase('idle');
  }

  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const lastCloud = last?.route === 'cloud' && !last.error;

  return (
    <div className="app">
      <StatusBar
        tier={tier} nano={nano} nanoProgress={nanoProgress}
        onPrepareNano={() => {
          setNanoProgress(0);
          prepareDeviceModel(setNanoProgress).then(
            async () => { setNanoProgress(null); setNano(await probeNano()); },
            (e) => { setNanoProgress(null); setError(`On-device model could not be prepared: ${e?.message ?? e}`); },
          );
        }}
        gliner={gliner} glinerVariant={glinerVariant} glinerSizeMB={glinerSize} glinerMsg={glinerMsg} onDownloadGliner={startGliner}
        online={online} onClear={clearAll}
      />
      <main>
        <h1>{PRODUCT_NAME}</h1>
        <p className="muted">Use AI on private text. Short tasks run on this device; everything else is masked here first and restored here after.</p>
        {error && <p className="error" data-testid="error">{error}</p>}

        {turns.length === 0 && phase !== 'confirm' && (
          <Composer
            task={task} setTask={setTask} target={target} setTarget={setTarget}
            instruction={instruction} setInstruction={setInstruction} content={content} setContent={setContent}
            scenario={scenario} setScenario={setScenario} decision={decision} choice={choice} setChoice={setChoice}
            localAllowed={nanoReady} online={online} busy={phase !== 'idle'} onSubmit={submit}
          />
        )}

        {turns.map((t) => (
          <TurnView key={t.id} turn={t}
            onUseCloud={t.route === 'local' && t === last && phase === 'idle'
              ? () => startDetection({ kind: 'first', task, target, body: t.input }) : undefined} />
        ))}

        {phase === 'detecting' && <p className="muted" data-testid="detecting">Looking for private details on this device…</p>}
        {phase === 'running' && <p className="muted">Working on this device…</p>}
        {phase === 'sending' && <p className="muted" data-testid="sending">Sending masked text…</p>}

        {phase === 'confirm' && draft && (
          <Confirm
            draft={draft} setDraft={setDraft} table={pending?.kind === 'followup' ? table : []}
            tierNote={tier === 'manual' ? 'Manual mode: only fixed formats (IDs, phones, emails, cards, addresses) are found automatically; mark names yourself.' : null}
            online={online} busy={false} onSend={send}
            onCancel={() => { setDraft(null); setPhase('idle'); }}
          />
        )}

        {lastCloud && phase === 'idle' && (
          <section className="followup">
            <textarea rows={3} value={followup} onChange={(e) => setFollowup(e.target.value)} data-testid="followup"
              placeholder="Ask a follow-up (checked and masked the same way)" />
            <div className="row">
              <button className="primary" disabled={!followup.trim() || !online} data-testid="followup-submit"
                onClick={() => startDetection({ kind: 'followup', task: 'custom', target, body: followup })}>
                Find private details
              </button>
              <button onClick={clearAll}>New task</button>
            </div>
          </section>
        )}
        {turns.length > 0 && !lastCloud && phase === 'idle' && <button onClick={clearAll} data-testid="new-task">New task</button>}
      </main>
    </div>
  );
}
