# Backend handoff to frontend

Status: grounded text/source/document and one-question consent backend READY for integration, verified 2026-10-24
(Asia/Singapore). Production frontend remains the existing placeholder; FE-06 and
final in-app reference viewing are not implemented or claimed complete here.
The canonical shared interface remains docs/API_CONTRACT.md and shared/types.ts.
This file records actual current implementation and its limits, not a new contract.
The Phase 2 consent slice preserves the existing language and multi-passage safeguards.
The initial consent slice passed. The subsequent running-tester audit below fixes
a stale backend and a legacy prompt instruction, with actual browser verification.
BE-11 transcription and development recording/review controls are now implemented;
real English/Filipino speech acceptance remains UNVERIFIED without supplied recordings.
BE-10 photo validation/forwarding/context and tester controls are also implemented;
live crop-photo vision remains UNVERIFIED. See the latest photo section below.

## Start and connect

Run from `E:\APPS\CODING DL\PALAI\palAI check` with the existing Node 24.20.0
and installed dependencies. No installation was done for this change. A fresh
checkout can install the exact existing lockfile with npm ci; do not distribute .env.

| Purpose | Command | URL / settings |
| --- | --- | --- |
| Separate text/consent/audio backend tester | `npm run dev:tester` | http://127.0.0.1:3001/dev/backend-tester/ |
| API backend only, source watching | `npm run dev:server` | http://127.0.0.1:3001/api |
| Backend plus Vite frontend | `npm run dev` | http://127.0.0.1:5173; Vite proxies /api to 127.0.0.1:3001 |
| Typecheck / focused tests | `npm run typecheck` / `npm test` | No paid provider calls |
| Build and serve current production frontend | `npm run build`, then `npm start` | Port 3001, same-origin /api and PDF; tester absent |

Choose one backend command for port 3001 at a time. PORT comes from the backend
.env (currently 3001). Frontend fetches relative /api paths through the configured
Vite proxy, or the same origin in production. No CORS setup is needed for this
arrangement. The tester entry serves its own assets separately and needs no Vite.

Backend-only variables: DEEPSEEK_API_KEY and GROQ_API_KEY (both PRESENT locally;
values omitted), DEEPSEEK_MODEL=deepseek-flash, GROQ_STT_MODEL=whisper-large-v3-turbo,
PORT=3001. Environment loading preserves existing process variables. No provider
key belongs in frontend/VITE variables. .env and dev/provider-samples/ are Git-ignored.
Provider destination is https://api.deepseek.com/chat/completions, 900 output tokens,
30-second timeout, thinking disabled, JSON mode, no automatic retry/provider switch.

## Working endpoints and request lifecycle

- GET /api/health: HTTP 200, {"status":"ok"}. Liveness only, no billable call.
- GET /api/document: verified fixed-source metadata below.
- GET /api/document/pdf: exact canonical bytes, application/pdf, inline filename,
  SHA-256 ETag. A byte/hash/MIME/page-count check passed.
- POST /api/chat: text only; image must be null. All accepted new submissions reach
  DeepSeek unless a completed identical submission is replayed from the application
  cache. Requests conflicting with a pending consent action are rejected locally.
  A local source-limitation template is chosen after DeepSeek's decision;
  it does not mean the provider was skipped. Errors before generation are local.

New conversation: conversationId=null and a fresh crypto.randomUUID() submission ID.
Follow-ups: retain returned conversationId and allocate a new clientMessageId.
Retry the identical failed request with the same ID and unchanged language/payload.
Reusing a completed ID with changed language/message/image returns INVALID_REQUEST,
not another question's cached answer. A completed identical replay returns the same
response without billing again. One in-flight request per conversation; two upstream
calls globally; 32 completed submissions per conversation; 60-minute idle expiry;
500 active conversations; last 12 messages retained. Sessions are in memory and reset
on restart. No cross-tab/shared-server persistence is implemented.

English selection sends language=en; Filipino sends language=fil. The explicit
selection governs each new answer even if the question/history uses another language.
Keep existing messages unchanged. The backend checks model-declared language and
forbids TPR/DWSR/DAT/DAS in farmer-facing text. Exact supporting quotes stay internal
and retain the original source language. Model language metadata is not a public
ChatResponse field. Both language regression tests and live language switching passed.

## Actual request and response

These are captured live results with synthetic questions, not runtime fixtures.
Use fresh IDs when implementing; the recorded conversations belonged to an isolated
verification server that has stopped. IDs are opaque, not topic identifiers.

Harvest request (Tagalog question, English selected):

```json
{
  "conversationId": null,
  "clientMessageId": "d745993d-5770-4774-b5c8-ffd583bcca87",
  "language": "en",
  "message": "Kailan handa nang anihin ang palay kapag mano-mano ang pag-aani?",
  "image": null
}
```

Actual HTTP 200 response:

```json
{
  "conversationId": "5ee28f2a-ca6f-41a7-b646-a824bbc5a65e",
  "assistantMessage": {
    "id": "d92c09d2-227c-456c-b02f-19db66cc5a93",
    "kind": "grounded",
    "text": "For manual harvesting, harvest when 85-90% of the grains are golden yellow.",
    "references": [
      {
        "evidenceId": "p059-c01",
        "documentId": "palaycheck-2020-revised-17da4d5f1102",
        "pdfPage": 59,
        "printedLabel": "54",
        "section": "Harvest Management"
      }
    ]
  },
  "pendingGeneral": null
}
```

Water request (English question, Filipino selected):

```json
{
  "conversationId": null,
  "clientMessageId": "e92d5712-cd0a-4cbb-8129-4a9beb4ba6c9",
  "language": "fil",
  "message": "How deep should the water be while my rice is flowering?",
  "image": null
}
```

Actual HTTP 200 answer text: "Panatilihin ang 5 cm na lalim ng tubig sa yugto ng pamumulaklak.".
Its reference is p050-c01, physical PDF page 50, printed label 45, Water Management.

Contextual follow-up with the water conversationId and language=en:
"Paano naman kapag naghihinog na ang palay?".
Actual answer: "During the ripening stage, reach a 5 cm water level.\n\nDrain the field 1 to 2 weeks before the expected harvest date.".
This answer cites BOTH physical 50 / printed 45 and physical 59 / printed 54;
render every returned reference, not just the first.

Unreviewed variety-table request returns HTTP 200, kind=clarification, no references,
pendingGeneral=null and this actual text:

> I cannot yet verify an answer to that question from the reviewed PalayCheck passages available to me. Some pages, tables, and diagrams remain unreviewed. This does not mean your question is outside PalayCheck.

A vague concern receives a useful clarification when the answer can lead to reviewed
guidance. Missing farmer context is different from unavailable evidence. Clearly
unrelated non-agricultural requests now receive the exact consent prompt described
below. Source gaps are never proof that a rice topic is outside PalayCheck. Technical
failures remain non-2xx and do not turn into an outside-document classification.
No in-app page-review request/action is available or suggested.

## Document and references

Request: GET /api/document. Recorded working response: HTTP 200 JSON:

```json
{
  "documentId": "palaycheck-2020-revised-17da4d5f1102",
  "title": "PalayCheck System",
  "edition": "2020 Revised edition",
  "pageCount": 108,
  "sha256": "17da4d5f11024a04230059b075072ad917f9c0e464c4fbd842a547f9f5fb2caa",
  "pdfUrl": "/api/document/pdf"
}
```

Source: PalayCheck System, Philippine Rice Research Institute (PhilRice), Department
of Agriculture, 2020 Revised edition; 108 physical pages. The PDF stays associated
with the manifest SHA-256. Client code must use returned pdfUrl; never infer a file
path from a title or use an unrelated/downloaded source.
GET /api/document/pdf returns HTTP 200, application/pdf, 15,420,857 canonical bytes;
its SHA-256 is the metadata hash above. These endpoint behaviors were verified by
the existing document tests/probes; the closeout revalidated source loading locally.

A reference contains evidenceId, documentId, pdfPage (1-based physical PDF position),
printedLabel (string or null), and section (string or null). The backend resolves these
from canonical metadata. Grounded answers have validated references; clarifications
and acknowledgements have no fabricated references. pendingGeneral is currently null.

An answer or one conclusion may combine several reviewed passages. Do not require
an exact matching sentence or one complete-answer page. The backend validates all
internal supporting premise IDs/quotes and returns their canonical reference union;
there is no public response-schema change. Answer text stays direct, without
page-combining or exact-scenario-absence narration. Show every supporting page in
the existing collapsed Reference feature. A missing essential evidence link remains
a limitation; a need to reason across pages is not an outside-PDF/consent trigger.

Use pdfPage to open the production in-app viewer, including PDF.js pageNumber.
Display printedLabel when available, distinguish it from physical position, and
handle null labels. For example, p059-c01 opens physical page 59 but displays printed
54. The tester link /api/document/pdf#page=59 is a development aid. The production
in-app viewer, reference expansion and chat-position preservation remain frontend-owned.

## Reviewed coverage and suggested inquiries

Eight approved page-local excerpts; review is explicitly **AI-assisted source
comparison**, not independent human/agronomist certification or full-document coverage.
All approved excerpts are supplied together for every new question. No exact phrase
or keyword whitelist is required, and no source text is silently truncated.
To approve another passage, add its visually compared, hash-pinned entry and update
the coverage statement in reviewed-evidence.json, then restart the backend. Source
loading is cached per process; no topic-specific code or shared API change is needed.

| Evidence ID | Physical / printed | Supported scope |
| --- | --- | --- |
| p022-c01 | 22 / 17 | Why field leveling helps crop/water/nutrient management |
| p036-c01 | 36 / 31 | Nutrient sufficiency/imbalance principles, no fertilizer dose |
| p038-c01 | 38 / 33 | Leaf Color Chart purpose |
| p039-c01 | 39 / 34 | Right fertilizer element, amount and timing |
| p040-c01 | 40 / 35 | Existing LCC monitoring/decision-tool and timing/threshold excerpt |
| p048-c01 | 48 / 43 | Effects of too little/too much water |
| p050-c01 | 50 / 45 | 5cm water at flowering and ripening only |
| p059-c01 | 59 / 54 | Golden-yellow harvest readiness, manual/combine conditions; drainage 1-2 weeks before expected harvest |

Source-verified suggested questions for frontend-owned inquiry data:

| Label EN / FIL | Exact question EN | Exact question FIL | Evidence |
| --- | --- | --- | --- |
| Harvest readiness / Kahandaan sa pag-aani | When are rice grains ready for manual harvesting? | Kailan handa nang anihin ang palay kapag mano-mano ang pag-aani? | p059-c01 |
| Water at flowering / Tubig sa pamumulaklak | How deep should the water be while my rice is flowering? | Gaano kalalim ang tubig habang namumulaklak ang palay? | p050-c01 |
| Leaf Color Chart / Leaf Color Chart | What is the Leaf Color Chart used for? | Para saan ginagamit ang Leaf Color Chart? | p038-c01 |
| Level field / Pantay na palayan | Why is a well-leveled field important? | Bakit mahalagang pantay ang lupa sa palayan? | p022-c01 |

The harvest/water cases were live-verified in the recorded expanded-evidence stage
on 2026-10-24. LCC was live-verified during
the preserved language work. Field-leveling support and both question formulations
were compared with the approved source in that stage; no additional paid field-leveling
case was run. Translations/source comparisons are AI-assisted. Suggested cards do
not alter provider routing: send their full question once through ordinary /api/chat.

There are 105 raw evidence records; 97 have no approved excerpt, and seven reviewed
records still have unselected native text. All 33 flagged records remain withheld.
Do not use omitted crop diagrams, pest/variety tables, operator issues or the known
Annex cross-reference discrepancy as answer evidence. Even p036's fully included
native text does not approve its photo. The model must explain limitations or ask
useful context questions, not offer an unavailable review action or silently use
outside knowledge.

## Evidence strategy, measurements and verification

Implemented strategy: send ALL eight reviewed page-tagged excerpts plus coverage
inventory together for every fresh text request. No retrieval index, exact-question
whitelist or source truncation is used. The loader accepts additional reviewed
records without topic code changes, validates canonical metadata/source/text hashes,
and withholds unapproved source content. Multi-passage support does not merge raw
page-local evidence. Cache replays do not make a new generation.

Phase 1 source context at those measurements: 6,155 UTF-8 bytes (current consent context: 8,588 below). Reviewed text plus
separators: 2,807 bytes. Recorded authenticated deepseek-flash metadata from the
expanded-evidence stage: 1,048,576-token combined input/output window and 393,216
maximum provider output tokens. Our configured cap is still 900 output tokens and
30 seconds, not that provider maximum. Tokens below are actual provider-returned
whole-request usage (instructions, evidence and history), not source-only counts
or a character-to-token estimate. No model metadata lookup or generation was rerun
for this closeout.

Latest measured behavior, after the preserved multi-passage fix
(synthesis-smoke-results.json, 2026-10-24T12:40:17.322Z):

| Case | Prompt / completion / total tokens | Provider / API / HTTP latency ms |
| --- | --- | --- |
| English multi-page answer | 2775 / 117 / 2892 | 1316 / 1331 / 1360 |
| Filipino multi-page answer | 2754 / 131 / 2885 | 1869 / 1870 / 1873 |
| Missing essential evidence link | 2756 / 8 / 2764 | 893 / 894 / 907 |

Latest batch total: 8,285 prompt + 256 completion = 8,541 tokens. All upstream/API
responses were 200, with actual DeepSeek response IDs. Both supported answers have
physical pages 48 and 50 / printed 43 and 45. The negative case is a source limitation,
not a fabricated fertilizer saving or a general answer. Initial overly strict
harness results and their offline correction remain recorded; captured outputs and
usage were not changed. Those two live language cases used independent conversations;
mid-conversation language selection is covered by the preserved focused tests.

Earlier expanded-coverage measurements (expanded-smoke-results.json,
2026-10-24T12:22:16.484Z), retained separately rather than presented as current-prompt
measurements:

| Case | Prompt / completion / total tokens | API / HTTP latency ms |
| --- | --- | --- |
| Harvest readiness | 2576 / 84 / 2660 | 1299 / 1308 |
| Flowering water depth | 2566 / 65 / 2631 | 1040 / 1044 |
| Contextual ripening follow-up | 2610 / 100 / 2710 | 1061 / 1079 |
| Vague concern | 2566 / 54 / 2620 | 1437 / 1442 |
| Unreviewed variety table | 2571 / 8 / 2579 | 702 / 720 |

Earlier batch total: 12,889 prompt + 311 completion = 13,200 tokens. All five cases
were source-checked and passed; upstream/API HTTP 200. Provider-only latency was
not separately collected by that runner. The observed request inputs plus the
900-token output cap fit the recorded model window; no silent truncation occurred.

Recommendation, distinct from implementation/measurement: retain this simple
reviewed-context strategy while it fits the measured budget and latency. The
source-preparation suggestion to supply more full-document text is not a claim
that unreviewed raw text is approved, nor a full-document latency/token test.
There is no evidence here that an index is needed. Future broader review or
retrieval work must preserve every essential supporting premise and quality gate.

Phase 1 recorded checks before the consent slice: npm test PASS (30 focused tests),
npm run typecheck PASS, npm run build PASS. Tests include the preserved language,
multi-passage, idempotency, source/hash/page and failure safeguards. Failure/timeout/
out-of-scope paths used injected tests, not additional paid live calls. This
earlier documentation-only closeout did not rerun them; the consent slice reran and expanded them to 38 below.

Auditable details: data/palaycheck/expanded-review-report.md,
dev/backend-tester/expanded-smoke-results.json and synthesis-smoke-results.json.
These are development evidence, never imported by server/ or src/.
Development-only tracing records local request
ID/UTC time, response origin, upstream status/response ID, model/tokens and elapsed
time, without question/media/source-content/key logging. Production does not enable it.

## Errors and unfinished paths

| Status / code | Frontend behavior |
| --- | --- |
| 400 INVALID_REQUEST | Correct invalid fields, language, unsupported image input or reused ID with changed payload; do not render a successful answer |
| 410 SESSION_EXPIRED | Start a new conversation explicitly; restart loses sessions |
| 409 REQUEST_IN_PROGRESS | Keep pending state; wait for the active submission |
| 422 INVALID_MODEL_RESPONSE | Evidence/structure/language/plain-word validation failed; keep draft and allow an explicit retry |
| 429 RATE_LIMITED | Respect Retry-After when returned; preserve draft |
| 503 SOURCE_NOT_READY | Source integrity/loading failure; no outside-PDF or consent conclusion |
| 502 UPSTREAM_UNAVAILABLE / 504 REQUEST_TIMEOUT | Technical failure; preserve draft, allow explicit retry; no fabricated answer |
| 413 IMAGE_TOO_LARGE | Request body too large; this slice accepts text only |
| 404 INVALID_REQUEST for unknown /api route | Route not implemented; do not treat as successful chat |

The common error body remains {error:{code,message,retryable}} with optional
Retry-After header. Existing technical error wording is English. Plain localized
assistant clarifications are a different successful response path.

POST /api/consent is implemented as described below. POST /api/transcribe is now
implemented; see the BE-11 section for validation, runtime prerequisites and live-test
limitations. The documented non-null image field on /api/chat is now implemented;
BE-06 photo controls are complete. See the latest photo section for limits and live-test status.
Photo, English audio and Filipino audio smoke tests remain BLOCKED: no sample files
exist in dev/provider-samples/. No photo result or transcript is fabricated.

## Phase 1 handoff status

| Task | Closeout status against the original criterion | Unmet requirement |
| --- | --- | --- |
| BE-01 | PARTIAL: React/Vite/Express scaffold, scripts, shared types and Vite API proxy verified; handoff ready | Freeze/share requirement is not complete: local Git has no commit/checkpoint or remote, and receipt of a shared baseline by the frontend builder is unverified. No delivery is claimed. |
| BE-02 | COMPLETE: ignored .env, blank-secret .env.example, local key presence confirmed without values | None for this criterion. Media functionality is separate. |
| BE-03 | COMPLETE with explicit quality limits: fixed PDF, page-local extraction, manifest/hash, edition/labels and reviewed artifacts exist | Full-document review is not claimed or required by this source-preparation criterion; flagged/unreviewed content stays withheld. |
| BE-04 | COMPLETE: implemented reviewed-context strategy selected and supported by measured size, returned tokens and latency | No claim that whole raw-document inference/retrieval was measured. |
| BE-05 | COMPLETE: canonical metadata and byte-identical PDF endpoints, positive page count, hash/MIME/page behavior verified | None for this criterion. Production in-app viewer is frontend-owned. |
| BE-06 | COMPLETE implementation: separate text/photo tester, question/language, Send, JSON, references, consent and audio review; excluded from production | Real vision/speech acceptance is tracked separately in BE-10/BE-11; final frontend integration is pending. |
| BE-07 | COMPLETE for the original first grounded text-chat criterion: real provider, canonical references, anonymous session/follow-up behavior verified | Media/general-answer paths are not included in this completion. |

Backend-owned open items are the BE-01 frozen/distributed baseline and the rest of
BE-06. Missing photo, English and Filipino recordings keep their three real media
smoke tests BLOCKED; place private samples at dev/provider-samples/photo.*, english.*
and filipino.* without changing their actual extensions. No media endpoints have been implemented.

Frontend-dependent items are baseline receipt confirmation, final API adapter/chat
integration (FE-06), reference expansion and in-app PDF viewing. src/main.tsx remains
a placeholder. The temporary tester is not final UI acceptance. The plan's actual-
frontend Phase 1 gate therefore remains PENDING, separately from completed backend
text tasks. No product-wide completion, deployment or real-phone verification is claimed.

Backend Phase 2 is IN PROGRESS: the consent/general text slice below is complete.
The formal Phase 1 baseline-sharing and final frontend integration gates remain
pending. Media acceptance still needs genuine samples and real provider verification.
Phase 3 has not started.

## One-question consent and general answers (2026-10-24)

The wire contract and shared types are unchanged. POST /api/consent now works.
The initial chat call is still an actual DeepSeek assessment, not a local keyword
router. It receives all eight approved excerpts, existing full-section coverage
counts and scope-discovery-only text from the canonical PDF title (physical 3 /
printed iii), contents (5 / v), and scope statement (9 / 4). Those three pages are
NOT newly approved answer evidence. Original data/PDF/review artifacts are unchanged.

AI-assisted visual comparison of these original pages verifies an irrigated lowland
rice crop-management source. The live outside example, "Why does the Moon have
phases?", requests unrelated astronomy knowledge. This boundary is based on stated
scope, not a missing keyword or the eight-excerpt review gap. Scope classification
is semantic model assessment, not a mechanical proof of absence. The conservative
implemented path offers consent only for clearly unrelated non-agricultural requests.
Rice/agriculture questions lacking reviewed support still receive source limitation;
there is no exhaustive full-document outside-classifier for those topics. Ambiguous
requests clarify; technical/source-loading failures remain non-2xx errors.

For a wholly unsupported request, chat returns kind=consent_prompt, references=[],
an opaque server pending ID and the exact outstanding question. English text:
"This is outside PalayCheck. Would you like a general AI answer?"
Filipino: "Hindi ito saklaw ng PalayCheck. Gusto mo bang magpatuloy sa pangkalahatang sagot ng AI?"
For a mixed request, chat returns the validated grounded portion, every canonical
reference, and pendingGeneral for ONLY the exact unsupported substring. Append the
same localized consent prompt below that answer. Do not replace the grounded answer.
The backend verifies the stored portion occurs in the current user request; the
model cannot silently substitute a different question. Each pending ID is random,
conversation-bound, single-use, and held in server memory.

Live English assessment example (fresh IDs required when testing):

```json
{"conversationId":null,"clientMessageId":"fresh-message-id","language":"en","message":"Why does the Moon have phases?","image":null}
```

Actual captured response is in dev/backend-tester/consent-smoke-results.json;
it contains kind=consent_prompt, the exact English prompt, references=[], and
pendingGeneral.question="Why does the Moon have phases?". No general answer is
returned before Continue. A mixed LCC/Moon request preserved p038-c01 (physical 38 /
printed 33) AND p040-c01 (40 / 35) while pendingGeneral held only the Moon question.
The LCC definition and nitrogen-amount decision-tool claims were compared with the
original page renders; the later water answer maps to p050-c01 (50 / 45, 5cm at flowering).

Send only these five fields to POST /api/consent, using returned IDs:

```json
{"conversationId":"returned-conversation-id","pendingId":"returned-pending-id","clientActionId":"fresh-action-id","decision":"continue","language":"fil"}
```

Actual Continue returned kind=general, references=[], pendingGeneral=null and a
Filipino explanation of lunar phases. Only the stored outstanding question reached
the separate general prompt: no source passages or grounded history. A fresh English
water question in that same conversation then returned ordinary grounded guidance.
General replies are stored with their kind/language separately from grounded history
and are never supplied as evidence or as assistant history to grounded generation.
Follow-ups must be assessed again; there is no conversation-wide general mode.

For Cancel, change decision to cancel with a fresh action ID. It returns kind=
acknowledgement, references=[], pendingGeneral=null and "General answer cancelled."
or "Kinansela ang pangkalahatang sagot." without a provider call.

- Retry the identical decision with the SAME clientActionId and unchanged pending ID,
  decision and language. Successful repeats return the identical cached response;
  there is no duplicate successful generation. In-flight actions return 409 REQUEST_IN_PROGRESS.
- Changed payload under the same action ID is 400 INVALID_CONSENT. Unknown extra
  fields (including a replacement question), missing fields and invalid enums are rejected.
- Wrong/cross-conversation/consumed pending IDs are 409 STALE_CONSENT; missing/expired
  conversations are 410 SESSION_EXPIRED. A different action ID cannot reuse a consumed pending.
  The exact completed action may still replay its original result without affecting a newer pending question.
- Provider/validation failure preserves pending state and does not add a successful
  answer/history entry. Retry the unchanged action explicitly, or Cancel with a new
  action ID. No automatic retry or successful-looking fallback is generated.
- A new chat submission while consent is pending is 409 CONSENT_PENDING. Sessions
  remain 60-minute idle, in-memory, one active action per conversation, two provider
  calls globally, 32 chat submissions, at most 64 distinct action IDs per session.
  Restart loses sessions/pending state; production persistence and abuse controls
  beyond these existing bounds are not claimed.

### Development tester

Start/restart `npm run dev:tester` from the project root, then open
http://127.0.0.1:3001/dev/backend-tester/ . If port 3001 already belongs to the old
project tester, stop that tester in its terminal first. The original consent slice
used an isolated server and left the old tester unchanged. The running-tester audit
below refreshed only the confirmed project process; it is now running on port 3001.
Refresh assets and start a new conversation after restarting.

Send the Moon question to test consent. Continue / Cancel (Magpatuloy / Kanselahin)
resolve that specific pending question. Buttons and the language selector lock while
a decision is processing; an unchanged retry reuses its action ID. Language can be
selected again before deciding. Each general card permanently carries red warning
text "This is outside PalayCheck PDF" or "Hindi ito saklaw ng PalayCheck PDF" in the
language captured for that action. Later language changes/messages do not rewrite
older warnings. General cards have no PDF reference links/control, even if a malformed
response were to include references. Mixed grounded cards retain their source links.
New conversation explicitly abandons local pending UI and starts a fresh server session.
The tester is still development-only; final frontend controls/viewer remain unverified.

### Actual measurements and checks

New record: dev/backend-tester/consent-smoke-results.json; runner:
`node --env-file-if-exists=.env --import tsx dev/backend-tester/smoke-consent.ts`.
Running that command makes up to five paid calls; it is not part of npm test.
The default real provider was deepseek-flash at api.deepseek.com, 900 output tokens,
30-second provider timeout, no automatic retries or provider/model switches.

| Live case | Prompt / completion / total tokens | Provider / handler latency (ms) | Result |
| --- | --- | --- | --- |
| Outside Moon question, English consent only | 3507 / 35 / 3542 | 898 / 898 | PASS |
| Mixed LCC + Moon, English grounded portion and pending | 3518 / 166 / 3684 | 1231 / 1232 | PASS |
| Continue, Filipino general answer | 149 / 243 / 392 | 3114 / 3114 | PASS |
| Return to water grounding, English selected, Tagalog question | 3573 / 60 / 3633 | 1183 / 1183 | PASS |
| Unreviewed PSB Rc 2 table, Filipino source limitation | 3517 / 8 / 3525 | 721 / 722 | PASS |

Total: 14,264 prompt + 512 completion = 14,776 returned tokens. Each actual upstream
HTTP status was 200 with a provider response ID. Cancel, Cancel replay and Continue
replay had upstreamAttempted=false, no usage/response ID, and 1ms local trace elapsed.
Trace IDs/status/usage are metadata only, without question/answer/secret logging.
The saved artifact contains only these explicit public synthetic questions/replies.

The current source-context JSON is 8,588 UTF-8 bytes; all eight reviewed excerpts are
still supplied together, without retrieval/truncation. Additional bytes are discovery
metadata, not expanded approved coverage. The four actual chat prompts used 3,507?3,573
tokens; the isolated general prompt used 149. These are measured usages, not character
estimates or whole-PDF benchmarks. Retaining all approved excerpts is still the simplest
current strategy; remeasure if source review grows. No full-document coverage claim.

`npm run typecheck`, `npm run build` and `npm test` PASS (38 tests: all prior 30 plus
8 consent/scope/tester checks). Automated coverage includes cancellation/no-call,
idempotency, pending conflicts, malformed/replacement/cross-session/stale/expired IDs,
concurrent duplicates, safe provider-failure retry, invalid general-language/reference
shape, partial-reference preservation, isolated general history, and localized persistent
warnings using the actual tester script in a small DOM harness. Provider failure/races
were injected in automated tests, not manufactured with extra paid failures. This is not
a real-browser/final-frontend acceptance claim or general-answer expert certification.

BE-08 (text decisions/partial coverage), BE-09 and BE-12 are complete for this slice.
BE-10/BE-11, BE-06 photo controls, all three missing media sample smoke tests, baseline
sharing/receipt, final frontend integration and Phase 3 remain pending or BLOCKED as
previously documented. No source evidence, media endpoint or production frontend was changed.

## Running-tester birthday consent fix (2026-10-24)

Both reported failures reproduced in the actual browser. Served HTML/JS/CSS matched
current disk files, while Node PID 4252 (started 12:43:52 UTC) predated consent code.
POST /api/consent returned 404. That stale backend returned the old refusal or only
the grounded LCC part, always with pendingGeneral=null. The tester consequently had
no pending action to render; its rendering code already supported mixed answers.

Current disk code also retained a conflicting FINAL system instruction asking for
legacy kind=outside_scope, with validation converting it to the retired refusal.
Both instruction and refusal branch are removed. Legacy-only output now fails with
422 INVALID_MODEL_RESPONSE, rather than silently refusing or creating unverified
consent. Writing a greeting for someone else is distinguished from greeting the
assistant. Grounding, source-quality, language and idempotency rules are preserved.

Only the confirmed project process was stopped, after checking its command, listener,
canonical source and exact served asset hashes. Restarted with npm run dev:tester.
Current PID 6340, health=ok, matching assets; empty consent probe now returns 400
INVALID_CONSENT. LEFT RUNNING: http://127.0.0.1:3001/dev/backend-tester/ . Refresh an
older tab and start a new conversation because restart resets in-memory sessions.

Actual JSON transitions (full literal responses, IDs and text are saved in
dev/backend-tester/consent-running-verification.json):

| Exact request | Before | After |
| --- | --- | --- |
| Write a short birthday greeting for my friend. | kind=clarification; old refusal; references=[]; pendingGeneral=null | kind=consent_prompt; exact English consent text; references=[]; pendingGeneral holds an opaque ID and the exact question; visible Continue/Cancel |
| Explain what the Leaf Color Chart is used for, and write a birthday greeting for my friend. | kind=grounded with LCC references; pendingGeneral=null | kind=grounded with p038-c01 (physical 38/printed 33) and p040-c01 (40/35); pending question="write a birthday greeting for my friend"; exact consent prompt and both controls visibly alongside the grounded answer |

Browser Continue for the first request returned a real English birthday greeting,
kind=general, references=[], pendingGeneral=null. The card shows the exact persistent
red warning (computed rgb(176,0,32)), no PDF/source links, and keeps that earlier
warning when language selection changes to Filipino. Browser Cancel on the mixed
request, with Filipino selected before deciding, returned "Kinansela ang pangkalahatang
sagot." and retained the original grounded answer/source links. Its server trace
records no upstream attempt, null usage/response ID and 1ms local elapsed. These
accepted actions consumed actual server-held pending state, not just visible controls.

Both cases used fresh real browser conversations and tester-created fresh submission
UUIDs, without interception or fixtures. Screenshots:
output/playwright/consent-birthday-general.jpg and consent-mixed-cancel.jpg.
Browser tabs retained for inspection. This verifies the development tester, not the
final frontend. No tester asset change was necessary.

PASS: npm run build (including typecheck), npm test (39 tests). Focused regressions
reject obsolete output and exercise both exact requests in English/Filipino, final
prompt consistency, pending state, references and no-call cancellation. Existing
language, idempotency, multi-passage, failure and source-quality checks still pass.

Bounded live work: two before-refresh assessments and three post-refresh calls.
Old process usage was not captured. New calls used deepseek-flash, existing 900-token
output cap, 30-second provider timeout and no automatic retries:

| Case | Prompt / completion / total | Provider / handler ms |
| --- | --- | --- |
| Birthday consent assessment | 3631 / 37 / 3668 | 1038 / 1039 |
| Continue birthday greeting | 151 / 58 / 209 | 1189 / 1189 |
| Mixed LCC/birthday assessment | 3641 / 174 / 3815 | 1630 / 1631 |

Post-refresh total: 7,692 tokens (7,423 prompt + 269 completion), each upstream HTTP200
with an actual response ID. This is not an invented total for all five calls. Cancel
had no provider usage. Source context remains eight reviewed excerpts and 8,588-byte
source/discovery JSON; no source artifact or coverage changes.

Implementation changes: server/chat.ts and tests/text-chat.test.ts, plus PLAN.md,
this handoff and verification artifacts. Baseline sharing, final frontend integration,
blocked photo/audio samples, media endpoints and later phases remain unchanged.

## BE-11: transcription and development recording/review (2026-10-24)

Implementation and automated verification are complete. LIVE TRANSCRIPTION IS
UNVERIFIED: no real local English/Filipino recordings were supplied or found under
the project sample location. GROQ_API_KEY is PRESENT (value never displayed). No real
Groq request or successful speech transcript is claimed. Photo implementation is
recorded in the subsequent BE-10 section; this does not establish live vision.

The actual tester was refreshed after confirming PID 6340 by command, listener,
canonical source and exact asset hashes. Only that project process was stopped.
Replacement PID 8852 is LEFT RUNNING at http://127.0.0.1:3001/dev/backend-tester/ .
Health is OK; served index.html, tester.js and new audio.js hash-match disk. An empty
JSON probe now returns 400 INVALID_REQUEST, rather than the old 404. An invalid WAV
fixture returns 400 UNSUPPORTED_AUDIO before any provider call. The real browser
shows Record enabled, Stop/Transcribe initially disabled, elapsed timer, Cancel audio,
file picker, spoken-language selector and transcript-review area. No microphone was
opened and no chat generation occurred during these checks. Screenshot:
output/playwright/transcription-controls.jpg. Refresh any older tester tab before use.

### Request and response

POST /api/transcribe accepts multipart/form-data containing exactly:

- audio: one actual file, nonempty, maximum 10 MiB (10,485,760 bytes).
- language: en, fil or auto. This is the SPOKEN language, independent of answer language.

Browser adapter example (audioFile is a real File, not JSON/base64):

```js
const body = new FormData();
body.set('audio', audioFile, audioFile.name);
body.set('language', 'fil');
const response = await fetch('/api/transcribe', { method: 'POST', body });
```

Let the browser set Content-Type and its multipart boundary. Successful contract
shape is {"text":"<original-language transcript>"}; there is intentionally no invented
live-success example here. Transcription never creates/updates a chat conversation,
resolves consent, or generates a DeepSeek answer. Only explicit Send does chat.

Provider destination: https://api.groq.com/openai/v1/audio/transcriptions, configured
whisper-large-v3-turbo only, verbose_json and temperature=0. English passes en;
Filipino passes ISO language code tl; auto omits the language parameter. No translations
endpoint, forced-English conversion, vocabulary prompt, model switch or retry loop.
Original audio bytes are forwarded with a matching sanitized filename/MIME. Current
format/language fields were checked against [Groq speech-to-text documentation](https://console.groq.com/docs/speech-to-text).

### Validation and runtime prerequisites

Reuses the existing ffprobe and ffmpeg 9.0.2 binaries on PATH. No dependency/skill was
installed. A host running transcription needs both binaries available; missing tools
return controlled 503 UPSTREAM_UNAVAILABLE. npm test's decoder checks require them too.

- Supported audio-only containers: WebM, MP4/M4A, WAV, MP3 (including MPEG/MPGA names
  containing actual MP3 bytes), Ogg/Opus and FLAC. Browser recording chooses the first
  supported MediaRecorder candidate: WebM/Opus, MP4/AAC, Ogg/Opus, WebM or MP4.
- Real bytes, MIME and extension must agree. Empty/unknown files, renamed bytes,
  malformed containers, video and multiple audio tracks are rejected. Nonstandard
  containers/codecs that cannot decode in the installed FFmpeg are not silently accepted.
- Multipart parsing uses existing Express and Node APIs: bounded upload buffer,
  no new npm package. Whole-body limit is 10 MiB plus 64 KiB multipart overhead;
  actual audio-file size is separately checked against 10 MiB. Duplicate/extra fields
  and malformed boundaries are errors. Upload idle timeout is 15 seconds.
- FFprobe checks container/audio track metadata. FFmpeg fully decodes to 16kHz mono
  signed PCM with timestamp-gap resampling. Decoded size enforces 60 seconds even
  for WebM without duration metadata or a falsified shorter header. Known metadata
  durations over 60 seconds are rejected too. Each subprocess is limited to 10 seconds,
  with bounded output. Decoding is validation only; original uploaded bytes are sent.
- Near-digital silence is rejected locally. Blank provider text, empty segments or
  all segments marked high no-speech probability return EMPTY_TRANSCRIPT. This is a
  conservative silence/unusable-result check, not proof of speech or transcript accuracy.
  Noise, quiet voices, agriculture terms and mixed language need real sample testing.
- Two transcription jobs maximum per process. Provider timeout 30 seconds; failures
  do not retry automatically. 429 retains safe numeric Retry-After; raw provider errors
  never escape. Unsupported/invalid audio returns 400, oversize audio 413, empty speech
  400 EMPTY_TRANSCRIPT, provider failure 502/503, timeout 504 REQUEST_TIMEOUT.
- Uploads use random OS-temp directories, never client paths or Git. The single
  temporary file and directory are removed in finally on success/failure. Subprocess
  stderr, audio bytes, transcripts, keys and headers are never logged. A client-side
  cancellation may follow an already-sent Groq request; that call can still finish/bill,
  but its local result is discarded and backend cleanup runs within finite timeouts.

### Exact manual test steps

1. Start/restart with `npm run dev:tester` if it is not already running; open
   http://127.0.0.1:3001/dev/backend-tester/ and refresh. Do not run a second server on
   the same port. Spoken language defaults to Automatic detection.
2. Select English or Filipino under Spoken language. Press Record and allow microphone
   access for localhost. Say a short non-private phrase, for example "What is the Leaf
   Color Chart used for?" or "Para saan ginagamit ang Leaf Color Chart?". These are
   suggested phrases to record, not observed transcripts.
3. Press Stop, then listen to the preview. Stop/Cancel/page exit release microphone
   tracks. The timer auto-stops at 59 seconds to leave encoder-padding margin within
   the server's strict 60-second limit; background timer delays are still checked by
   the backend. Cancel audio discards the recording without transcription.
4. Press Transcribe audio once. This makes one Groq request; no chat is sent. On
   success the original-language text enters the editable Question draft if that
   draft was unchanged during transcription. Review and correct it yourself.
5. If you edited while waiting, your draft stays intact. The transcript remains in
   the review box; inspect it and explicitly choose Append transcript if wanted.
   No silent truncation: results over the 4000-character question limit stay in the
   review box for selecting a shorter question. Only explicit Send invokes chat.
6. Repeat with Filipino and with Automatic detection, comparing actual words with
   the recording. Record mistakes as returned; do not rewrite a failed result into
   a passing test. Report transcript, chosen language and any sanitized error.
7. Alternatively select an actual audio file, listen, choose spoken language and
   Transcribe audio. Preserve its real extension. Private optional samples may go in
   ignored dev/provider-samples/english.* and filipino.*; never commit recordings.

An explicit retry may incur another transcription charge: this contract has no
transcription idempotency ID. Buttons prevent concurrent duplicate clicks; there are
no automatic retries. This does not change chat/consent idempotency.

### Actual verification and remaining acceptance

`npm run build` (including typecheck) PASS; `npm test` PASS: 48 tests, including all
39 prior chat/consent/language/grounding regressions and 9 new transcription tests.
New tests use real local FFmpeg decoding of clearly synthetic validation tones,
never presented as speech or submitted to a real provider. Provider mocks are ONLY
automated failures: quota, outage, timeout, blank/unusable/malformed response.

Checks cover multipart/schema, byte/MIME/extension mismatch, empty/silent/corrupt
audio, exactly-10-MiB acceptance to a mocked outage, file and body oversize, over-60s
duration including a forged short WebM header, six supported containers, exact
unchanged provider-upload bytes/fields, en/tl/auto mapping, configuration failure,
concurrency release, no retry, sanitized errors and temp cleanup. UI-boundary tests
use explicitly named unit review text (no mocked successful provider transcript) to
check draft insertion/edits/append, no auto-Send, real MIME filename selection,
timer/Stop/Cancel and track release. Error cleanup is exercised; successful live
speech/cleanup and actual microphone capture await a real recording.

BE-11 is implemented but its full real-speech acceptance checkbox stays open. Live
English/Filipino audio smoke tests remain BLOCKED/UNVERIFIED, not passed. Final frontend
voice integration, photo handling, baseline sharing, broader source review and Phase 3
remain pending as before. Production frontend, evidence, shared contract, existing
chat/consent adapter and environment values were preserved.

## BE-10: photo input and active-photo context (2026-10-24)

Photo implementation and automated tests PASS. LIVE VISION IS UNVERIFIED: no real
non-sensitive crop photo was found at dev/provider-samples/photo.*. Existing screenshots
and design assets were deliberately excluded. No real DeepSeek image request, image
token usage, vision latency or successful crop interpretation is claimed this turn.

The configured model remains deepseek-flash. Its user-message text + image_url data-URL
format was checked against [official DeepSeek vision documentation](https://api-docs.deepseek.com/guides/vision/).
The adapter converts its internal attachment into actual content parts, not a filename,
text description or ignored property. Other configured models are rejected for images;
there is no silent model/provider switch or text-only fallback. Existing finite
30-second timeout, 900-output-token limit and no automatic retry remain unchanged.

### Existing chat contract, validation and privacy

No upload endpoint or shared type change. Send the documented image field with a
nonempty question to POST /api/chat:

```js
const request = {
  conversationId: null,
  clientMessageId: crypto.randomUUID(),
  language: 'en',
  message: 'What is visible in this crop photo, and what is the Leaf Color Chart used for?',
  image: { mimeType: 'image/jpeg', base64: actualBase64BytesWithoutDataUrlPrefix }
};
```

The variable above must contain actual image bytes; it is not a captured live result.
Server accepts JPEG/PNG/WebP only, at most 4 MiB decoded (4,194,304 bytes), 8192 pixels
per side and 16,777,216 pixels total. JSON body limit remains 8 MiB. Canonical base64,
exact shape, byte signature/container, declared MIME, actual codec and dimensions
are checked. FFprobe/FFmpeg fully decode still images with CRC/bitstream error checks;
truncation, corruption, animation and MIME mismatch are rejected. Validation processes
have 10-second time/output/allocation limits. Oversize is 413 IMAGE_TOO_LARGE; malformed
encoding/shape is 400 INVALID_REQUEST; unreadable images are 422 UNREADABLE_IMAGE.
Missing validation tools cause controlled 503, not an ignored attachment.

Both ffprobe and ffmpeg remain deployment prerequisites on PATH, as required for
transcription. Existing local version 9.0.2 was reused; no packages/tools were installed.
Image validation uses a random OS-temp file, then removes file/directory on success or
failure. Photo bytes, contents, request objects and credentials are never logged.
Development traces remain metadata only.

### Session, retry and evidence behavior

- One current photo per conversation, reused with the current question for follow-ups.
  New photos replace it only after a valid successful response. Failed replacements
  preserve the previous active photo; the draft attachment remains retryable.
- Old photo-related history/observations are removed on successful replacement, while
  other text history remains. Provider context identifies only the actual current
  photo. Historical image bytes never accumulate in model messages or result caches.
- At most 16 conversations with retained photos per process: at most 64 MiB of decoded
  equivalent bytes, plus base64 overhead. Existing session idle expiry/lazy pruning
  and restart clear state; two concurrent chat/provider requests remain the bound.
- The exact image is part of the submission fingerprint. An unchanged retry keeps its
  clientMessageId; changed question/language/photo needs a new ID. Completed identical
  replay is cached; failures do not become successful-looking responses.
- Every image-bearing model assessment must acknowledge the actual photo through an
  internal imageAssessment with selected language, status and observations. Missing
  assessment or a declared language mismatch fails 422 INVALID_MODEL_RESPONSE, rather
  than silently returning a text-only answer. This schema is not proof of real visual
  accuracy; that still requires a real crop-photo check.
- Tentative observations are displayed separately as "Visible in the photo (not a
  diagnosis)" / "Nakikita sa larawan (hindi ito diagnosis)". Grounded claims appear
  under "PalayCheck guidance" / "Gabay ng PalayCheck". Only the guidance claims resolve
  validated reviewed quotes/IDs into references; observations do not acquire citations.
  The prompt forbids confirmed diagnoses, inferred causes, calibrated leaf colors or
  photo-derived doses. Farmer reports and visible observations remain distinct inputs.
- Unclear photos can request a clearer crop photo or useful supported context. Missing
  or unreviewed rice evidence still returns source limitation, not outside-PDF consent.
  Genuine outside-scope portions retain the existing exact consent flow. Continue uses
  the stored question and the same current photo when present, never a replacement
  client question; general replies remain warned and reference-free. General content
  never becomes grounded evidence. Cancel makes no general call.

Citation/quote validation does not mechanically prove semantic entailment. Real photo
and source comparison must still verify any returned agricultural guidance; partial
review coverage remains eight excerpts, with all 33 flagged records withheld.

### Tester and exact manual photo steps

Only the confirmed project tester PID 8852 was stopped after command/listener/source/
asset checks. Final replacement PID 22132 is LEFT RUNNING at
http://127.0.0.1:3001/dev/backend-tester/ . Refresh an old tab and start a new conversation.
Current HTML/photo.js/tester.js/audio.js hash-match disk; health is OK. A malformed
image POST now returns 422 UNREADABLE_IMAGE with no upstream attempt. Consent and
transcription validation probes still return their expected 400 errors.

1. Select an actual non-sensitive JPEG, PNG or WebP crop photo, or use Take a photo
   on a supported phone. Do not select screenshots containing credentials. Optional
   private test photo belongs in ignored dev/provider-samples/photo.*.
2. Inspect the preview before sending. Replace using either picker or press Remove
   photo to remove the draft attachment. HEIC/SVG/GIF are not accepted: export a real
   supported format, never merely rename a file.
3. The browser applies EXIF orientation and encodes a JPEG preview with a white alpha
   background, at most 2048 pixels on its longest edge. It accepts source files up to
   32 MiB/64 million decoded pixels, uses three bounded compression attempts and
   refuses to send until a valid prepared photo fits 4 MiB. Preparation failures block
   Send until removed/replaced, never silently fall back to an earlier attachment.
4. Enter a nonempty question and choose response language. Suggested initial manual
   check: "What is visible in this crop photo, and what is the Leaf Color Chart used
   for?" Select Send explicitly. Compare tentative observations with the actual photo,
   and guidance with every cited original PDF page. Do not count schema success as
   proof that the photo was understood.
5. On failure, keep the photo/draft and retry unchanged to reuse the submission ID.
   Changing either creates a new submission. Selection/preparation itself never sends.
6. After success, the draft attachment clears; the server retains its current photo
   for relevant text follow-ups. A successfully sent new photo replaces it. Remove
   photo affects only a draft; New conversation clears server-photo context by
   starting a new session. The tester status explains this distinction.
7. Recording/Stop/Cancel/Transcribe and consent Continue/Cancel remain available. A
   transcript still requires review and explicit Send; it does not auto-send a photo.

### Actual verification

Build/typecheck and all 58 tests PASS (48 prior plus 10 photo tests). Tests use real
local image decoding of synthetic rectangles and explicitly mocked provider results;
they are NOT live vision evidence. Coverage includes byte/size/dimension/animation
rejection, exact user text/data-URL forwarding, image-capability rejection, required
photo assessment, English/Filipino metadata, unrelated/unreviewed citation rejection,
photo follow-ups/replacement/failure/retry/cache, bounded slots/expiry, photo consent,
no general-history leakage, privacy traces and tester attachment lifecycle.

Actual browser preparation checks used synthetic UI fixtures ONLY, never sent to
DeepSeek: an 80x40 JPEG with EXIF orientation 6 became an upright 40x80 prepared JPEG;
a replacement PNG became a 120x60 JPEG, and Remove hid/cleared it. Camera capture hint
is environment, Record remained enabled, and chat JSON stayed "No request yet.".
Screenshots: output/playwright/photo-orientation-preview.jpg and photo-controls.jpg.
No actual camera permission/capture or real crop interpretation was tested.

BE-06 tester implementation is complete. BE-10 real-vision and BE-11 real-speech
acceptance remain open/BLOCKED by missing media. Baseline sharing, final frontend
integration, source-review limits and deployment remain pending. No Phase 3 work.
