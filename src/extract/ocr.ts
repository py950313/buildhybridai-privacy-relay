// Image -> text, entirely on the device.
//
// Order (measured on tests/e2e/files, see docs/prototype-findings.md): Tesseract.js first. It is
// exact on clean screenshots and scans, where Gemini Nano drops characters and whole lines on
// dense pages. When Tesseract is unsure (low confidence or almost no text: noisy phone photos) the
// image is cleaned up and retried, and if that is still poor and Nano is available, Nano reads it.
import type { Worker as TesseractWorker } from 'tesseract.js';

export type OcrEngine = 'nano' | 'tesseract';
export type OcrResult = { text: string; engine: OcrEngine; confidence: number | null };

/** Tesseract mean confidence (0-100) below which the result is not trusted. */
export const MIN_CONFIDENCE = 70;
const MIN_CHARS = 20;

type LMSession = { prompt(input: unknown, opts?: { signal?: AbortSignal }): Promise<string>; destroy(): void };
type LMStatic = { create(o: object): Promise<LMSession> };

const NANO_TIMEOUT_MS = 60_000;
const NANO_PROMPT = 'Transcribe all the text in this image exactly as written, character for character, keeping line breaks. Output only the text.';

async function nanoRead(image: Blob): Promise<string> {
  const api = (globalThis as { LanguageModel?: LMStatic }).LanguageModel;
  if (!api) throw new Error('Prompt API not available');
  const session = await api.create({
    expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NANO_TIMEOUT_MS);
  try {
    return await session.prompt(
      [{ role: 'user', content: [{ type: 'text', value: NANO_PROMPT }, { type: 'image', value: image }] }],
      { signal: ctl.signal },
    );
  } finally {
    clearTimeout(timer);
    session.destroy();
  }
}

let worker: Promise<TesseractWorker> | null = null;
function tesseract(): Promise<TesseractWorker> {
  worker ??= import('tesseract.js').then(({ createWorker }) => createWorker(['chi_tra', 'eng']));
  worker.catch(() => { worker = null; });
  return worker;
}

const CJK = '\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef';
/** Tesseract puts spaces between CJK characters; remove them, keep spaces between Latin words. */
export function tidyOcr(text: string): string {
  return text
    .replace(new RegExp(`(?<=[${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const visible = (s: string) => s.replace(/\s/g, '').length;
const poor = (r: { text: string; confidence: number }) => r.confidence < MIN_CONFIDENCE || visible(r.text) < MIN_CHARS;

async function tesseractRead(image: Blob): Promise<{ text: string; confidence: number }> {
  const w = await tesseract();
  const { data } = await w.recognize(image);
  return { text: tidyOcr(data.text), confidence: data.confidence };
}

/** Grayscale, more contrast, slight blur against sensor noise, and upscale small images. */
async function cleanUp(image: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(image);
  const scale = Math.min(2, Math.max(1, 2400 / Math.max(bmp.width, bmp.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.7) blur(0.7px)';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas failed'))), 'image/png'));
}

export async function imageToText(image: Blob, opts: { useNano: boolean }): Promise<OcrResult> {
  let best = await tesseractRead(image);
  if (poor(best)) {
    try {
      const retry = await tesseractRead(await cleanUp(image));
      if (retry.confidence > best.confidence || visible(retry.text) > visible(best.text) * 1.5) best = retry;
    } catch {
      // keep the first reading
    }
  }
  if (poor(best) && opts.useNano) {
    try {
      const text = (await nanoRead(image)).trim();
      if (visible(text) >= MIN_CHARS || visible(text) > visible(best.text)) return { text, engine: 'nano', confidence: null };
    } catch {
      // keep Tesseract's reading
    }
  }
  return { text: best.text, engine: 'tesseract', confidence: Math.round(best.confidence) };
}
