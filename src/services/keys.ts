// The app's single key vault plus the (non-secret) model names chosen for bring-your-own-key use.
import { IdbVaultStorage, Vault } from '../vault/vault';
import { DEFAULT_MODELS } from './providers';

export const vault = new Vault(new IdbVaultStorage());

export type ByokModels = { anthropic: string; xai: string };
const MODELS_KEY = 'byok-models';

export function loadModels(): ByokModels {
  try {
    return { ...DEFAULT_MODELS, ...(JSON.parse(localStorage.getItem(MODELS_KEY) ?? '{}') as Partial<ByokModels>) };
  } catch {
    return { ...DEFAULT_MODELS };
  }
}

export function saveModels(m: ByokModels) {
  try {
    localStorage.setItem(MODELS_KEY, JSON.stringify(m));
  } catch {
    // private mode: lasts for this page only
  }
}

export type VaultState = { exists: boolean; unlocked: boolean; anthropic: boolean; xai: boolean };

export async function vaultState(): Promise<VaultState> {
  let exists = false;
  try {
    exists = await vault.exists();
  } catch {
    // IndexedDB unavailable: bring-your-own-key is simply not offered
  }
  return { exists, unlocked: vault.unlocked, anthropic: vault.has('anthropic'), xai: vault.has('xai') };
}
