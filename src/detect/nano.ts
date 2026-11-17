// Gemini Nano semantic layer (Chrome Prompt API). Returns text + type only; locate.ts finds
// positions, and anything Nano invents ends up in `unlocated` (prototype #2: 19% of items).
import { ENTITY_TYPES, type DetectionLayer, type EntityType, type RawItem } from './types';

type LMOptions = {
  expectedInputs?: { type: 'text'; languages: string[] }[];
  expectedOutputs?: { type: 'text'; languages: string[] }[];
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
};
type LMSession = {
  prompt(input: string, opts?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  clone(): Promise<LMSession>;
  destroy(): void;
};
type LanguageModelStatic = {
  availability(opts?: LMOptions): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: LMOptions): Promise<LMSession>;
};
const lm = (): LanguageModelStatic | undefined => (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;

export type NanoLang = 'en' | 'ja' | 'es' | 'zh';

/** Cheap script/stop-word heuristic; good enough to choose the declared input language. */
export function guessLang(text: string): NanoLang {
  const kana = text.match(/[぀-ヿ]/g)?.length ?? 0;
  const han = text.match(/[一-鿿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (kana > 0 && kana >= han * 0.1) return 'ja';
  if (han > latin / 4) return 'zh';
  const es = text.toLowerCase().match(/(?:^|[^a-záéíóúñ])(el|la|los|las|que|de|y|para|con|por|una?)(?=[^a-záéíóúñ]|$)/g)?.length ?? 0;
  const en = text.toLowerCase().match(/(?:^|[^a-z])(the|and|of|to|is|for|with|that|a)(?=[^a-z]|$)/g)?.length ?? 0;
  return /[ñ¿¡]/.test(text) || es > en ? 'es' : 'en';
}

/** zh is not supported by the API; it is sent declared as en when the Remote Config flag is on. */
export function declaredLang(lang: NanoLang, zhEnabled: boolean): 'en' | 'ja' | 'es' | null {
  if (lang === 'zh') return zhEnabled ? 'en' : null;
  return lang;
}

const BIRTH_CONTEXT = /(生日|出生|誕生|生年月日|born|birth|dob|nacimiento|nacido|nacida)/i;

/** Applies the rules the prompt asks for, since the model does not always follow them. */
export function postFilter(chunkText: string, items: RawItem[]): RawItem[] {
  const birth = BIRTH_CONTEXT.test(chunkText);
  return items.filter((i) => i.text.trim() && (i.type !== 'DATE_OF_BIRTH' || birth));
}

export const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: [...ENTITY_TYPES] },
          reason: { type: 'string' },
        },
        required: ['text', 'type'],
      },
    },
  },
  required: ['items'],
};

const SYSTEM =
  'You find sensitive information in the user text that should be hidden before sending it to a cloud AI: ' +
  'names of people, companies and organizations, addresses, emails, phone numbers, ID numbers, card or bank account ' +
  'numbers, dates of birth, medical conditions, salaries and money amounts, and private personal situations. ' +
  'Copy each item exactly as it appears in the text, character for character. Only use DATE_OF_BIRTH when the text ' +
  'says the date is a birthday; ordinary dates and weekdays are not sensitive. Do not invent content. ' +
  'Return an empty list if there is nothing sensitive.';

export function parseItems(raw: string): RawItem[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((i) => {
    if (!i || typeof i.text !== 'string') return [];
    const type: EntityType = ENTITY_TYPES.includes(i.type) ? i.type : 'OTHER';
    return [{ text: i.text, type, reason: typeof i.reason === 'string' ? `nano: ${i.reason}` : 'nano' }];
  });
}

const io = (lang: string): LMOptions => ({
  expectedInputs: [{ type: 'text', languages: [lang] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});

export async function nanoAvailable(): Promise<boolean> {
  const api = lm();
  if (!api) return false;
  try {
    return (await api.availability(io('en'))) === 'available';
  } catch {
    return false;
  }
}

export class NanoLayer implements DetectionLayer {
  readonly source = 'nano' as const;
  private sessions = new Map<string, Promise<LMSession>>();
  private readonly zhEnabled: boolean;
  private readonly timeoutMs: number;
  private readonly system: string;

  constructor(opts: { zhEnabled: boolean; timeoutMs?: number; focus?: EntityType[] }) {
    this.zhEnabled = opts.zhEnabled;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.system = opts.focus?.length ? `${SYSTEM} Look especially carefully for: ${opts.focus.join(', ')}.` : SYSTEM;
  }

  private base(lang: string): Promise<LMSession> {
    let s = this.sessions.get(lang);
    if (!s) {
      const api = lm();
      if (!api) return Promise.reject(new Error('Prompt API not available'));
      s = api.create({ ...io(lang), initialPrompts: [{ role: 'system', content: this.system }] });
      this.sessions.set(lang, s);
    }
    return s;
  }

  async detect(chunkText: string): Promise<RawItem[]> {
    const lang = declaredLang(guessLang(chunkText), this.zhEnabled);
    if (!lang) return [];
    const session = await (await this.base(lang)).clone(); // fresh context per chunk
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const raw = await session.prompt(chunkText, { responseConstraint: SCHEMA, signal: ctl.signal });
      return postFilter(chunkText, parseItems(raw));
    } finally {
      clearTimeout(timer);
      session.destroy();
    }
  }

  destroy() {
    for (const s of this.sessions.values()) s.then((x) => x.destroy(), () => {});
    this.sessions.clear();
  }
}
