import type { Scenario } from '../services/receipts';
import type { OutLang, Route, RouteDecision, Task } from '../relay/router';

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
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  decision: RouteDecision;
  choice: RouteChoice;
  setChoice: (c: RouteChoice) => void;
  localAllowed: boolean;
  online: boolean;
  busy: boolean;
  onSubmit: () => void;
};

const TASKS: [Task, string][] = [
  ['rewrite', 'Rewrite'], ['shorten', 'Shorten'], ['translate', 'Translate'], ['summarize', 'Summarize'],
  ['analyze', 'Analyze / explain'], ['custom', 'Custom instruction'],
];

export function Composer(p: Props) {
  const effective = p.choice === 'auto' ? p.decision.route : p.choice;
  const blocked = effective === 'cloud' && !p.online;
  const empty = !p.content.trim() && !(p.task === 'custom' && p.instruction.trim());
  return (
    <section className="composer">
      <div className="row">
        <label>
          Scenario{' '}
          <select value={p.scenario} onChange={(e) => p.setScenario(e.target.value as Scenario)} data-testid="scenario">
            <option value="email">Work email or document</option>
            <option value="contract">Contract</option>
            <option value="health">Health report</option>
            <option value="free">Other</option>
          </select>
        </label>
        <label>
          Task{' '}
          <select value={p.task} onChange={(e) => p.setTask(e.target.value as Task)} data-testid="task">
            {TASKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {p.task === 'translate' && (
          <label>
            Into{' '}
            <select value={p.target} onChange={(e) => p.setTarget(e.target.value as OutLang)}>
              <option value="en">English</option>
              <option value="zh">Traditional Chinese</option>
              <option value="ja">Japanese</option>
              <option value="es">Spanish</option>
            </select>
          </label>
        )}
      </div>
      {p.task === 'custom' && (
        <textarea
          className="instruction" rows={2} value={p.instruction} data-testid="instruction"
          placeholder="What should the AI do? (this is checked for private details too)"
          onChange={(e) => p.setInstruction(e.target.value)}
        />
      )}
      <textarea
        rows={10} value={p.content} data-testid="content"
        placeholder="Paste the email, document or report here."
        onChange={(e) => p.setContent(e.target.value)}
      />
      <div className="row route">
        <span className={`badge route-${effective}`} data-testid="route">
          {effective === 'local' ? 'On this device' : 'Masked, then cloud'}
        </span>
        <span className="muted">{p.choice === 'auto' ? p.decision.reason : 'Chosen by you'}</span>
        <select value={p.choice} onChange={(e) => p.setChoice(e.target.value as RouteChoice)} data-testid="route-choice">
          <option value="auto">Auto</option>
          <option value="local" disabled={!p.localAllowed}>On this device</option>
          <option value="cloud">Cloud (masked)</option>
        </select>
        <button className="primary" disabled={p.busy || empty || blocked} onClick={p.onSubmit} data-testid="submit">
          {effective === 'local' ? 'Run on this device' : 'Find private details'}
        </button>
      </div>
      {blocked && <p className="notice" data-testid="offline-msg">You are offline. On-device tasks still work; cloud tasks need a connection.</p>}
    </section>
  );
}
