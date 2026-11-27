# Devpost submission draft

Paste each section into the matching Devpost field.

## Project name

Stand-In

## Tagline (one line)

Use cloud AI on private text without handing over the private parts.

## Inspiration

People paste work email, contracts and health reports into chatbots every day. Those texts carry
names, phone numbers, ID numbers, bank accounts and diagnoses. The usual advice is "don't paste
private things", which people ignore because the cloud model is genuinely useful. We wanted the
useful part without the leak: let the device answer whatever it can, and when the cloud is needed,
send it only a version with the private details taken out.

## What it does

Stand-In runs in the browser between the user and the cloud model.

1. **If the device can answer, nothing leaves it.** Short rewrite, shorten, translate and summarize
   tasks run on Gemini Nano through Firebase AI Logic hybrid inference (`ONLY_ON_DEVICE`).
2. **Otherwise private details are found and masked on the device.** Pattern rules, an on-device PII
   model (GLiNER) and Gemini Nano mark names, organizations, contacts, IDs, accounts, dates of birth
   and addresses. The user reviews the marks (remove, merge, split or add), and only text like
   `Ask [PERSON_1] to call [PHONE_1]` goes to Gemini in the cloud (`ONLY_IN_CLOUD`).
3. **The reply is restored on the device.** Placeholders turn back into the real details locally.
   A placeholder the model altered is flagged, never guessed. A receipt shows exactly what was sent.

It also reads images and PDFs on the device (the file is never uploaded), keeps placeholders stable
across follow-up questions, offers three scenarios (work email, contract review, health report),
supports a user's own Claude or Grok key stored encrypted in the browser, and has a
"copy and paste to any AI" mode in which the app sends nothing at all. The UI is in English and
Traditional Chinese.

## How we built it

- **Firebase AI Logic** for hybrid inference: Gemini Nano on the device, downloaded with
  `initializeDeviceModel`, and Gemini in the cloud for masked text only.
- **App Check** with reCAPTCHA Enterprise protects the AI Logic endpoint.
- **Remote Config** holds the cloud model names, the local-route length limit, detection chunk
  sizes, per-scenario prompts and a switch for Chinese detection on Nano.
- **Anonymous Authentication + Firestore** store receipts with statistics only (counts per type,
  route, latency). Security rules reject any other field and every client read.
- **Hosting** serves the app with cross-origin isolation headers so the on-device models can use
  threads.
- Detection: deterministic rules (emails, phones, Taiwan IDs, cards, IBAN, accounts, dates,
  addresses), GLiNER via ONNX Runtime Web (fp16 on WebGPU, int8 on WASM as the fallback) and Gemini
  Nano; their results are merged and every original string is located by exact search.
- Image and PDF text: Tesseract.js and pdf.js on the device, with Gemini Nano as a fallback for
  noisy photos.
- Vite + TypeScript, 110 unit tests, Firestore rules tests, and an end-to-end privacy test that
  intercepts every network request and fails if a marked original appears in any of them.

## Challenges we ran into

- **Gemini Nano is not a drop-in OCR.** It skipped lines on dense pages, so we reversed the planned
  order: Tesseract first, a preprocessing retry when confidence is low, and Nano only as a fallback.
- **Testing on-device AI is awkward.** Playwright's bundled Chromium blocks Gemini Nano, so the
  end-to-end tests drive installed Chrome with an isolated profile that holds the model.
- **Chinese on Nano.** Declaring Chinese input made the on-device session fail, so Chinese
  detection declares English and is behind a Remote Config switch.
- **Detection quality differs by device.** GLiNER's fp16 model needs WebGPU; in Firefox it fails to
  start and the app falls back to int8, which is weaker on Chinese names. The confirm screen exists
  for exactly this reason: the user can always add what the detector missed.
- **Honest evaluation.** We tuned only on a dev sample and measured on held-out data, and we state
  where our numbers are optimistic.

## Accomplishments that we're proud of

On held-out data, against Microsoft Presidio with spaCy large models:

| Data | Ours overlap F1 | Presidio overlap F1 | Ours structured recall | Presidio structured recall |
|---|---|---|---|---|
| English, NVIDIA Nemotron-PII test split, 299 documents | 92.4% | 83.8% | 96.7% | 86.9% |
| Traditional Chinese, 30 synthetic texts | 89.7% | 72.4% | 100% | 64.3% |
| Traditional Chinese read from 10 images and PDFs | 78.9% | 60.5% | 100% | 70.0% |

The Chinese sets have no dev split and one Chinese rule was added after the first Chinese run, so
those numbers are optimistic. All data is synthetic. Full method and per-type tables are in
`eval/README.md` and `eval/report.md`, with a mapping to HIPAA Safe Harbor identifiers and
Taiwan's Personal Data Protection Act, including what is not covered.

## What we learned

- Local-first routing matters as much as masking: many everyday requests never need the cloud.
- Fixed formats are easy; names, companies and medical terms are where on-device models earn
  their place.
- A privacy claim needs a test that can fail, so ours checks real network payloads.

## What's next for Stand-In

- Test on real iPhone Safari and Android devices, and on release builds of Firefox and Safari.
- Make fp16 detection work on Firefox's WebGPU, or ship a stronger WASM model for Chinese.
- A browser extension so masking happens inside the chatbot pages people already use.
- Organization policies (which detail types must always be masked) delivered by Remote Config.

## Built with

firebase-ai-logic, gemini-nano, gemini, firebase-app-check, recaptcha-enterprise,
firebase-remote-config, firebase-authentication, cloud-firestore, firebase-hosting, gliner,
onnxruntime-web, tesseract.js, pdf.js, typescript, vite, playwright

## Links

- Live app: https://buildhybridai-2026-fdbba.web.app
- Code: https://github.com/py950313/buildhybridai-privacy-relay (Apache-2.0)
- Video: (YouTube link after recording)
