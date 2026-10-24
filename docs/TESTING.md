# PalAI Check â€” acceptance and integration checks

Status: NOT RUN. This file defines required verification; it is not a test report.

Run the project's actual typecheck/build and focused contract tests once implementation exists. Mock responses help frontend development but cannot establish live integration or provider accuracy.

## Test matrix

| ID | Check | Expected |
| --- | --- | --- |
| T01 | Tap a suggested inquiry twice rapidly | Full question sends once; one active request and answer |
| T02 | Ask a supported question and a contextual follow-up | Relevant real answer; conversation context retained |
| T03 | Ask equivalent English and Filipino questions | Equivalent supported guidance in selected language |
| T04 | Inspect a supported answer before touching sources | Small Reference button visible; page details hidden |
| T05 | Expand Reference with several cited pages | All supporting pages shown; no unrelated fabricated page |
| T06 | Select a page whose printed label differs from its PDF position | Actual correct physical page opens; labels are clear |
| T07 | Read/zoom page, navigate, close viewer | Chat scroll, draft, expansion and originating focus preserved |
| T08 | Verify cited claims against source passages | Evidence actually supports claims, including quantities/conditions |
| T09 | Ask an outside-document question | Consent prompt only; no general answer yet |
| T10 | Choose Cancel | No general generation; pending consent cleared |
| T11 | Choose Continue | Exactly one general reply, persistent red warning, no Reference |
| T12 | Replay stale/wrong pending ID or change question client-side | Backend rejects unauthorized or mismatched action |
| T13 | Ask supported question after a general answer | New grounding check; general history is not evidence |
| T14 | Ask a partly supported question | Grounded portion cites source; unsupported portion separately requests consent |
| T15 | Fail PDF retrieval/upstream request deliberately | Error/retry; no false outside-PDF classification |
| T16 | Take/upload a photo, preview, replace/remove, then send | Correct final photo reaches actual vision call; prior attachment not sent by mistake |
| T17 | Supply blurry/irrelevant photo | Honest limitation or clarification; no fabricated confident diagnosis |
| T18 | Supply oversized/unsupported image | Actionable validation; no ignored image reported as analyzed |
| T19 | Record English and Filipino/mixed speech | Actual Groq transcription; original language; editable before Send |
| T20 | Silence, denied microphone, failed transcription, recording cap | Clear states; no invented transcript; typed draft retained |
| T21 | Type while transcription is processing | Result does not overwrite farmer's concurrent typing |
| T22 | Retry after a failure; double tap Continue/Send | No duplicate completed answer or duplicate successful generation |
| T23 | Expire conversation/restart backend | Session error is explicit; no consent applied to another conversation |
| T24 | Narrow phone, open keyboard, long answer, PDF viewer | No horizontal page overflow or inaccessible primary controls |
| T25 | Keyboard/focus/labels/contrast | Controls operable; focus visible; warning has text/icon, not color alone |
| T26 | Inspect production bundle/config and deployed routes | No secrets, active fixtures, or backend tester exposed |
| T27 | Deployed real-device journey | API, photo, microphone and PDF all work over production HTTPS |
| T28 | Supported multi-page conclusion: can the recommended flowering water level help nutrient uptake, and what depth should be maintained? | Direct supported conclusion using p048-c01 (physical 48 / printed 43: appropriate water promotes nutrient uptake) and p050-c01 (50 / 45: maintain 5cm at flowering). Both references returned, collapsed in the final UI. No requirement for a verbatim complete-answer sentence, no page-combining/scenario-absence narration or outside-PDF consent. |
| T29 | Plausible conclusion with missing evidence link: does 5cm water at flowering allow fertilizer to be halved without reducing yield? | Do not invent fertilizer substitution, a 50% saving or a yield guarantee. The reviewed water-depth/uptake passages do not establish that link. Explain the evidence limitation; do not infer outside-PDF status from an unreviewed gap or generate a general answer without consent. |
| T30 | Repeat T28 in English/Filipino, including opposite-language questions and switching selection mid-conversation | Each new response follows explicit en/fil selection, preserves original history, retains the supported conclusion and all canonical pages, uses plain wording and avoids source-method narration in either language. |

## Focused automated checks

Backend owner implements tests for high-risk behavior:
- Consent pending state, Continue/Cancel, stale actions, and one-question scope.
- Evidence ID -> fixed document/page mapping and invalid citation rejection.
- Partial coverage and general-reference exclusion.
- Input validation, response schema and idempotent actions.
- Retrieval/provider failure remains an error rather than unsupported-topic classification.
- One conclusion can carry multiple supporting IDs/quotes; validate every premise, reject unreviewed/invalid IDs and invented quotes, and return the union of canonical supporting pages without losing or duplicating references.
- Keep related reviewed passages available together, including bridging evidence; never filter to an exact question/sentence or one page merely to fit the previous response format.

Frontend owner verifies reference expansion, page selection, consent controls and draft recovery using contract fixtures. Then run the same paths against the real backend.

Automated citation-ID checks do not establish semantic answer accuracy. The knowledge verifier must inspect representative answers against the document itself.

For T28-T30, compare the premise quotes and their relationship with the original PDF pages, not just response schema. True premises with a missing causal/quantity link do not establish the proposed conclusion. Record whether the comparison was AI-assisted or independently human-reviewed. The backend currently returns references; the collapsed production UI check remains frontend-owned and pending until implemented.

## Support-member workflow

Knowledge verifier: prepare source-pinned cases, inspect extracted tables/diagrams, check answer wording and references, and review bilingual meaning.

QA/demo supporter: test actual phones and deployment, report reproducible failures, keep the demo sequence ready. Report steps, input, expected result, actual result, device/browser and a screenshot without credentials.

Builders fix their own areas. Re-run affected checks and the main integrated journey after fixes; avoid broad optional testing while required failures remain.

## Results log

Record PASS / FAIL / BLOCKED, date, device, build revision, and concise evidence in the implementation's test report or PLAN.md verification fields. A command exit code does not prove camera behavior, citation accuracy or consent UI correctness.

Minimum final rehearsal: suggested inquiry -> grounded answer -> Reference -> exact page -> return -> photo/follow-up -> voice review/send -> outside-PDF Cancel -> Continue -> warned answer -> new grounded question.
