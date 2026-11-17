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
  // Finer labels the PII model was trained on; they recover items the generic labels miss.
  'first name': 'PERSON',
  'last name': 'PERSON',
  city: 'LOCATION',
  state: 'LOCATION',
  country: 'LOCATION',
  'postal code': 'LOCATION',
  'social security number': 'ID_NUMBER',
  'passport number': 'ID_NUMBER',
  "driver's license number": 'ID_NUMBER',
  'tax identification number': 'ID_NUMBER',
  'national id number': 'ID_NUMBER',
  'health insurance id number': 'ID_NUMBER',
  'medical record number': 'ID_NUMBER',
  'license number': 'ID_NUMBER',
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

/**
 * fp16 only: the generic `person` and `organization` labels are right almost only at >= 0.9 on
 * Latin-script text (dev sample: 3 right / 111 wrong below 0.9 for person, 4 / 59 for
 * organization). CJK spans keep the base threshold: no evidence there.
 */
export const STRICT_LATIN_LABELS = new Set(['person', 'organization']);
export const STRICT_LATIN_THRESHOLD = 0.9;

export function passesScore(r: { spanText: string; label: string; score: number }, variant: GlinerVariant['name']): boolean {
  if (variant !== 'fp16' || !STRICT_LATIN_LABELS.has(r.label)) return true;
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(r.spanText)) return true;
  return r.score >= STRICT_LATIN_THRESHOLD;
}

export async function pickVariant(): Promise<GlinerVariant> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    if (gpu && (await gpu.requestAdapter())) return VARIANTS.fp16;
  } catch {
    // fall through
  }
  return VARIANTS.int8;
}

// Role nouns and field labels the model tags as people/organizations/places in forms and contracts.
const ROLE_WORDS = new Set([
  'seller', 'buyer', 'employee', 'employees', 'employer', 'customer', 'customers', 'client', 'clients', 'patient',
  'patients', 'user', 'users', 'supplier', 'vendor', 'tenant', 'landlord', 'applicant', 'recipient', 'sender',
  'personnel', 'officer', 'staff', 'manager', 'team', 'member', 'members', 'party', 'parties', 'contractor',
  'consultant', 'shipper', 'consignee', 'carrier', 'borrower', 'lender', 'insured', 'beneficiary', 'holder',
  'representative', 'administrator', 'owner', 'guest', 'visitor', 'student', 'teacher', 'doctor', 'nurse',
]);
const FIELD_LABEL = /\b(name|address|number|no\.?|id|code|email|e-mail|phone|date|information|details)\s*:?$/i;
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const digits = (s: string) => s.replace(/[^0-9０-９]/g, '').length;

/**
 * Drops model output that cannot be the thing its label says: stop-listed pronouns, role nouns
 * ("Seller", "employees"), field labels ("Phone Number", "Company Address"), generic lowercase
 * nouns tagged as organizations or places, and number-type items without digits.
 */
export function filterItems(items: RawItem[]): RawItem[] {
  return items.filter((i) => {
    const t = i.text.trim();
    if (!/[\p{L}\p{N}]/u.test(t)) return false;
    if (ZH_STOPLIST.has(t)) return false;
    const cjk = CJK_CHAR.test(t);
    switch (i.type) {
      case 'EMAIL':
        return t.includes('@');
      case 'PHONE':
      case 'CARD':
      case 'ACCOUNT':
      case 'ID_NUMBER':
        return digits(t) >= 4;
      case 'ADDRESS':
      case 'DATE_OF_BIRTH':
        return cjk || digits(t) >= 1;
      case 'PERSON':
      case 'ORG':
      case 'LOCATION': {
        if (cjk) return true;
        if (FIELD_LABEL.test(t)) return false;
        const tokens = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
        if (i.type === 'PERSON') return !tokens.some((w) => ROLE_WORDS.has(w));
        if (tokens.length > 0 && tokens.every((w) => ROLE_WORDS.has(w))) return false;
        return /[A-Z]/.test(t) || (i.type === 'LOCATION' && digits(t) >= 3); // proper nouns, or a postal code
      }
      default:
        return true;
    }
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
    const variant = this.variant!.name;
    const items = results.flat().filter((r) => passesScore(r, variant)).map((r) => ({ text: r.spanText, type: LABEL_TO_TYPE[r.label] ?? 'OTHER', reason: `gliner ${r.label} ${r.score.toFixed(2)}` }));
    return filterItems(items);
  }
}
