import type { NanoState, Tier } from '../services/capabilities';

export type GlinerState = 'disabled' | 'needs-consent' | 'loading' | 'ready' | 'failed';

type Props = {
  tier: Tier;
  nano: NanoState;
  nanoProgress: number | null;
  onPrepareNano: () => void;
  gliner: GlinerState;
  glinerVariant: string | null;
  glinerSizeMB: number | null;
  glinerMsg: string;
  onDownloadGliner: () => void;
  online: boolean;
  onClear: () => void;
};

const TIER_TEXT: Record<Tier, string> = {
  full: 'Full: on-device AI + private detection',
  gliner: 'Private detection (no on-device AI here: everything is masked, then sent)',
  manual: 'Manual mode: pattern rules + your own marks',
};

export function StatusBar(p: Props) {
  return (
    <header className="status" data-testid="status">
      <span className={`tier tier-${p.tier}`} data-testid="tier">{TIER_TEXT[p.tier]}</span>
      <span className="cap">
        On-device AI:{' '}
        {p.nano === 'available' && 'ready'}
        {p.nano === 'absent' && 'not in this browser'}
        {p.nano === 'unavailable' && 'not supported on this device'}
        {(p.nano === 'downloadable' || p.nano === 'downloading') && (
          p.nanoProgress !== null
            ? `downloading ${Math.round(p.nanoProgress * 100)}%`
            : <button onClick={p.onPrepareNano}>Prepare on-device model</button>
        )}
      </span>
      <span className="cap">
        Detection model:{' '}
        {p.gliner === 'disabled' && 'off'}
        {p.gliner === 'ready' && `ready (${p.glinerVariant})`}
        {p.gliner === 'loading' && (p.glinerMsg || 'loading…')}
        {p.gliner === 'failed' && 'could not load: manual mode'}
        {p.gliner === 'needs-consent' && (
          <button onClick={p.onDownloadGliner} data-testid="gliner-download">
            Download ({p.glinerSizeMB ?? '…'} MB, once)
          </button>
        )}
      </span>
      <span className={`cap ${p.online ? '' : 'offline'}`}>{p.online ? 'Online' : 'Offline: cloud disabled'}</span>
      <button className="clear" onClick={p.onClear} data-testid="clear" title="Forget the text and the placeholder table">
        Clear
      </button>
    </header>
  );
}
