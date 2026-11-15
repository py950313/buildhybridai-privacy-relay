import { useMemo, useRef, useState } from 'react';
import { ENTITY_TYPES, type EntityType } from '../detect/types';
import { spanKey } from '../relay/placeholders';
import { addManual, derive, setEntityMasked, toggleMention, type Draft } from '../relay/session';
import type { Entity } from '../detect/types';
import { TYPE_COLOR, TYPE_LABEL } from './types';

type Props = {
  draft: Draft;
  setDraft: (d: Draft) => void;
  table: Entity[];
  tierNote: string | null;
  online: boolean;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
};

export function Confirm({ draft, setDraft, table, tierNote, online, busy, onSend, onCancel }: Props) {
  const der = useMemo(() => derive(draft, table), [draft, table]);
  const excluded = useMemo(() => new Set(draft.excluded), [draft.excluded]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [markType, setMarkType] = useState<EntityType>('PERSON');
  const byId = new Map(der.table.map((e) => [e.id, e]));

  // Highlighted rendering of the original text.
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of der.mentions) {
    if (m.start > pos) parts.push(draft.text.slice(pos, m.start));
    const off = excluded.has(spanKey(m));
    const e = byId.get(m.entityId)!;
    parts.push(
      <mark
        key={spanKey(m)} className={off ? 'off' : ''} data-testid="mention"
        style={{ background: off ? 'transparent' : TYPE_COLOR[m.type], borderColor: TYPE_COLOR[m.type] }}
        title={`${e.placeholder} · ${TYPE_LABEL[m.type]} · ${m.source}${m.reason ? ` · ${m.reason}` : ''}\nClick to ${off ? 'mask' : 'keep in clear'}`}
        onClick={() => setDraft(toggleMention(draft, m))}
      >
        {draft.text.slice(m.start, m.end)}
        <sup>{e.placeholder}</sup>
      </mark>,
    );
    pos = m.end;
  }
  parts.push(draft.text.slice(pos));

  const markSelection = () => {
    const el = ta.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    setDraft(addManual(draft, el.selectionStart, el.selectionEnd, markType));
  };

  const maskedCount = der.mentions.filter((m) => !excluded.has(spanKey(m))).length;

  return (
    <section className="confirm" data-testid="confirm">
      <h2>Check what will be hidden</h2>
      <p className="muted">
        Highlighted items are replaced by placeholders before anything is sent. Click an item to keep it in clear.
        {tierNote && <> {tierNote}</>}
      </p>
      {draft.warnings.map((w) => <p key={w} className="notice">{w}</p>)}
      <div className="highlight" data-testid="highlight">{parts}</div>

      <details className="manual" open={der.mentions.length === 0}>
        <summary>Mark something the detector missed</summary>
        <textarea ref={ta} readOnly rows={5} value={draft.text} data-testid="mark-source" />
        <div className="row">
          <select value={markType} onChange={(e) => setMarkType(e.target.value as EntityType)} data-testid="mark-type">
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <button onClick={markSelection} data-testid="mark-button">Mark selection (all occurrences)</button>
        </div>
      </details>

      <table className="entities" data-testid="entities">
        <thead><tr><th>Placeholder</th><th>Type</th><th>Original</th><th>Times</th><th /></tr></thead>
        <tbody>
          {der.entities.map((e) => {
            const ms = der.mentions.filter((m) => m.entityId === e.id);
            const on = ms.some((m) => !excluded.has(spanKey(m)));
            const sameType = der.entities.filter((x) => x.type === e.type && x.id !== e.id);
            return (
              <tr key={e.id} className={on ? '' : 'off'}>
                <td><code>{e.placeholder}</code></td>
                <td><span className="chip" style={{ background: TYPE_COLOR[e.type] }}>{TYPE_LABEL[e.type]}</span></td>
                <td>
                  {e.variants.join(' / ')}
                  {e.variants.length > 1 && e.variants.map((v) => (
                    <button key={v} className="small" title="Treat this spelling as a different item"
                      onClick={() => setDraft({ ...draft, ops: [...draft.ops, { kind: 'split', from: e.id, variant: v }] })}>
                      split “{v}”
                    </button>
                  ))}
                </td>
                <td>{ms.length}</td>
                <td className="actions">
                  <button className="small" onClick={() => setDraft(setEntityMasked(draft, der, e.id, !on))}>
                    {on ? 'Keep in clear' : 'Mask'}
                  </button>
                  {sameType.length > 0 && (
                    <select className="small" value="" title="Same person or thing as…"
                      onChange={(ev) => ev.target.value && setDraft({ ...draft, ops: [...draft.ops, { kind: 'merge', keep: ev.target.value, drop: e.id }] })}>
                      <option value="">Same as…</option>
                      {sameType.map((x) => <option key={x.id} value={x.id}>{x.placeholder} {x.canonical}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {draft.unlocated.length > 0 && (
        <div className="unlocated" data-testid="unlocated">
          <h3>Suggested but not found in your text</h3>
          <p className="muted">The on-device model suggested these, but they do not appear word for word. If one is really there, select it above and mark it.</p>
          <ul>{draft.unlocated.map((u) => <li key={u.source + u.text}>{u.text} <span className="muted">({TYPE_LABEL[u.type]}, {u.source})</span></li>)}</ul>
        </div>
      )}

      <div className="row">
        <button onClick={onCancel}>Back</button>
        <button className="primary" disabled={busy || !online} onClick={onSend} data-testid="send">
          Send masked text ({maskedCount} hidden)
        </button>
        {!online && <span className="notice" data-testid="offline-msg">Offline: connect to send to the cloud.</span>}
      </div>
    </section>
  );
}
