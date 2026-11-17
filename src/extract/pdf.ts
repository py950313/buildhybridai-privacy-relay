// PDF -> text with pdf.js, on the device. Pages without a usable text layer are rendered to a
// canvas and read by OCR. pdf.js is loaded lazily (it is large and most tasks never need it).
import { imageToText, type OcrEngine } from './ocr';

export const MAX_PDF_PAGES = 30;
/** Fewer visible characters than this on a page = treat it as a scan. */
const MIN_TEXT_LAYER_CHARS = 20;
const RENDER_SCALE = 2;

/**
 * PDFs often store common Han characters as look-alike Kangxi radicals (U+2F00-2FDF) or CJK radical
 * supplements (U+2E80-2EFF), e.g. "⼀" for "一". Fold only those blocks back to ordinary characters
 * so names and addresses match what the user sees.
 */
export function foldRadicals(text: string): string {
  return text.replace(/[\u2e80-\u2eff\u2f00-\u2fdf]/g, (ch) => ch.normalize('NFKC'));
}

export type PdfResult = { text: string; pages: number; ocrPages: number; truncated: boolean; engine: OcrEngine | null };

async function load() {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export async function pdfToText(
  data: ArrayBuffer, opts: { useNano: boolean; onProgress?: (page: number, pages: number) => void },
): Promise<PdfResult> {
  const pdfjs = await load();
  const base = `${import.meta.env.BASE_URL}pdfjs/`;
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${base}cmaps/`, // needed for CJK fonts
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
  });
  const doc = await task.promise;
  const total = doc.numPages;
  const pages = Math.min(total, MAX_PDF_PAGES);
  const parts: string[] = [];
  let ocrPages = 0;
  let engine: OcrEngine | null = null;
  try {
    for (let n = 1; n <= pages; n++) {
      opts.onProgress?.(n, pages);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      if (text.replace(/\s/g, '').length < MIN_TEXT_LAYER_CHARS) {
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not render page'))), 'image/png'));
        const r = await imageToText(blob, { useNano: opts.useNano });
        text = r.text;
        engine = r.engine;
        ocrPages++;
      }
      parts.push(foldRadicals(text).trim());
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { text: parts.filter(Boolean).join('\n\n'), pages, ocrPages, truncated: total > pages, engine };
}
