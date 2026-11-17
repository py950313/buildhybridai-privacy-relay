import type { NanoState, Tier } from '../services/capabilities';
import { useT, type UiLang } from './i18n';

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
  uiLang: UiLang;
  setUiLang: (l: UiLang) => void;
};

const TIER_TEXT: Record<Tier, string> = {
  full: 'Full: on-device AI + private detection',
  gliner: 'Private detection (no on-device AI here: everything is masked, then sent)',
  manual: 'Manual mode: pattern rules + your own marks',
};

export function StatusBar(p: Props) {
  const t = useT();
  return (
    <header className="status" data-testid="status">
      <span className={`tier tier-${p.tier}`} data-testid="tier" data-tier={p.tier}>{t(TIER_TEXT[p.tier])}</span>
      <span className="cap" data-testid="nano-state" data-state={p.nano}>
        {t('On-device AI:')}{' '}
        {p.nano === 'available' && t('ready')}
        {p.nano === 'absent' && t('not in this browser')}
        {p.nano === 'unavailable' && t('not supported on this device')}
        {(p.nano === 'downloadable' || p.nano === 'downloading') && (
          p.nanoProgress !== null
            ? t('downloading {p}%', { p: Math.round(p.nanoProgress * 100) })
            : <button onClick={p.onPrepareNano}>{t('Prepare on-device model')}</button>
        )}
      </span>
      <span className="cap" data-testid="gliner-state" data-state={p.gliner}>
        {t('Detection model:')}{' '}
        {p.gliner === 'disabled' && t('off')}
        {p.gliner === 'ready' && t('ready ({v})', { v: p.glinerVariant ?? '' })}
        {p.gliner === 'loading' && (p.glinerMsg || t('loading…'))}
        {p.gliner === 'failed' && t('could not load: manual mode')}
        {p.gliner === 'needs-consent' && (
          <button onClick={p.onDownloadGliner} data-testid="gliner-download">
            {t('Download ({mb} MB, once)', { mb: p.glinerSizeMB ?? '…' })}
          </button>
        )}
      </span>
      <span className={`cap ${p.online ? '' : 'offline'}`}>{t(p.online ? 'Online' : 'Offline: cloud disabled')}</span>
      <select className="lang" value={p.uiLang} onChange={(e) => p.setUiLang(e.target.value as UiLang)} data-testid="ui-lang" aria-label="Language">
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
      <button className="clear" onClick={p.onClear} data-testid="clear" title={t('Forget the text and the placeholder table')}>
        {t('Clear')}
      </button>
    </header>
  );
}
