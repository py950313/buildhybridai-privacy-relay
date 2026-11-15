// Receipts in Firestore hold statistics only: never original text, masked text or placeholders.
// The Firestore rules reject any other field.
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, ensureSignedIn } from '../config/firebase';
import type { EntityType } from '../detect/types';
import type { Route } from '../relay/router';

export type Scenario = 'email' | 'contract' | 'health' | 'free';
export type Provider = 'gemini' | 'openai' | 'anthropic' | 'xai' | 'copy';

export type ReceiptStats = {
  scenario: Scenario;
  route: Route;
  provider: Provider;
  maskedCounts: Partial<Record<EntityType, number>>;
  inputChars: number;
  latencyMs: number;
};

export async function saveReceipt(r: ReceiptStats): Promise<void> {
  const user = await ensureSignedIn();
  await addDoc(collection(db, 'receipts'), {
    uid: user.uid,
    scenario: r.scenario,
    route: r.route,
    provider: r.provider,
    maskedCounts: Object.fromEntries(Object.entries(r.maskedCounts).map(([k, v]) => [k, Math.round(v ?? 0)])),
    inputChars: Math.round(r.inputChars),
    latencyMs: Math.round(r.latencyMs),
    createdAt: serverTimestamp(),
  });
}
