import type { Entity } from '../detect/types';
import type { Restored } from '../relay/placeholders';
import type { Route } from '../relay/router';
import { useT } from './i18n';

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
  receiptNote?: string; // English key, translated on render
  disclaimer?: string;
};

type Props = { turn: Turn; onUseCloud?: () => void };

export function TurnView({ turn, onUseCloud }: Props) {
  const t = useT();
  const out = turn.output;
  const note = turn.receiptNote ? t(turn.receiptNote) : '';
  return (
    <article className="turn" data-testid="turn" data-receipt={turn.receiptNote ? (turn.receiptNote.includes('not') ? 'failed' : 'saved') : 'pending'}>
      <div className="you"><strong>{t('You')}</strong><pre>{turn.input}</pre></div>
      <div className="ai">
        <strong>{t('AI')}</strong>{' '}
        <span className={`badge route-${turn.route}`}>{turn.route === 'local' ? t('On this device') : t('Cloud ({m})', { m: turn.provider })}</span>
        {turn.latencyMs !== undefined && <span className="muted"> {(turn.latencyMs / 1000).toFixed(1)} s</span>}
        {turn.error && <p className="error" data-testid="turn-error">{t(turn.error)}</p>}
        {turn.disclaimer && <p className="notice" data-testid="disclaimer">{turn.disclaimer}</p>}
        {out && 'local' in out && (
          <>
            <pre data-testid="answer">{out.local}</pre>
            <p className="muted">{t('Ran on this device. Nothing was sent.')} {note}</p>
            {onUseCloud && <button onClick={onUseCloud} data-testid="use-cloud">{t('Use the cloud instead (masks first)')}</button>}
          </>
        )}
        {out && 'segments' in out && (
          <>
            <pre data-testid="answer">
              {out.segments.map((s, i) =>
                s.kind === 'text' ? s.text
                  : s.kind === 'restored' ? <span key={i} className="restored" title={s.placeholder}>{s.text}</span>
                    : <mark key={i} className="invalid" data-testid="invalid" title={s.reason}>{s.text}</mark>,
              )}
            </pre>
            {out.invalid > 0 && <p className="notice">{t('{n} placeholder(s) came back changed and were not restored (shown in red).', { n: out.invalid })}</p>}
            {out.missing.length > 0 && <p className="muted" data-testid="missing">{t('Not used in the answer:')} {out.missing.join(', ')}</p>}
            <button className="small" onClick={() => navigator.clipboard?.writeText(out.text)}>{t('Copy answer')}</button>
          </>
        )}
        {turn.sent !== undefined && (
          <details className="receipt" data-testid="receipt">
            <summary>{t('Receipt: what left this device')}</summary>
            <h4>{t('Sent (exactly this)')}</h4>
            <pre data-testid="sent">{turn.sent}</pre>
            <h4>{t('Kept on this device')}</h4>
            <ul>{turn.kept?.map((e) => <li key={e.id}><code>{e.placeholder}</code> = {e.variants.join(' / ')}</li>)}</ul>
            <p className="muted">{t('The placeholder table exists only in this tab. Closing it or pressing Clear erases it.')}</p>
            {note && <p className="muted">{note}</p>}
          </details>
        )}
      </div>
    </article>
  );
}
