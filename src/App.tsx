import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { PRODUCT_NAME } from './config/product';
import type { ScenarioId } from './config/scenarios';
import { estimateTokens } from './detect/chunk';
import { detect } from './detect/engine';
import { guessLang } from './detect/nano';
import { ExtractError, extractFile, type Extracted } from './extract';
import type { Entity } from './detect/types';
import { placeholdersIn, restore } from './relay/placeholders';
import { buildPrompt, joinCustom } from './relay/prompts';
import { decideRoute, outputLang, type OutLang, type Route, type Task } from './relay/router';
import { countByType, draftFrom, prepareOutgoing, type Draft } from './relay/session';
import { classifyTask, prepareDeviceModel, runLocal } from './services/ai';
import { loadModels, vault, vaultState, type VaultState } from './services/keys';
import { anthropicChat, geminiChat, ProviderError, xaiChat, type CloudChat, type ProviderId } from './services/providers';
import {
  detectionLayers, GLINER_SIZE_MB, glinerDisabled, glinerLayer, hasGlinerConsent, pickVariant, probeNano,
  setGlinerConsent, tierOf, type NanoState,
} from './services/capabilities';
import { DEFAULT_CONFIG, loadConfig, type AppConfig } from './services/config';
import { saveReceipt, type ReceiptStats } from './services/receipts';
import { Composer, type RouteChoice } from './ui/Composer';
import { Confirm } from './ui/Confirm';
import { KeysPanel } from './ui/KeysPanel';
import { LangContext, translate, type UiLang } from './ui/i18n';
import { StatusBar, type GlinerState } from './ui/StatusBar';
import { TurnView, type Turn } from './ui/TurnView';

type Pending = { kind: 'first' | 'followup'; task: Task; target: OutLang; body: string };
type Phase = 'idle' | 'running' | 'detecting' | 'confirm' | 'sending';

function describeError(e: unknown): string {
  if (e instanceof ProviderError) return e.message;
  if (!navigator.onLine) return 'You are offline. Nothing was sent.';
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|timed out|abort/i.test(msg)) return 'The cloud model did not answer within 60 seconds. Try again.';
  return `The request failed: ${msg.slice(0, 200)}`;
}

function initialLang(): UiLang {
  try {
    return localStorage.getItem('ui-lang') === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
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

  const [uiLang, setUiLangState] = useState<UiLang>(initialLang);
  const t = (s: string, v?: Record<string, string | number>) => translate(uiLang, s, v);
  const setUiLang = (l: UiLang) => {
    setUiLangState(l);
    try { localStorage.setItem('ui-lang', l); } catch { /* private mode */ }
  };
  const [scenario, setScenarioState] = useState<ScenarioId>('email');
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
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<Extracted | null>(null);
  const [fileError, setFileError] = useState('');
  const chat = useRef<CloudChat | null>(null);
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [keys, setKeys] = useState<VaultState>({ exists: false, unlocked: false, anthropic: false, xai: false });
  const refreshKeys = () => { vaultState().then(setKeys); };
  const turnId = useRef(0);

  const cfg = config.scenarios[scenario];
  const setScenario = (s: ScenarioId) => {
    setScenarioState(s);
    setTask(config.scenarios[s].defaultTask);
    setChoice('auto');
  };
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
    refreshKeys();
    vault.onLock = refreshKeys;
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

  // A provider whose key is no longer available (vault locked) falls back to Gemini.
  const providerReady: Record<ProviderId, boolean> = { gemini: true, copy: true, anthropic: keys.anthropic, xai: keys.xai };
  const activeProvider: ProviderId = providerReady[provider] ? provider : 'gemini';

  function openChat(): CloudChat {
    const models = loadModels();
    if (activeProvider === 'anthropic') {
      const key = vault.get('anthropic');
      if (!key) throw new ProviderError('Your keys are locked. Unlock them and try again.');
      return anthropicChat(key, models.anthropic);
    }
    if (activeProvider === 'xai') {
      const key = vault.get('xai');
      if (!key) throw new ProviderError('Your keys are locked. Unlock them and try again.');
      return xaiChat(key, models.xai);
    }
    return geminiChat(cfg.model === 'complex' ? config.cloudModelComplex : config.cloudModelDefault);
  }

  const body = task === 'custom' ? joinCustom(instruction, content) : content;
  const lang = guessLang(body);
  const routeInput = { tokens: estimateTokens(body), lang, nanoReady, maxTokens: config.localRouteMaxTokens, translateTarget: target };
  const decision = useMemo(() => {
    if (cfg.forceCloud) return { route: 'cloud' as Route, reason: 'This scenario always masks the text and uses the cloud model.' };
    if (task === 'custom' && nanoReady) {
      return { route: 'local' as Route, reason: 'Custom instruction: classified on this device when you run it' };
    }
    return decideRoute({ ...routeInput, task: task === 'custom' ? 'analyze' : task });
  }, [task, nanoReady, routeInput.tokens, lang, target, config.localRouteMaxTokens, cfg.forceCloud]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // The file stays in memory: only the text read from it goes into the box (and on to detection).
  async function handleFile(file: File) {
    setFileError('');
    setFileInfo(null);
    setFileBusy(t('Reading file on this device…'));
    try {
      const r = await extractFile(file, {
        useNano: nanoReady,
        onProgress: (n, total) => setFileBusy(t('Reading page {n} of {total}…', { n, total })),
      });
      setContent((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${r.text}` : r.text));
      setFileInfo(r);
    } catch (e) {
      setFileError(e instanceof ExtractError ? e.message : 'The file could not be read.');
    }
    setFileBusy(null);
  }

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
      const layers = detectionLayers({ glinerReady, nanoReady, zh: config.nanoZhDetection, focus: cfg.extraTypes });
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
    let route = cfg.forceCloud ? 'cloud' : choice === 'auto' ? decision.route : choice;
    if (!cfg.forceCloud && task === 'custom' && choice === 'auto' && nanoReady) {
      setPhase('running');
      route = decideRoute({ ...routeInput, task: await classifyTask(instruction) }).route;
    }
    if (route === 'local') return runLocalTurn();
    if (!online && activeProvider !== 'copy') {
      setPhase('idle');
      setError('You are offline. Cloud tasks need a connection.');
      return;
    }
    await startDetection({ kind: 'first', task, target, body });
  }

  async function send() {
    if (!draft || !pending) return;
    const copyMode = (chat.current?.provider ?? activeProvider) === 'copy' || (turns.length > 0 && turns[turns.length - 1].provider === 'copy');
    if (!copyMode && !navigator.onLine) {
      setError('You are offline. Nothing was sent.');
      return;
    }
    let out;
    try {
      out = prepareOutgoing(draft, table, (b) => (pending.kind === 'first' ? buildPrompt(pending.task, b, pending.target, cfg.analyzeInstruction) : b));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setPhase('sending');
    const sentPlaceholders = placeholdersIn(out.masked, out.table);
    const kept = out.table.filter((e) => sentPlaceholders.includes(e.placeholder));
    const disclaimer = cfg.disclaimer?.[uiLang];
    const t0 = performance.now();
    setTable(out.table);
    if (copyMode) {
      // Nothing is sent: the user carries the masked text to another AI and pastes the reply back.
      const id = addTurn({ route: 'cloud', provider: 'copy', input: pending.body, sent: out.masked, kept, disclaimer,
        awaitingPaste: { table: out.table, placeholders: sentPlaceholders } });
      record(id, { scenario, route: 'cloud', provider: 'copy', maskedCounts: countByType(out.mentions), inputChars: pending.body.length, latencyMs: 0 });
    } else {
      let label = activeProvider as string;
      try {
        chat.current ??= openChat();
        label = chat.current.model;
        const resp = await chat.current.send(out.masked);
        const latencyMs = performance.now() - t0;
        const id = addTurn({ route: 'cloud', provider: label, input: pending.body, sent: out.masked, kept, latencyMs, disclaimer,
          output: restore(resp, out.table, sentPlaceholders) });
        record(id, { scenario, route: 'cloud', provider: chat.current.provider, maskedCounts: countByType(out.mentions), inputChars: pending.body.length, latencyMs });
      } catch (e) {
        addTurn({ route: 'cloud', provider: label, input: pending.body, sent: out.masked, kept, error: describeError(e) });
      }
    }
    setDraft(null);
    setPending(null);
    setFollowup('');
    setPhase('idle');
  }

  function handlePaste(id: number, reply: string) {
    setTurns((ts) => ts.map((x) => (x.id === id && x.awaitingPaste
      ? { ...x, awaitingPaste: undefined, output: restore(reply, x.awaitingPaste.table, x.awaitingPaste.placeholders) }
      : x)));
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
    setFileInfo(null);
    setFileError('');
    setPhase('idle');
  }

  const last = turns.length > 0 ? turns[turns.length - 1] : null;
  const lastCloud = last?.route === 'cloud' && !last.error && !last.awaitingPaste;
  const copySession = last?.provider === 'copy';

  return (
    <LangContext.Provider value={uiLang}>
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
        online={online} onClear={clearAll} uiLang={uiLang} setUiLang={setUiLang}
      />
      <main>
        <h1>{PRODUCT_NAME}</h1>
        <p className="muted">{t('Use AI on private text. Short tasks run on this device; everything else is masked here first and restored here after.')}</p>
        {error && <p className="error" data-testid="error">{t(error)}</p>}

        {turns.length === 0 && phase !== 'confirm' && (
          <Composer
            task={task} setTask={setTask} target={target} setTarget={setTarget}
            instruction={instruction} setInstruction={setInstruction} content={content} setContent={setContent}
            scenario={scenario} setScenario={setScenario} scenarios={config.scenarios} uiLang={uiLang} decision={decision} choice={choice} setChoice={setChoice}
            localAllowed={nanoReady} online={online} busy={phase !== 'idle' || fileBusy !== null} onSubmit={submit}
            provider={activeProvider} setProvider={setProvider} providerReady={providerReady}
            onFile={handleFile} fileBusy={fileBusy} fileInfo={fileInfo} fileError={fileError}
          />
        )}

        {turns.length === 0 && phase !== 'confirm' && <KeysPanel state={keys} onChange={refreshKeys} />}

        {turns.map((t) => (
          <TurnView key={t.id} turn={t} onPaste={(reply) => handlePaste(t.id, reply)}
            onUseCloud={t.route === 'local' && t === last && phase === 'idle'
              ? () => startDetection({ kind: 'first', task, target, body: t.input }) : undefined} />
        ))}

        {phase === 'detecting' && <p className="muted" data-testid="detecting">{t('Looking for private details on this device…')}</p>}
        {phase === 'running' && <p className="muted">{t('Working on this device…')}</p>}
        {phase === 'sending' && <p className="muted" data-testid="sending">{t('Sending masked text…')}</p>}

        {phase === 'confirm' && draft && (
          <Confirm
            draft={draft} setDraft={setDraft} table={pending?.kind === 'followup' ? table : []}
            manualMode={tier === 'manual'} copyMode={pending?.kind === 'followup' ? copySession : activeProvider === 'copy'}
            online={online} busy={false} onSend={send}
            onCancel={() => { setDraft(null); setPhase('idle'); }}
          />
        )}

        {lastCloud && phase === 'idle' && (
          <section className="followup">
            <textarea rows={3} value={followup} onChange={(e) => setFollowup(e.target.value)} data-testid="followup"
              placeholder={t('Ask a follow-up (checked and masked the same way)')} />
            <div className="row">
              <button className="primary" disabled={!followup.trim() || (!online && !copySession)} data-testid="followup-submit"
                onClick={() => startDetection({ kind: 'followup', task: 'custom', target, body: followup })}>
                {t('Find private details')}
              </button>
              <button onClick={clearAll}>{t('New task')}</button>
            </div>
          </section>
        )}
        {turns.length > 0 && !lastCloud && phase === 'idle' && <button onClick={clearAll} data-testid="new-task">{t('New task')}</button>}
      </main>
    </div>
    </LangContext.Provider>
  );
}
