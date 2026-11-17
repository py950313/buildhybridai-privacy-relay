// Copies the pdf.js runtime assets (character maps for CJK PDFs, standard fonts, wasm decoders)
// into public/pdfjs so they are served from our own origin. Runs before dev and build.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist';
const dst = 'public/pdfjs';
mkdirSync(dst, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  if (existsSync(`${src}/${dir}`)) cpSync(`${src}/${dir}`, `${dst}/${dir}`, { recursive: true });
}
