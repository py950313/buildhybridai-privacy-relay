// What this browser can do. Drives the status bar and which detection layers run.
import { GlinerLayer, pickVariant, type GlinerVariant } from '../detect/gliner';
import { NanoLayer } from '../detect/nano';
import type { DetectionLayer } from '../detect/types';

export type NanoState = 'absent' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

export const GLINER_SIZE_MB: Record<GlinerVariant['name'], number> = { fp16: 580, int8: 349 };

type LMStatic = { availability(o?: object): Promise<NanoState> };

/** Test hooks: ?nano=off / ?gliner=off simulate browsers without those layers. */
const flags = () => new URLSearchParams(location.search);

export async function probeNano(): Promise<NanoState> {
  if (flags().get('nano') === 'off') return 'absent';
  const api = (globalThis as { LanguageModel?: LMStatic }).LanguageModel;
  if (!api) return 'absent';
  try {
    return await api.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
  } catch {
    return 'unavailable';
  }
}

export const glinerDisabled = () => flags().get('gliner') === 'off';
export { pickVariant };

const CONSENT_KEY = 'gliner-download-consent';
export function hasGlinerConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}
export function setGlinerConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    // private mode: consent lasts for this page only
  }
}

let gliner: GlinerLayer | null = null;
export function glinerLayer(onProgress: (m: string) => void): GlinerLayer {
  gliner ??= new GlinerLayer(onProgress);
  return gliner;
}

export function detectionLayers(o: { glinerReady: boolean; nanoReady: boolean; zh: boolean }): DetectionLayer[] {
  const layers: DetectionLayer[] = [];
  if (o.glinerReady && gliner) layers.push(gliner);
  if (o.nanoReady) layers.push(new NanoLayer({ zhEnabled: o.zh }));
  return layers;
}

export type Tier = 'full' | 'gliner' | 'manual';
export const tierOf = (glinerReady: boolean, nanoReady: boolean): Tier =>
  glinerReady && nanoReady ? 'full' : glinerReady ? 'gliner' : 'manual';
