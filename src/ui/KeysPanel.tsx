import { useState } from 'react';
import { loadModels, saveModels, vault, type ByokModels, type VaultState } from '../services/keys';
import { WrongPasswordError } from '../vault/vault';
import { useT } from './i18n';

type Props = { state: VaultState; onChange: () => void };

export function KeysPanel({ state, onChange }: Props) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [anthropic, setAnthropic] = useState('');
  const [xai, setXai] = useState('');
  const [models, setModels] = useState<ByokModels>(loadModels);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setMsg('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof WrongPasswordError ? 'Wrong password.' : e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
    onChange();
  };
  const keysFromForm = () => ({
    ...(anthropic.trim() ? { anthropic: anthropic.trim() } : {}),
    ...(xai.trim() ? { xai: xai.trim() } : {}),
  });
  const clearForm = () => { setPassword(''); setAnthropic(''); setXai(''); };
  const setModel = (k: keyof ByokModels, v: string) => {
    const next = { ...models, [k]: v };
    setModels(next);
    saveModels(next);
  };

  const keyFields = (
    <>
      <label>Anthropic API key
        <input type="password" autoComplete="off" value={anthropic} onChange={(e) => setAnthropic(e.target.value)} data-testid="key-anthropic"
          placeholder={state.anthropic ? t('saved (leave empty to keep)') : 'sk-ant-…'} />
      </label>
      <label>{t('Anthropic model')}
        <input value={models.anthropic} onChange={(e) => setModel('anthropic', e.target.value)} data-testid="model-anthropic" />
      </label>
      <label>xAI API key
        <input type="password" autoComplete="off" value={xai} onChange={(e) => setXai(e.target.value)} data-testid="key-xai"
          placeholder={state.xai ? t('saved (leave empty to keep)') : 'xai-…'} />
      </label>
      <label>{t('xAI model')}
        <input value={models.xai} onChange={(e) => setModel('xai', e.target.value)} data-testid="model-xai" />
      </label>
    </>
  );

  return (
    <details className="keys" data-testid="keys-panel" data-state={!state.exists ? 'none' : state.unlocked ? 'unlocked' : 'locked'}>
      <summary>{t('Use your own API keys (optional)')}</summary>
      <p className="muted">
        {t('Keys are encrypted with your password and stored only in this browser. They are sent only to the provider they belong to. There is no recovery: if you forget the password, reset and enter the keys again.')}
      </p>

      {!state.exists && (
        <div className="keys-form">
          {keyFields}
          <label>{t('Password to protect the keys (8+ characters)')}
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="vault-password" />
          </label>
          <button className="primary" disabled={busy || password.length < 8 || (!anthropic.trim() && !xai.trim())} data-testid="vault-create"
            onClick={() => run(async () => { await vault.create(password, keysFromForm()); clearForm(); })}>
            {t('Save keys')}
          </button>
        </div>
      )}

      {state.exists && !state.unlocked && (
        <div className="keys-form">
          <label>{t('Password')}
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="vault-password" />
          </label>
          <div className="row">
            <button className="primary" disabled={busy || !password} data-testid="vault-unlock"
              onClick={() => run(async () => { await vault.unlock(password); clearForm(); })}>
              {t('Unlock')}
            </button>
            <button disabled={busy} data-testid="vault-reset"
              onClick={() => { if (confirm(t('Delete the saved keys? This cannot be undone.'))) run(async () => { await vault.reset(); clearForm(); }); }}>
              {t('Forgot password: delete saved keys')}
            </button>
          </div>
        </div>
      )}

      {state.exists && state.unlocked && (
        <div className="keys-form">
          <p className="muted" data-testid="vault-status">
            {t('Unlocked. Locks again after 30 minutes without use.')}{' '}
            Anthropic: {t(state.anthropic ? 'saved' : 'not set')} · xAI: {t(state.xai ? 'saved' : 'not set')}
          </p>
          {keyFields}
          <div className="row">
            <button disabled={busy || (!anthropic.trim() && !xai.trim())} data-testid="vault-update"
              onClick={() => run(async () => {
                await vault.update({
                  ...(vault.get('anthropic') ? { anthropic: vault.get('anthropic') } : {}),
                  ...(vault.get('xai') ? { xai: vault.get('xai') } : {}),
                  ...keysFromForm(),
                });
                clearForm();
              })}>
              {t('Save keys')}
            </button>
            <button disabled={busy} data-testid="vault-lock" onClick={() => { vault.lock(); onChange(); }}>{t('Lock now')}</button>
            <button disabled={busy}
              onClick={() => { if (confirm(t('Delete the saved keys? This cannot be undone.'))) run(async () => { await vault.reset(); clearForm(); }); }}>
              {t('Delete saved keys')}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="error" data-testid="vault-error">{t(msg)}</p>}
    </details>
  );
}
