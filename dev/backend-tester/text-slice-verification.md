# Grounded text-slice verification

Date: 2026-10-24 (Asia/Singapore). Scope: BE-05, BE-06 text-only tester, BE-07 initial grounded text path. Backend Phase 1 is incomplete.

## Source and coverage

Fixed source SHA-256: `17da4d5f11024a04230059b075072ad917f9c0e464c4fbd842a547f9f5fb2caa`. All 108 physical pages remain in the exact canonical PDF. The raw PDF, manifest, pages.jsonl and evidence.jsonl are byte-identical to the pre-slice versions.

All 33 flagged records and their specific notes were inspected; flagged-record-review.json records each as withheld_not_verified. Two exact excerpts, not whole pages, were visually compared with the source renders and stored separately in reviewed-evidence.json:
- p038-c01: physical 38 / printed 33, only the LCC definition.
- p040-c01: physical 40 / printed 35, only the nitrogen-decision-tool and LCC timing/threshold paragraphs. The 7-day, 14 DAT, 21 DAS, six-of-ten, 4/3.5 conditions were checked visually and retained verbatim.

No operator, quantity or table relationship was normalized. The Annex 3a internal cross-reference discrepancy remains in the raw evidence and the withholding audit. The other 103 records, plus unselected content on pages 38/40, are not answer evidence. Coverage-only section/count metadata can signal source limitations but cannot support claims. This is not full-document coverage.

## Automated and live results

`npm run typecheck`: PASS. `npm run build`: PASS (includes typecheck and client/server emit). `npm test`: PASS, 16 focused tests. Ordinary tests use stub providers and make no paid calls. Covered: metadata and PDF bytes/MIME/hash, bad source hash, reviewed-only context, canonical references, duplicate IDs, follow-up history/language, source limitations, invalid/unreviewed IDs, unsupported quotes, forbidden general kinds, safe upstream failure/retry, in-flight conflicts, expiry, input validation, rate limits, malformed/truncated outputs, timeout handling and tester isolation.

`npm run smoke:text`: PASS, five real DeepSeek calls, no automatic retry. One additional real call was made through the browser tester to verify language selection/Send/rendering. Every request used deepseek-flash, JSON output, thinking disabled, a 900-token maximum and a 30-second upstream timeout. No model/provider/plan switch. The serialized supplied source context was 2,267 UTF-8 bytes, including two reviewed excerpts and explicit partial-coverage metadata. Token figures below are actual provider usage for the complete request, not character-based estimates or isolated evidence-token counts.

| Live test | HTTP | Provider / service / HTTP latency (ms) | Prompt / completion / total tokens | Result |
| --- | --- | --- | --- | --- |
| supported_en | 200 | 2330 / 2331 / 2347 | 1052 / 131 / 1183 | PASS: grounded |
| contextual_follow_up | 200 | 895 / 895 / 905 | 1108 / 70 / 1178 | PASS: grounded |
| equivalent_fil | 200 | 1099 / 1099 / 1114 | 1053 / 66 / 1119 | PASS: grounded |
| unreviewed_table | 200 | 441 / 441 / 458 | 1056 / 8 / 1064 | PASS: clarification |
| missing_crop_context | 200 | 896 / 897 / 913 | 1059 / 37 / 1096 | PASS: clarification |
| Browser language-selector / Send | 200 | 1373 / 1374 / not independently timed | 1048 / 70 / 1118 | PASS: real Filipino grounded answer |

Totals across six real generations: 6,376 prompt tokens, 382 completion tokens, 6,758 total tokens. No real provider error occurred. Upstream 503, 429, malformed output and timeout paths were deliberately simulated in focused tests; they were not presented as live outages.

## Manual semantic support checks

The actual successful answer texts were inspected against physical-page renders, not accepted solely because IDs/schema were valid:
- English answer: LCC visually assesses rice nitrogen status (p038); LCC results can be a basis for determining the amount of N to apply (p040). Both statements match the reviewed text; no fertilizer dose was invented.
- Contextual follow-up: every 7 days from 14 DAT or 21 DAS until early flowering. This matches p040 / printed 35, including the original conditions.
- Filipino equivalent: "Ang Leaf Color Chart (LCC) ay kagamitan para biswal na mataya ang nitrogen status ng palay." It preserves the p038 definition rather than inventing a diagnosis.
- Unreviewed variety-table question: returned a truthful source-review limitation, references empty and pendingGeneral null. It explicitly does not infer that the topic is outside PalayCheck.
- LCC reading 3.7 with missing context: asks whether the rice is transplanted or direct wet-seeded. That distinction is material to the reviewed thresholds; no nitrogen recommendation was issued before clarification.
- Browser answer: "Ang Leaf Color Chart (LCC) ay isang kasangkapan upang biswal na tasahin ang nitrogen status ng palay." Verified against p038; canonical reference is physical 38 / printed 33.

These checks establish support for the observed examples, not universal semantic correctness of arbitrary future model responses. The server validates approved IDs and exact supporting quotes; semantic claim verification still needs representative review as coverage grows.

## Tester and production verification

Launch from project root: `npm run dev:tester`. URL: http://127.0.0.1:3001/dev/backend-tester/ (PORT is configurable). This command runs the real backend and serves only the separate tester assets. It does not require Vite. Restart after changing source/configuration. API keys stay on the server.

Playwright browser checks passed: metadata display, Filipino selection, real Send, grounded answer, raw JSON, canonical reference link, PDF URL opening with #page=38, draft preservation during intentional offline failure, and New conversation clearing the conversation. Screenshot: output/playwright/backend-tester.png. The screenshot is the temporary tester, not the production UI.

Production `npm start` checks passed: compiled metadata endpoint, PDF application/pdf type and exact source SHA, frontend index, input-validation error, and HTTP 404 for tester/private paths. The production build contains neither tester assets nor a tester entry point. All verification servers and the task browser were stopped.

An initial favicon 404 was corrected with an inline data favicon. The intentional offline fetch error was expected and left the draft intact. Automatic approval review rejected recursive deletion of the temporary .playwright-cli cache with `blocked by policy`; no deletion workaround or permission change was attempted. The local cache remains and is ignored by Git.

## Remaining limits

Full source coverage, all 33 flagged records, photo/English/Filipino media smoke tests, media endpoints, full outside-PDF consent/general generation, production frontend integration, the full tester and deployment remain unfinished. Current session controls are bounded in-memory state (60-minute idle expiry, 500 sessions, 32 completed submissions per session, last six conversation turns, two concurrent generations); deployment-grade abuse controls/shared storage are later work. No agricultural guidance beyond the reviewed excerpts is supported by this slice.
