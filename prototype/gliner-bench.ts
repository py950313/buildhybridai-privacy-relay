// Prototype benchmark: load a GLiNER ONNX variant in the browser, run the EN/ZH samples, report
// load time, per-sample latency, recall and precision (substring match against expected strings).
// URL params: repo (HF repo id), file (onnx file under onnx/), ep (wasm|webgpu), threshold.
import { Gliner } from 'gliner';
import samples from './samples.json';

const LABELS = ['person', 'organization', 'address', 'location', 'email', 'phone number', 'id number',
  'credit card number', 'bank account number', 'date of birth', 'medical condition', 'money'];

const q = new URLSearchParams(location.search);
const repo = q.get('repo') ?? 'onnx-community/gliner_multi_pii-v1';
const file = q.get('file') ?? 'model_int8.onnx';
const ep = (q.get('ep') ?? 'wasm') as 'wasm' | 'webgpu';
const log = (s: string) => { document.getElementById('log')!.textContent += '\n' + s; };

type Sample = { text: string; expected: string[] };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

async function run() {
  const t0 = performance.now();
  const g = new Gliner({
    tokenizerPath: repo,
    onnxSettings: {
      modelPath: `https://huggingface.co/${repo}/resolve/main/onnx/${file}`,
      executionProvider: ep,
      multiThread: q.get('mt') !== '0',
      maxThreads: Math.min(8, navigator.hardwareConcurrency || 4),
    },
    transformersSettings: { allowLocalModels: false, useBrowserCache: true },
    maxWidth: 12,
  });
  await g.initialize();
  const loadMs = performance.now() - t0;
  log(`loaded ${repo}/${file} ep=${ep} in ${(loadMs / 1000).toFixed(1)}s`);

  // Run once at the lowest threshold, then score offline at several thresholds.
  const THRESHOLDS = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5];
  const report: Record<string, unknown> = { repo, file, ep, loadMs };
  for (const lang of ['en', 'zh'] as const) {
    const times: number[] = [];
    const raw: { s: Sample; res: { spanText: string; label: string; score: number }[] }[] = [];
    for (const s of (samples as Record<string, Sample[]>)[lang]) {
      const t = performance.now();
      const [res] = await g.inference({ texts: [s.text], entities: LABELS, flatNer: true, threshold: Math.min(...THRESHOLDS) });
      times.push(performance.now() - t);
      raw.push({ s, res });
    }
    const byThreshold: Record<string, unknown> = {};
    for (const th of THRESHOLDS) {
      let tp = 0, fn = 0, predicted = 0, falsePos = 0;
      const misses: string[] = [];
      const extras: string[] = [];
      for (const { s, res: all } of raw) {
        const res = all.filter((r) => r.score >= th);
        const got = res.map((r) => r.spanText);
        for (const e of s.expected) {
          if (got.some((x) => norm(x).includes(norm(e)) || (norm(e).includes(norm(x)) && norm(x).length >= 2))) tp++;
          else { fn++; misses.push(e); }
        }
        for (const r of res) {
          predicted++;
          if (!s.expected.some((e) => norm(e).includes(norm(r.spanText)) || norm(r.spanText).includes(norm(e)))) {
            falsePos++; extras.push(`${r.spanText}(${r.label})`);
          }
        }
      }
      byThreshold[th] = {
        recall: +(tp / (tp + fn)).toFixed(3),
        precision: +(predicted ? (predicted - falsePos) / predicted : 1).toFixed(3),
        misses, extras,
      };
    }
    times.sort((a, b) => a - b);
    report[lang] = { medianMs: Math.round(times[Math.floor(times.length / 2)]), maxMs: Math.round(times[times.length - 1]), byThreshold };
    log(`${lang}: ${JSON.stringify(report[lang])}`);
  }
  (window as unknown as { __result: unknown }).__result = report;
}
run().catch((e) => {
  log('ERROR ' + (e?.stack ?? e));
  (window as unknown as { __result: unknown }).__result = { error: String(e?.message ?? e) };
});
