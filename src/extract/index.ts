// File -> text on the device. The file is read into memory only: it is never uploaded, stored or
// sent anywhere; only the extracted text continues into detection and masking.
import { imageToText, type OcrEngine } from './ocr';
import { pdfToText } from './pdf';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf,.png,.jpg,.jpeg,.webp';

export type Extracted = {
  name: string;
  kind: 'image' | 'pdf';
  text: string;
  pages: number;
  ocrPages: number;
  engine: OcrEngine | null;
  /** Tesseract mean confidence 0-100 for a single image; null for PDFs and Nano. */
  confidence: number | null;
  truncated: boolean;
};

export class ExtractError extends Error {}

export function fileKind(file: { name: string; type: string }): 'image' | 'pdf' | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (/^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) return 'image';
  return null;
}

export async function extractFile(
  file: File, opts: { useNano: boolean; onProgress?: (page: number, pages: number) => void },
): Promise<Extracted> {
  const kind = fileKind(file);
  if (!kind) throw new ExtractError('Unsupported file type. Use a PNG, JPEG or WebP image, or a PDF.');
  if (file.size > MAX_FILE_BYTES) throw new ExtractError('File is larger than 20 MB.');
  if (kind === 'image') {
    const r = await imageToText(file, { useNano: opts.useNano });
    if (!r.text) throw new ExtractError('No text could be read from this image.');
    return { name: file.name, kind, text: r.text, pages: 1, ocrPages: 1, engine: r.engine, confidence: r.confidence, truncated: false };
  }
  let r;
  try {
    r = await pdfToText(await file.arrayBuffer(), opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ExtractError(/password/i.test(msg) ? 'This PDF is password-protected.' : 'This PDF could not be read.');
  }
  if (!r.text) throw new ExtractError('No text could be read from this PDF.');
  return { name: file.name, kind, confidence: null, ...r };
}
