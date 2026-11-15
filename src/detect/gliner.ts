// GLiNER PII layer (onnx-community/gliner_multi_pii-v1). Variant choice from prototype #2:
// WebGPU -> fp16 @ 0.3; otherwise (or if fp16 fails / one chunk takes > 10 s) int8 @ 0.02.
import type { Gliner as GlinerModel } from 'gliner';
import type { DetectionLayer, EntityType, RawItem } from './types';

export const GLINER_REPO = 'onnx-community/gliner_multi_pii-v1';

export const LABEL_TO_TYPE: Record<string, EntityType> = {
  person: 'PERSON',
  organization: 'ORG',
  address: 'ADDRESS',
  location: 'LOCATION',
  email: 'EMAIL',
  'phone number': 'PHONE',
  'id number': 'ID_NUMBER',
  'credit card number': 'CARD',
  'bank account number': 'ACCOUNT',
  'date of birth': 'DATE_OF_BIRTH',
  'medical condition': 'MEDICAL',
  money: 'FINANCIAL',
};
const LABELS = Object.keys(LABEL_TO_TYPE);

/** Pronouns and common words the model tags as names (measured false positives in #2). */
export const ZH_STOPLIST = new Set(['我', '你', '妳', '他', '她', '它', '幫我', '我們', '你們', '他們', '她們', '咱們', '自己', '大家', '產品', '公司']);

export type GlinerVariant = { name: 'fp16' | 'int8'; file: string; ep: 'webgpu' | 'wasm'; threshold: number };
export const VARIANTS: Record<'fp16' | 'int8', GlinerVariant> = {
  fp16: { name: 'fp16', file: 'model_fp16.onnx', ep: 'webgpu', threshold: 0.3 },
  int8: { name: 'int8', file: 'model_int8.onnx', ep: 'wasm', threshold: 0.02 },
};
export const SLOW_CHUNK_MS = 10_000;

export async function pickVariant(): Promise<GlinerVariant> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    if (gpu && (await gpu.requestAdapter())) return VARIANTS.fp16;
  } catch {
    // fall through
  }
  return VARIANTS.int8;
}

/** Drops stop-listed words and anything with no letters or digits. */
export function filterItems(items: RawItem[]): RawItem[] {
  return items.filter((i) => {
    const t = i.text.trim();
    if (!/[\p{L}\p{N}]/u.test(t)) return false;
    if (ZH_STOPLIST.has(t)) return false;
    return true;
  });
}

// Same splitter as the gliner package (no `u` flag: each CJK char is one token).
const TOKEN = /\w+(?:[-_]\w+)*|\S/g;
/** GLiNER's window is ~384 tokens; cut chunk text into sentence groups of at most `max` tokens. */
export function splitForModel(text: string, max = 300): string[] {
  const sentences = text.match(/[^。！？!?.\n]+[。！？!?.\n]*|[。！？!?.\n]+/g) ?? [];
  const out: string[] = [];
  let cur = '';
  let curTokens = 0;
  for (const s of sentences) {
    const t = s.match(TOKEN)?.length ?? 0;
    if (curTokens + t > max && cur) {
      out.push(cur);
      cur = '';
      curTokens = 0;
    }
    if (t > max) {
      // A single huge "sentence": split by characters.
      const per = Math.max(1, Math.floor((s.length * max) / t));
      for (let i = 0; i < s.length; i += per) out.push(s.slice(i, i + per));
      continue;
    }
    cur += s;
    curTokens += t;
  }
  if (cur) out.push(cur);
  return out.filter((x) => x.trim());
}

export type GlinerProgress = (msg: string) => void;

export class GlinerLayer implements DetectionLayer {
  readonly source = 'gliner' as const;
  private model: GlinerModel | null = null;
  private variant: GlinerVariant | null = null;
  private loading: Promise<void> | null = null;
  private readonly onProgress: GlinerProgress;

  constructor(onProgress: GlinerProgress = () => {}) {
    this.onProgress = onProgress;
  }

  get variantName() {
    return this.variant?.name ?? null;
  }

  private async load(v: GlinerVariant) {
    const { Gliner } = await import('gliner');
    const g = new Gliner({
      tokenizerPath: GLINER_REPO,
      onnxSettings: {
        modelPath: `https://huggingface.co/${GLINER_REPO}/resolve/main/onnx/${v.file}`,
        executionProvider: v.ep,
        multiThread: false, // gliner 0.0.19 worker crashes under Vite pre-bundling (#2)
      },
      transformersSettings: { allowLocalModels: false, useBrowserCache: true },
      maxWidth: 12,
    });
    this.onProgress(`loading GLiNER ${v.name}`);
    await g.initialize();
    this.model = g;
    this.variant = v;
  }

  /** Loads the preferred variant once; falls back to int8 if fp16 cannot load. */
  init(): Promise<void> {
    this.loading ??= (async () => {
      const v = await pickVariant();
      try {
        await this.load(v);
      } catch (e) {
        if (v.name === 'int8') throw e;
        this.onProgress('fp16 failed, falling back to int8');
        await this.load(VARIANTS.int8);
      }
    })();
    return this.loading;
  }

  async detect(chunkText: string): Promise<RawItem[]> {
    await this.init();
    const t0 = performance.now();
    const texts = splitForModel(chunkText);
    if (!texts.length) return [];
    const results = await this.model!.inference({ texts, entities: LABELS, flatNer: true, threshold: this.variant!.threshold });
    const elapsed = performance.now() - t0;
    if (elapsed > SLOW_CHUNK_MS && this.variant!.name === 'fp16') {
      this.onProgress(`fp16 took ${Math.round(elapsed)} ms, switching to int8`);
      this.loading = this.load(VARIANTS.int8);
    }
    const items = results.flat().map((r) => ({ text: r.spanText, type: LABEL_TO_TYPE[r.label] ?? 'OTHER', reason: `gliner ${r.label} ${r.score.toFixed(2)}` }));
    return filterItems(items);
  }
}
