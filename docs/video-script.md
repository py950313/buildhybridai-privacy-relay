# Demo video script (target 2:50, hard limit 3:00)

Recording notes
- Screen: desktop Chrome at 1920x1080, browser zoom 125%, UI in English. Gemini Nano and the
  detection model already downloaded (do it the day before; the first download takes a while).
- Second device: iPhone with Safari, mirrored or filmed, for the cross-device segment.
- All text shown is synthetic. Paste it from the blocks below; do not type real names.
- Voice-over is written to be read at a calm pace (about 140 words per minute). Times are targets.

---

## 0:00 - 0:20 The problem

**Screen:** a chatbot tab with a work email pasted in, cursor hovering over "send". Freeze.

**Voice:** Every day people paste work email, contracts and health reports into AI chatbots. Those
texts carry names, phone numbers, ID and account numbers. Once you press send, they're on someone
else's server. Many people simply don't use AI for this work at all.

## 0:20 - 0:45 Local first: the device answers, nothing is sent

**Screen:** Stand-In. Point at the status bar: "Full: on-device AI + private detection".
Task "Rewrite", paste the short email, the badge shows "On this device". Press run. DevTools
Network panel docked at the bottom stays empty while the answer appears.

```
hi Karen, sorry for late reply. Tom Becker from Acme Logistics still didnt send the Q3 invoice, can u ping him at tom.becker@acme-logistics-demo.com or his cell +1 415 555 2671? we need it before friday. thx
```

**Voice:** Stand-In starts local. Short rewrites, summaries and translations run on Gemini
Nano, right in Chrome, through Firebase AI Logic. The network panel stays empty. Nothing left this
laptop.

## 0:45 - 1:35 When the cloud is needed: mask, check, send, restore

**Screen:** Scenario "Contract", paste the contract below. Press "Find private details".
The highlighted view appears: names, IBAN, emails, phone in colour with placeholders.
Click one item to show it can be kept in clear, click again to re-mask. Show the "Same as..."
merge menu briefly. Press "Send masked text". Answer appears with names restored (green).
Open the receipt: "Sent (exactly this)" shows only placeholders.

```
This Service Agreement is entered into on 3 March 2027 between Northwind Demo Ltd ("Client") and Priya Raman ("Consultant"). The Client will pay a fixed fee of $48,000 by bank transfer to IBAN GB82 WEST 1234 5698 7654 32 within 45 days. The Consultant is liable for all direct and indirect losses without limit. For 24 months after termination the Consultant will not work for any logistics company worldwide. Notices: legal@northwind-demo.com, priya.raman@consult-demo.io, +44 20 7946 0958. Signed: Mark Ellis, Director.
```

**Voice:** A contract review needs a bigger model, so it goes to Gemini in the cloud, but not as
is. Three detectors run on the device: pattern rules, a small PII model, and Gemini Nano for
meaning. You see every mark and can change any of them. Only the masked version is sent. The
answer comes back with placeholders, and they're turned back into the real names here, on your
device. The receipt shows exactly what left.

## 1:35 - 1:55 Proof, not promises

**Screen:** DevTools Network, select the request to firebasevertexai.googleapis.com, Payload tab,
Ctrl+F "Priya": no match. Search "[PERSON_1]": match.

**Voice:** Don't take our word for it. Here's the actual request. The name isn't in it. Only the
placeholder is. Our automated test does this check on every request, in ten different flows,
and fails if a single marked detail gets through.

## 1:55 - 2:20 Any device, any file

**Before recording:** this segment depends on the iPhone 15 test. If GLiNER does not run on the
phone, the status bar will show manual mode instead; then change the voice-over to "only fixed
formats are found automatically and you mark the rest" and do not claim on-phone detection.

**Screen:** iPhone Safari opens the same URL; status bar shows "Private detection" tier. Take a
photo of a printed health report (synthetic), the text is read on the phone, details marked,
"Health report" scenario shows the not-medical-advice notice. Quick cut back to desktop: switch UI
to 中文, choose "Copy and paste to any AI".

**Voice:** It works beyond Chrome. On an iPhone there's no on-device AI yet, so the text is always
masked first, but detection still runs on the phone. Photos and PDFs are read on the device too,
and the file is never uploaded. Prefer another chatbot? Copy the masked text anywhere and paste
the reply back.

## 2:20 - 2:45 Measured

**Screen:** the evaluation table from the README, highlighted rows.

| | Stand-In | Microsoft Presidio |
|---|---|---|
| English, 299 documents (NVIDIA Nemotron-PII) | 92.4% F1 | 83.8% |
| Traditional Chinese | 89.7% F1 | 72.4% |
| Phones, emails, IDs, cards, accounts found | 96.7% / 100% | 86.9% / 64.3% |

**Voice:** We measured it against Microsoft Presidio, a widely used open-source PII detector, on
held-out data. Stand-In finds more of the private details, in English and especially in
Chinese, and the full method and its limits are in the repository.

## 2:45 - 2:55 Close

**Screen:** logo / name, URL, GitHub link.

**Voice:** Stand-In. Use AI on private text, without giving the private parts away.
Built with Firebase AI Logic, Gemini Nano and Gemini.

---

Checklist before upload
- [ ] Under 3:00 total; YouTube visibility Public.
- [ ] No real personal data on screen (browser profile name, bookmarks, notifications, other tabs).
- [ ] Numbers on screen match `eval/report.md` at recording time. Do not claim higher precision:
      on the Chinese texts our precision (82.6%) is below Presidio's (90.4%).
- [ ] The iPhone segment matches what the phone actually showed.
- [x] Product name updated everywhere (Stand-In); the URL stays the same.
