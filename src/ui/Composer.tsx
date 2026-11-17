import type { ScenarioConfig, ScenarioId } from '../config/scenarios';
import { ACCEPT, type Extracted } from '../extract';
import type { OutLang, Route, RouteDecision, Task } from '../relay/router';
import type { ProviderId } from '../services/providers';
import { useT, type UiLang } from './i18n';

export type RouteChoice = 'auto' | Route;

type Props = {
  task: Task;
  setTask: (t: Task) => void;
  target: OutLang;
  setTarget: (t: OutLang) => void;
  instruction: string;
  setInstruction: (s: string) => void;
  content: string;
  setContent: (s: string) => void;
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  scenarios: Record<ScenarioId, ScenarioConfig>;
  decision: RouteDecision;
  choice: RouteChoice;
  setChoice: (c: RouteChoice) => void;
  localAllowed: boolean;
  online: boolean;
  busy: boolean;
  onSubmit: () => void;
  uiLang: UiLang;
  provider: ProviderId;
  setProvider: (p: ProviderId) => void;
  providerReady: Record<ProviderId, boolean>;
  onFile: (f: File) => void;
  fileBusy: string | null; // progress text while a file is being read
  fileInfo: Extracted | null;
  fileError: string;
};

const TASKS: [Task, string][] = [
  ['rewrite', 'Rewrite'], ['shorten', 'Shorten'], ['translate', 'Translate'], ['summarize', 'Summarize'],
  ['analyze', 'Analyze / explain'], ['custom', 'Custom instruction'],
];
const SCENARIOS: [ScenarioId, string][] = [
  ['email', 'Work email or document'], ['contract', 'Contract'], ['health', 'Health report'], ['free', 'Other'],
];

export function Composer(p: Props) {
  const t = useT();
  const cfg = p.scenarios[p.scenario];
  const effective = cfg.forceCloud ? 'cloud' : p.choice === 'auto' ? p.decision.route : p.choice;
  const blocked = effective === 'cloud' && !p.online && p.provider !== 'copy';
  const empty = !p.content.trim() && !(p.task === 'custom' && p.instruction.trim());
  return (
    <section className="composer">
      <div className="row">
        <label>
          {t('Scenario')}{' '}
          <select value={p.scenario} onChange={(e) => p.setScenario(e.target.value as ScenarioId)} data-testid="scenario">
            {SCENARIOS.filter(([id]) => p.scenarios[id].enabled).map(([id, l]) => <option key={id} value={id}>{t(l)}</option>)}
          </select>
        </label>
        <label>
          {t('Task')}{' '}
          <select value={p.task} onChange={(e) => p.setTask(e.target.value as Task)} data-testid="task">
            {TASKS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
        </label>
        {p.task === 'translate' && (
          <label>
            {t('Into')}{' '}
            <select value={p.target} onChange={(e) => p.setTarget(e.target.value as OutLang)}>
              <option value="en">{t('English')}</option>
              <option value="zh">{t('Traditional Chinese')}</option>
              <option value="ja">{t('Japanese')}</option>
              <option value="es">{t('Spanish')}</option>
            </select>
          </label>
        )}
      </div>
      {cfg.disclaimer && <p className="notice" data-testid="disclaimer">{cfg.disclaimer[p.uiLang]}</p>}
      {p.task === 'custom' && (
        <textarea
          className="instruction" rows={2} value={p.instruction} data-testid="instruction"
          placeholder={t('What should the AI do? (this is checked for private details too)')}
          onChange={(e) => p.setInstruction(e.target.value)}
        />
      )}
      <textarea
        rows={10} value={p.content} data-testid="content"
        placeholder={t('Paste the email, document or report here.')}
        onChange={(e) => p.setContent(e.target.value)}
      />
      <div className="row">
        <label className="filepick">
          <input
            type="file" accept={ACCEPT} data-testid="file-input" disabled={p.fileBusy !== null || p.busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onFile(f); }}
          />
          <span>{t('Add an image or PDF (read on this device)')}</span>
        </label>
        {p.fileBusy !== null && <span className="muted" data-testid="file-busy">{p.fileBusy}</span>}
      </div>
      {p.fileError && <p className="error" data-testid="file-error">{t(p.fileError)}</p>}
      {p.fileInfo && (
        <p className="notice" data-testid="file-note" data-pages={p.fileInfo.pages} data-ocr={p.fileInfo.ocrPages} data-engine={p.fileInfo.engine ?? ''} data-confidence={p.fileInfo.confidence ?? ''}>
          {t('Text read from {name} on this device ({pages} page(s), {ocr} by OCR). The file itself is never uploaded.',
            { name: p.fileInfo.name, pages: p.fileInfo.pages, ocr: p.fileInfo.ocrPages })}
          {p.fileInfo.ocrPages > 0 && <> {t('Check the text above: misread characters can hide private details from detection.')}</>}
          {p.fileInfo.truncated && <> {t('Only the first 30 pages were read.')}</>}
        </p>
      )}
      <div className="row route">
        <span className={`badge route-${effective}`} data-testid="route" data-route={effective}>
          {t(effective === 'local' ? 'On this device' : 'Masked, then cloud')}
        </span>
        <span className="muted">
          {cfg.forceCloud ? t('This scenario always masks the text and uses the cloud model.')
            : p.choice === 'auto' ? t(p.decision.reason) : t('Chosen by you')}
        </span>
        {!cfg.forceCloud && (
          <select value={p.choice} onChange={(e) => p.setChoice(e.target.value as RouteChoice)} data-testid="route-choice">
            <option value="auto">{t('Auto')}</option>
            <option value="local" disabled={!p.localAllowed}>{t('On this device')}</option>
            <option value="cloud">{t('Cloud (masked)')}</option>
          </select>
        )}
        {effective === 'cloud' && (
          <select value={p.provider} onChange={(e) => p.setProvider(e.target.value as ProviderId)} data-testid="provider" aria-label={t('Cloud AI')}>
            <option value="gemini">Gemini</option>
            <option value="anthropic" disabled={!p.providerReady.anthropic}>Claude ({t('your key')})</option>
            <option value="xai" disabled={!p.providerReady.xai}>Grok ({t('your key')})</option>
            <option value="copy">{t('Copy and paste to any AI')}</option>
          </select>
        )}
        <button className="primary" disabled={p.busy || empty || blocked} onClick={p.onSubmit} data-testid="submit">
          {t(effective === 'local' ? 'Run on this device' : 'Find private details')}
        </button>
      </div>
      {blocked && <p className="notice" data-testid="offline-msg">{t('You are offline. On-device tasks still work; cloud tasks need a connection.')}</p>}
    </section>
  );
}
