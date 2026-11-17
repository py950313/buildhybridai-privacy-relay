// protects: stored vault data never contains a key in clear, a wrong password cannot unlock,
//   every write uses a fresh IV, the vault locks itself after the idle period, and reset wipes it.
// fails_when: keys are stored unencrypted or with a reused IV, decryption errors are swallowed,
//   the idle timer is not armed or not restarted on use.
// no_claim: IndexedDB behaviour (tests use in-memory storage; the browser path is covered by the
//   e2e privacy test). Iterations are lowered here for speed; production uses 600,000.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PBKDF2_ITERATIONS, Vault, WrongPasswordError, type StoredVault, type VaultStorage } from './vault';

class MemoryStorage implements VaultStorage {
  value: StoredVault | null = null;
  async load() { return this.value; }
  async save(v: StoredVault) { this.value = v; }
  async clear() { this.value = null; }
}
const FAST = { iterations: 1000 };
const SECRET = 'sk-ant-test-0123456789abcdef';
const bytesContain = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle));

afterEach(() => vi.useRealTimers());

describe('Vault', () => {
  it('production iteration count is 600,000', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('stores ciphertext only and round-trips with the right password', async () => {
    const storage = new MemoryStorage();
    const v = new Vault(storage, FAST);
    await v.create('correct horse', { anthropic: SECRET });
    const stored = storage.value!;
    expect(bytesContain(stored.ct, SECRET)).toBe(false);
    expect(JSON.stringify([...stored.ct, ...stored.salt, ...stored.iv])).not.toContain(SECRET);
    v.lock();
    expect(v.get('anthropic')).toBeUndefined();
    await v.unlock('correct horse');
    expect(v.get('anthropic')).toBe(SECRET);
  });

  it('a wrong password does not unlock', async () => {
    const storage = new MemoryStorage();
    const v = new Vault(storage, FAST);
    await v.create('correct horse', { anthropic: SECRET });
    v.lock();
    await expect(v.unlock('correct hors')).rejects.toBeInstanceOf(WrongPasswordError);
    expect(v.unlocked).toBe(false);
  });

  it('uses a new IV on every write', async () => {
    const storage = new MemoryStorage();
    const v = new Vault(storage, FAST);
    await v.create('correct horse', { anthropic: SECRET });
    const iv1 = [...storage.value!.iv];
    await v.update({ anthropic: SECRET, xai: 'xai-test-key-000000' });
    expect([...storage.value!.iv]).not.toEqual(iv1);
    v.lock();
    await v.unlock('correct horse');
    expect(v.get('xai')).toBe('xai-test-key-000000');
  });

  it('locks after the idle period, and use restarts the timer', async () => {
    const v = new Vault(new MemoryStorage(), { ...FAST, idleMs: 1000 });
    await v.create('correct horse', { anthropic: SECRET });
    vi.useFakeTimers();
    v.get('anthropic'); // arms the timer under fake timers
    vi.advanceTimersByTime(900);
    expect(v.get('anthropic')).toBe(SECRET); // restarts
    vi.advanceTimersByTime(900);
    expect(v.unlocked).toBe(true);
    let locked = false;
    v.onLock = () => { locked = true; };
    vi.advanceTimersByTime(200);
    expect(v.unlocked).toBe(false);
    expect(locked).toBe(true);
  });

  it('reset deletes the stored vault; short passwords are refused', async () => {
    const storage = new MemoryStorage();
    const v = new Vault(storage, FAST);
    await expect(v.create('short', {})).rejects.toThrow();
    await v.create('correct horse', { anthropic: SECRET });
    await v.reset();
    expect(storage.value).toBeNull();
    expect(await v.exists()).toBe(false);
  });
});
