// End-to-end check of src/detect with the real models on prototype/samples.json.
// Configurations: regex only, regex+GLiNER, regex+GLiNER+Nano. A sample's expected string counts
// as found when some mention covers it (whitespace/case-insensitive); a mention that overlaps no
// expected string counts as a false positive.
import { detect } from '../src/detect/engine';
import { GlinerLayer } from '../src/detect/gliner';
import { NanoLayer, nanoAvailable } from '../src/detect/nano';
import type { DetectionLayer, DetectionResult } from '../src/detect/types';
import samples from './samples.json';

type Sample = { text: string; expected: string[] };
const log = (s: string) => { document.getElementById('log')!.textContent += '\n' + s; };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function score(s: Sample, r: DetectionResult) {
  const got = r.mentions.map((m) => norm(m.text));
  const misses = s.expected.filter((e) => !got.some((g) => g.includes(norm(e))));
  const extras = r.mentions.filter((m) => !s.expected.some((e) => norm(e).includes(norm(m.text)) || norm(m.text).includes(norm(e))));
  return { tp: s.expected.length - misses.length, fn: misses.length, pred: r.mentions.length, fp: extras.length,
    misses, extras: extras.map((m) => `${m.text}(${m.type}/${m.source})`), unlocated: r.unlocated.map((u) => u.text) };
}

async function run() {
  const gliner = new GlinerLayer(log);
  const t0 = performance.now();
  await gliner.init();
  log(`gliner ${gliner.variantName} ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const nanoOk = await nanoAvailable();
  log(`nano available: ${nanoOk}`);
  const configs: Record<string, DetectionLayer[]> = { regex: [], gliner: [gliner] };
  if (nanoOk) configs.gliner_nano = [gliner, new NanoLayer({ zhEnabled: true })];

  const report: Record<string, unknown> = { glinerVariant: gliner.variantName, nanoOk };
  for (const [name, layers] of Object.entries(configs)) {
    for (const lang of ['en', 'zh'] as const) {
      let tp = 0, fn = 0, pred = 0, fp = 0;
      const times: number[] = [];
      const detail: unknown[] = [];
      for (const s of (samples as unknown as Record<string, Sample[]>)[lang]) {
        const t = performance.now();
        const r = await detect(s.text, { layers });
        times.push(performance.now() - t);
        const sc = score(s, r);
        tp += sc.tp; fn += sc.fn; pred += sc.pred; fp += sc.fp;
        if (sc.misses.length || sc.extras.length || sc.unlocated.length || r.warnings.length) {
          detail.push({ misses: sc.misses, extras: sc.extras, unlocated: sc.unlocated, warnings: r.warnings });
        }
      }
      times.sort((a, b) => a - b);
      const key = `${name}_${lang}`;
      report[key] = { recall: +(tp / (tp + fn)).toFixed(3), precision: +(pred ? (pred - fp) / pred : 1).toFixed(3),
        medianMs: Math.round(times[Math.floor(times.length / 2)]), detail };
      log(`${key}: ${JSON.stringify(report[key])}`);
    }
  }
  (window as unknown as { __result: unknown }).__result = report;
}
run().catch((e) => {
  log('ERROR ' + (e?.stack ?? e));
  (window as unknown as { __result: unknown }).__result = { error: String(e?.message ?? e) };
});
