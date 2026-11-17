// Dev-only page: exposes the detection engine to the Playwright runner (eval/run_engine.mjs).
import { detect } from '../../src/detect/engine';
import { extractFile } from '../../src/extract';
import { GlinerLayer } from '../../src/detect/gliner';
import { NanoLayer, nanoAvailable } from '../../src/detect/nano';
import type { DetectionLayer, EntityType } from '../../src/detect/types';

const FAMILY: Partial<Record<EntityType, string>> = { ADDRESS: 'LOCATION', DATE_OF_BIRTH: 'DOB' };
const log = (s: string) => { document.getElementById('log')!.textContent = s; };

const gliner = new GlinerLayer(log);
let nano: NanoLayer | null = null;

const api = {
  async init() {
    await gliner.init();
    const nanoOk = await nanoAvailable();
    if (nanoOk) nano = new NanoLayer({ zhEnabled: true });
    return { gliner: gliner.variantName, nano: nanoOk };
  },
  /** Reads an image or PDF (base64) with the app's extractor; Nano is used only as the fallback reader. */
  async extract(b64: string, name: string) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const type = name.endsWith('.pdf') ? 'application/pdf' : 'image/png';
    const r = await extractFile(new File([bytes], name, { type }), { useNano: await nanoAvailable() });
    return { text: r.text, engine: r.engine, ocrPages: r.ocrPages };
  },
  async run(text: string, config: 'regex' | 'gliner' | 'full') {
    const layers: DetectionLayer[] = config === 'regex' ? [] : config === 'gliner' || !nano ? [gliner] : [gliner, nano];
    const t = performance.now();
    const r = await detect(text, { layers });
    return {
      ms: Math.round(performance.now() - t),
      preds: r.mentions.map((m) => ({ start: m.start, end: m.end, family: FAMILY[m.type] ?? m.type, type: m.type, source: m.source, reason: m.reason })),
      unlocated: r.unlocated.length,
      warnings: r.warnings,
    };
  },
};
(window as unknown as { evalApi: typeof api }).evalApi = api;
log('ready');
