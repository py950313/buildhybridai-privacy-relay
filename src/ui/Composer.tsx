import type { ScenarioConfig, ScenarioId } from '../config/scenarios';
import type { OutLang, Route, RouteDecision, Task } from '../relay/router';
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
  const blocked = effective === 'cloud' && !p.online;
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
        <button className="primary" disabled={p.busy || empty || blocked} onClick={p.onSubmit} data-testid="submit">
          {t(effective === 'local' ? 'Run on this device' : 'Find private details')}
        </button>
      </div>
      {blocked && <p className="notice" data-testid="offline-msg">{t('You are offline. On-device tasks still work; cloud tasks need a connection.')}</p>}
    </section>
  );
}
