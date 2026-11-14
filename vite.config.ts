import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation lets onnxruntime-web use multithreaded WASM (SharedArrayBuffer).
// "credentialless" keeps cross-origin model downloads (Hugging Face) working without CORP headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // prototype/.profiles holds live Chrome profiles; watching them crashes with EBUSY on Windows.
  server: { headers: isolation, watch: { ignored: ['**/prototype/.profiles/**'] } },
  preview: { headers: isolation },
})
