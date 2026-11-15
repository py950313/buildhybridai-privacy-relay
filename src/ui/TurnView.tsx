import type { Entity } from '../detect/types';
import type { Restored } from '../relay/placeholders';
import type { Route } from '../relay/router';

export type Turn = {
  id: number;
  route: Route;
  provider: string;
  input: string; // original, shown only on this device
  sent?: string; // masked text that left the device
  kept?: Entity[]; // entities hidden in this turn
  output?: Restored | { local: string };
  error?: string;
  latencyMs?: number;
  receiptNote?: string;
};

type Props = { turn: Turn; onUseCloud?: () => void };

export function TurnView({ turn, onUseCloud }: Props) {
  const out = turn.output;
  return (
    <article className="turn" data-testid="turn">
      <div className="you"><strong>You</strong><pre>{turn.input}</pre></div>
      <div className="ai">
        <strong>AI</strong> <span className={`badge route-${turn.route}`}>{turn.route === 'local' ? 'On this device' : `Cloud (${turn.provider})`}</span>
        {turn.latencyMs !== undefined && <span className="muted"> {(turn.latencyMs / 1000).toFixed(1)} s</span>}
        {turn.error && <p className="error" data-testid="turn-error">{turn.error}</p>}
        {out && 'local' in out && (
          <>
            <pre data-testid="answer">{out.local}</pre>
            <p className="muted">Ran on this device. Nothing was sent.{turn.receiptNote && ` ${turn.receiptNote}`}</p>
            {onUseCloud && <button onClick={onUseCloud} data-testid="use-cloud">Use the cloud instead (masks first)</button>}
          </>
        )}
        {out && 'segments' in out && (
          <>
            <pre data-testid="answer">
              {out.segments.map((s, i) =>
                s.kind === 'text' ? s.text
                  : s.kind === 'restored' ? <span key={i} className="restored" title={`Restored from ${s.placeholder}`}>{s.text}</span>
                    : <mark key={i} className="invalid" data-testid="invalid" title={s.reason === 'unknown' ? 'Unknown placeholder: not restored' : 'Placeholder was changed by the AI: not restored'}>{s.text}</mark>,
              )}
            </pre>
            {out.invalid > 0 && <p className="notice">{out.invalid} placeholder(s) came back changed and were not restored (shown in red).</p>}
            {out.missing.length > 0 && <p className="muted" data-testid="missing">Not used in the answer: {out.missing.join(', ')}</p>}
            <button className="small" onClick={() => navigator.clipboard?.writeText(out.text)}>Copy answer</button>
          </>
        )}
        {turn.sent !== undefined && (
          <details className="receipt" data-testid="receipt">
            <summary>Receipt: what left this device</summary>
            <h4>Sent (exactly this)</h4>
            <pre data-testid="sent">{turn.sent}</pre>
            <h4>Kept on this device</h4>
            <ul>{turn.kept?.map((e) => <li key={e.id}><code>{e.placeholder}</code> = {e.variants.join(' / ')}</li>)}</ul>
            <p className="muted">The placeholder table exists only in this tab. Closing it or pressing Clear erases it.</p>
            {turn.receiptNote && <p className="muted">{turn.receiptNote}</p>}
          </details>
        )}
      </div>
    </article>
  );
}
