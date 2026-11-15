# Prototype findings (#2)

Measured 2026-11-14 (UTC+8) on the dev machine: Windows 11, RTX 4070, 32 GB RAM, Chrome 157 / Edge 157.
Scripts live in `prototype/`. Sample set: `prototype/samples.json` (10 EN + 10 ZH synthetic sentences,
43 expected sensitive strings). Small samples: treat numbers as direction, not final; the formal
evaluation is #8.

| Item | Method | Result | Decision |
|---|---|---|---|
| Edge 157 stable | `prototype/probe-availability.mjs` | `LanguageModel` is undefined | Edge goes to the GLiNER tier |
| Chrome 157 Prompt API | same | API present; model reported `unavailable` under Playwright defaults | Playwright disables component updates and `OptimizationHints`; `prototype/chrome.mjs` removes those flags. Download in progress |
| OpenAI direct call | `prototype/probe-cors.mjs`, fake key | blocked by CORS (`TypeError: Failed to fetch`) | OpenAI: copy-paste mode only |
| xAI direct call | same | readable HTTP 400 | Direct call allowed |
| Anthropic direct call | same | readable 401 with `anthropic-dangerous-direct-browser-access: true`; blocked without it | Direct call allowed, header required |
| App Check provider | Google reCAPTCHA billing docs | Classic v3 is deprecated in the Firebase console; reCAPTCHA (Fraud Defense) Essentials tier needs no billing account, 10,000 assessments/month free | Use reCAPTCHA Enterprise provider and stay on Spark (keeps Gemini free tier, which requires Spark) |
| GLiNER PII int8 (349 MB), WASM | `prototype/gliner.html` via `run-gliner-bench.mjs` | load 45 s, ~0.4-0.5 s per sentence. Scores are compressed: @0.3 EN R0.50/P1.00, ZH R0.05; @0.02 EN R1.00/P0.67, ZH R0.95/P0.92 | Fallback only, with a low threshold (0.02) |
| GLiNER PII fp16 (580 MB), WebGPU | same | load 83 s (first download), ~0.16 s per sentence. @0.3 EN R1.00/P0.92, ZH R1.00/P0.81 | Default where WebGPU exists (desktop and iOS Safari 26) |
| GLiNER fp32 1.16 GB, bnb4, gliner_multi | same | not measured: background jobs were stopped for low system memory | Not needed: fp16 already meets the bar |
| gliner npm 0.0.19 multithreading | same | worker crashes (`Ui3 is not a function`) under Vite pre-bundling | Run single-threaded (`multiThread: false`) for now; revisit when building #3 |
| ZH false positives | fp16 @0.05 | 「我」「幫我」tagged as person, 「產品」as organization | Add a stop-list of pronouns/common words before masking |
| Tesseract.js 7 (chi_tra+eng) | `prototype/ocr.html`, 5 screenshots + 5 simulated phone photos | screenshots 13/13 strings read, ~0.15 s each; photos 10/13 | Usable. Photos: warn the user to review the confirmation screen; misread text can slip past detection |

## Gemini Nano (Chrome 157, isolated profile, `prototype/nano-bench.mjs`)

| Item | Result | Decision |
|---|---|---|
| Languages | `en`, `ja`, `es`, image: available. `zh`, `zh-Hant`: unavailable; `create()` with zh throws `NotSupportedError` | Declare by real language for en/ja/es |
| API names (2026) | `contextWindow` (was `inputQuota`), `measureContextUsage()` (was `measureInputUsage`), `contextUsage` | Use the new names |
| Context window | 9,216 tokens; ~18 tokens per 100 English chars; 6,806-token prompt OK, larger fails with `QuotaExceededError` | `local_route_max_tokens` = 3000 (leaves room for system prompt + output); detection chunk stays 1500 |
| EN semantic detection (JSON `responseConstraint`) | recall 0.955, precision 0.71, ~2.0 s per sentence | Main false positives: weekdays/dates tagged `DATE_OF_BIRTH` -> prompt + post-filter |
| Hallucination | For "summarize the attached notes" (no attachment) Nano invented a full meeting transcript with fake names; only 81% of returned items exist in the input | Confirms the design: never trust model offsets, locate every snippet by exact search, unlocated items go to the review list |
| ZH declared as `en` | recall 0.952, precision 0.955, ~2.0 s | User decision 2026-11-14: use as an extra layer unioned with GLiNER, behind Remote Config `nano_zh_detection_enabled`; ZH local answering stays off |
| Model download | ~4.0 GB in the profile; Playwright defaults block it | First-run UX in #4 must show progress; under Playwright use `prototype/chrome.mjs` |

Still open:
- GLiNER fp16 on iPhone 15 Safari: needs the user's phone.
- Gemini free-tier quota numbers for the chosen models.

## Detection engine end-to-end (#3, 2026-11-15)

`src/detect` with the real models on the same 20 samples (`prototype/detect-bench.ts`, run by
`prototype/run-detect-bench.mjs`). Stricter scoring than the tables above: an expected string
counts only if one mention covers all of it (a partial address is a miss). GLiNER loaded fp16 on
WebGPU. Nano numbers vary between runs (precision 0.846-0.88 on EN).

| Layers | EN recall / precision | ZH recall / precision | Median per sample |
|---|---|---|---|
| regex only | 0.18 / 1.00 | 0.29 / 1.00 | <1 ms |
| regex + GLiNER | 1.00 / 0.92 | 0.90 / 0.95 | ~0.12 s |
| regex + GLiNER + Nano | 1.00 / 0.85 | 0.95 / 0.91 | ~1.4 s |

First run misses: ZH date of birth in ROC calendar (「民國七十三年三月十二日生」) missed by every layer;
ZH full address only partly covered by GLiNER. Fixed with two regex recognizers (user decision
2026-11-15): dates of birth with a birth word nearby (西元, 民國, Chinese numerals, English
months; a 「生」 right after the date counts) and Taiwan street addresses anchored on the 22
county/city names and ending at 號 (addresses without a city stay with the model layers).

| Layers (after the fix) | EN recall / precision | ZH recall / precision |
|---|---|---|
| regex only | 0.23 / 1.00 | 0.38 / 1.00 |
| regex + GLiNER | 1.00 / 0.92 | 1.00 / 0.95 |
| regex + GLiNER + Nano | 1.00 / 0.88 | 1.00 / 0.88 |

Remaining false positives: "email", "We", 「訂金」 (GLiNER); whole non-sensitive sentences tagged
OTHER by Nano. No Nano item ended up unlocated on these samples.
