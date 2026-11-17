# Detection evaluation: method

Results are in [`report.md`](report.md). This file says how they were produced and what they do
and do not show.

## What is compared

| System | Setup |
|---|---|
| Presidio | `presidio-analyzer` with its predefined recognizers and spaCy `en_core_web_lg` / `zh_core_web_lg`. Two settings favour it: `ORGANIZATION` is enabled (off by default) and Taiwan is added to the phone regions. |
| Ours: rules only | `src/detect/regex.ts` alone (what manual mode finds automatically). |
| Ours: rules + GLiNER | Rules plus `onnx-community/gliner_multi_pii-v1` (fp16, WebGPU). This is what every browser gets. |
| Ours: rules + GLiNER + Gemini Nano | The full tier in desktop Chrome. Nano takes over ten seconds per document, so this row is run on the first 100 English documents only and is not directly comparable with the 300-document rows. |

Our engine runs in real Chrome through the dev-only page `eval/web/` driven by Playwright
(`run_engine.mjs`), i.e. the same code and models the app uses.

## Data

- **English**: [NVIDIA Nemotron-PII](https://huggingface.co/datasets/nvidia/Nemotron-PII), CC-BY-4.0,
  synthetic documents with character-level spans. 300 documents sampled from the **test** split with
  a fixed seed. PIIBench, named in the original plan, was not used: it merges ten sources, some
  under non-commercial licences, and states no licence for the merged corpus.
- **Traditional Chinese**: 30 synthetic samples written for this project (`zh_samples.json`), covering
  work mail, HR, contracts, finance, health and customer service. All names and numbers are made up.
  The planned 10 image/PDF samples are not included yet (image and PDF input is not built).

## Scoring

Labels are grouped into families shared by both systems (PERSON, ORG, LOCATION incl. addresses,
EMAIL, PHONE, ID_NUMBER, CARD, ACCOUNT, DOB; MEDICAL and FINANCIAL on the Chinese set).

- **Overlap**: a gold span is found when any prediction overlaps it. **Fully covered** additionally
  requires every character of the gold span to be inside predictions; for masking this is the
  number that matters, since a half-masked address still leaks.
- **Exact**: boundaries and family both equal the gold span. Presidio's `DATE_TIME` is accepted as a
  match for a date of birth.
- **Scope**: a dataset's scope is the set of families it annotates. Predictions of other families
  (our MEDICAL/FINANCIAL on Nemotron; Presidio's URL, IP and ordinary dates) are not scored unless
  they hit a gold span. Nemotron labels outside the families (dates, occupations, user names,
  passwords, device ids, customer/employee ids, and so on) are ignored for both systems: not
  counted as misses, and a prediction touching only them is not a false positive.
- Adjacent gold spans of one family (first name + last name; city, state) are merged before scoring.
- A prediction contained in a longer prediction of the same system is dropped first.
- **Structured recall** = EMAIL, PHONE, ID_NUMBER, CARD, ACCOUNT.

## How the engine was tuned (read this before quoting numbers)

1. First run on the English test sample, rules + GLiNER: overlap F1 66.5% against Presidio's 80.1%
   (as scored then, before the scope rule). The two gaps were US-style identifiers (ID_NUMBER
   recall 11.8%) and precision (56.4%).
2. All tuning was then done on a separate **dev sample** (300 documents from the **train** split,
   different seed), using `analyze.py` and `scores.py`. Changes: finer GLiNER labels (first/last
   name, city, state, country, postal code, several id-number labels); filters for role nouns,
   field labels and digit-less "numbers"; a 0.9 score threshold for the generic `person` and
   `organization` labels on Latin-script text; rules for US SSN, SWIFT/BIC and routing numbers.
3. The test sample was re-run once after those changes. The individual test documents were never
   inspected; only the aggregate tables were.
4. The scope rule above was introduced at the same time. It raises both systems' precision
   (Presidio 76.4% -> 83.5%); the comparison in `report.md` uses it for both.
5. **Chinese has no dev split.** After the first Chinese run (structured recall 92.9%: an employee
   number and a passport number were missed) a keyword-anchored id rule was added, which brought
   structured recall to 100%. That number is therefore tuned on the test samples and is optimistic.
   The Chinese set is also small and written by the same author as the rules.

## What the numbers do not show

- Synthetic text. Real user input is messier (typos, mixed languages, OCR errors).
- 300 English documents and 30 Chinese samples: differences of a few points are within noise.
- Presidio can be extended with custom recognizers; this compares against its stock configuration.
- GLiNER scores come from the fp16/WebGPU variant. Devices that fall back to int8 will differ.

## Coverage against HIPAA Safe Harbor identifiers and Taiwan PDPA

"Detected" means a rule or a model label targets it; it is not a guarantee of recall.

| HIPAA Safe Harbor identifier | Our type | How |
|---|---|---|
| Names | PERSON | GLiNER, Nano |
| Geographic units smaller than a state | ADDRESS, LOCATION | Taiwan address rule; GLiNER (address, city, postal code) |
| Dates related to an individual | DATE_OF_BIRTH | Birth dates only (rule + GLiNER). Admission, discharge and death dates are **not** masked |
| Telephone numbers | PHONE | Rules (Taiwan, E.164); GLiNER |
| Fax numbers | PHONE | GLiNER (as phone) |
| Email addresses | EMAIL | Rule |
| Social Security numbers | ID_NUMBER | Rule; GLiNER |
| Medical record numbers | ID_NUMBER | Keyword rule; GLiNER |
| Health plan beneficiary numbers | ID_NUMBER | GLiNER (health insurance id number) |
| Account numbers | ACCOUNT | Rules (IBAN, context-gated account, routing, SWIFT); GLiNER |
| Certificate / licence numbers | ID_NUMBER | GLiNER (license number) |
| Vehicle identifiers and plates | - | **Not covered** |
| Device identifiers and serial numbers | - | **Not covered** |
| Web URLs | - | **Not covered** |
| IP addresses | - | **Not covered** |
| Biometric identifiers | - | **Not covered** (text only) |
| Full-face photographs | - | **Not covered** (text only) |
| Any other unique identifying number | ID_NUMBER, OTHER | Keyword rule; manual marking |

| Taiwan PDPA (個人資料保護法 第 2 條) | Our type | How |
|---|---|---|
| 姓名 | PERSON | GLiNER, Nano |
| 出生年月日 | DATE_OF_BIRTH | Rule (西元, 民國, Chinese numerals); GLiNER |
| 國民身分證統一編號 | ID_NUMBER | Rule with checksum (also resident certificates) |
| 護照號碼 | ID_NUMBER | Keyword rule; GLiNER |
| 特徵、指紋 | - | **Not covered** (text only) |
| 婚姻、家庭 | OTHER | Nano only ("private personal situations"); not reliable |
| 教育、職業 | - | **Not covered** |
| 病歷、醫療、健康檢查 (第 6 條特種個資) | MEDICAL | GLiNER (medical condition), Nano. Lab values themselves are not masked |
| 基因、性生活、犯罪前科 (第 6 條) | OTHER | Nano only; not reliable |
| 聯絡方式 | PHONE, EMAIL, ADDRESS | Rules; GLiNER |
| 財務情況 | FINANCIAL, ACCOUNT, CARD | Rules (card, account); GLiNER (money) |
| 社會活動 | - | **Not covered** |

## Reproduce

```
cd eval
uv sync
uv run python prepare.py 300          # data/en.jsonl, data/zh.jsonl
uv run python prepare.py 300 --dev    # data/dev.jsonl (tuning only)
uv run python presidio_run.py en zh
cd .. && node eval/run_engine.mjs regex en zh && node eval/run_engine.mjs gliner en zh
LIMIT=100 node eval/run_engine.mjs full en zh    # needs Chrome with Gemini Nano downloaded
cd eval && uv run python score.py     # writes report.md
```
