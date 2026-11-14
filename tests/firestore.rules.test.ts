// protects: receipts can only ever hold the 8 statistic fields (no original or masked text).
// fails_when: a write with an extra field, a wrong type, another user's uid, or any read is accepted.
// no_claim: does not prove the client never sends text elsewhere (covered by the #4 network test).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

const valid = (uid: string) => ({
  uid,
  scenario: 'email',
  route: 'cloud',
  provider: 'gemini',
  maskedCounts: { PERSON: 2, EMAIL: 1 },
  inputChars: 512,
  latencyMs: 1830,
  createdAt: serverTimestamp(),
});

describe('receipts rules', () => {
  it('accepts a valid receipt from its owner', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(db, 'receipts/r1'), valid('alice')));
  });

  it('rejects an extra field (e.g. leaked text)', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'receipts/r1'), { ...valid('alice'), maskedText: 'Hi [PERSON_1]' }));
  });

  it('rejects a wrong type', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'receipts/r1'), { ...valid('alice'), inputChars: '512' }));
  });

  it('rejects another user uid', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'receipts/r1'), valid('bob')));
  });

  it('rejects unauthenticated writes', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'receipts/r1'), valid('alice')));
  });

  it('rejects reads, even by the owner', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'receipts/r1'), { ...valid('alice'), createdAt: new Date() });
    });
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'receipts/r1')));
  });
});
