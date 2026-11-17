// Bring-your-own-key vault. Keys are encrypted with a key derived from the user's password
// (PBKDF2-SHA-256, 600,000 iterations, random salt) using AES-GCM, and only the ciphertext is
// stored. After unlocking, the plaintext keys exist in memory only and are dropped after 30
// minutes without use. There is no recovery: a forgotten password means reset and re-enter.

export type ApiKeys = { anthropic?: string; xai?: string };
export type StoredVault = { v: 1; iterations: number; salt: Uint8Array; iv: Uint8Array; ct: Uint8Array };

export interface VaultStorage {
  load(): Promise<StoredVault | null>;
  save(v: StoredVault): Promise<void>;
  clear(): Promise<void>;
}

export const PBKDF2_ITERATIONS = 600_000;
export const IDLE_LOCK_MS = 30 * 60 * 1000;
export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encrypt(key: CryptoKey, salt: Uint8Array, iterations: number, keys: ApiKeys): Promise<StoredVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh IV for every write
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(keys)));
  return { v: 1, iterations, salt, iv, ct: new Uint8Array(ct) };
}

export class Vault {
  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  private keys: ApiKeys | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly storage: VaultStorage;
  private readonly iterations: number;
  private readonly idleMs: number;
  onLock: () => void = () => {};

  constructor(storage: VaultStorage, opts: { iterations?: number; idleMs?: number } = {}) {
    this.storage = storage;
    this.iterations = opts.iterations ?? PBKDF2_ITERATIONS;
    this.idleMs = opts.idleMs ?? IDLE_LOCK_MS;
  }

  get unlocked() {
    return this.keys !== null;
  }

  async exists(): Promise<boolean> {
    return (await this.storage.load()) !== null;
  }

  /** Creates a new vault (replacing any existing one) and leaves it unlocked. */
  async create(password: string, keys: ApiKeys): Promise<void> {
    if (password.length < 8) throw new Error('Use a password of at least 8 characters');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, this.iterations);
    await this.storage.save(await encrypt(key, salt, this.iterations, keys));
    this.open(key, salt, keys);
  }

  async unlock(password: string): Promise<void> {
    const stored = await this.storage.load();
    if (!stored) throw new Error('No saved keys');
    const key = await deriveKey(password, stored.salt, stored.iterations);
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv as BufferSource }, key, stored.ct as BufferSource);
    } catch {
      throw new WrongPasswordError(); // AES-GCM authentication failed
    }
    this.open(key, stored.salt, JSON.parse(new TextDecoder().decode(plain)) as ApiKeys);
  }

  /** Replaces the stored keys. Requires the vault to be unlocked. */
  async update(keys: ApiKeys): Promise<void> {
    if (!this.key || !this.salt) throw new Error('Vault is locked');
    await this.storage.save(await encrypt(this.key, this.salt, this.iterations, keys));
    this.keys = keys;
    this.touch();
  }

  /** Returns a key and restarts the idle timer; undefined when locked or not set. */
  get(provider: keyof ApiKeys): string | undefined {
    if (!this.keys) return undefined;
    this.touch();
    return this.keys[provider];
  }

  has(provider: keyof ApiKeys): boolean {
    return Boolean(this.keys?.[provider]);
  }

  lock(): void {
    const was = this.unlocked;
    this.key = null;
    this.salt = null;
    this.keys = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (was) this.onLock();
  }

  /** Forgotten password: delete everything. */
  async reset(): Promise<void> {
    this.lock();
    await this.storage.clear();
  }

  private open(key: CryptoKey, salt: Uint8Array, keys: ApiKeys) {
    this.key = key;
    this.salt = salt;
    this.keys = keys;
    this.touch();
  }

  private touch() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lock(), this.idleMs);
  }
}

export const DB_NAME = 'byok-vault';
const STORE = 'vault';

/** IndexedDB storage: one record holding salt, IV and ciphertext. */
export class IdbVaultStorage implements VaultStorage {
  private db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async load(): Promise<StoredVault | null> {
    return ((await this.run('readonly', (s) => s.get('keys'))) as StoredVault | undefined) ?? null;
  }

  async save(v: StoredVault): Promise<void> {
    await this.run('readwrite', (s) => s.put(v, 'keys'));
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (s) => s.delete('keys'));
  }
}
