# Response-language verification

Recorded 2026-10-24, Asia/Singapore. Scope: response-language handling only.

## Reproduction and cause

A real POST /api/chat to the running tester with the synthetic question
"Para saan ginagamit ang Leaf Color Chart?", language `en`, a fresh submission
ID and no conversation returned HTTP 200 with:

> Ang Leaf Color Chart (LCC) ay isang kagamitan upang biswal na mataya ang nitrogen status ng palay.

Local request ID: `70949253-30f8-4386-aeb6-4f4cca1b6e9e`. This is a reproduced
failure, not an inferred selector bug. Its token usage was not captured here.

The actual selector options are English=`en` and Filipino=`fil`. The tester
captures that value at Send and puts it in the JSON language field. Backend
validation accepts only those two values. Language is part of the submission
fingerprint, and history retains original messages without a session language
override. Fixed source-limitation templates already index the current request
language correctly. No selector inversion or cross-language cache hit was found.

The old generation prompt only said "Answer language: English" beside the
source context, and output validation checked structure/evidence without checking
language. The backend therefore accepted the observed wrong-language output.
Question-language mirroring is consistent with this reproduction; the model's
internal reason cannot be established from its answer.

## Fix

- Explicit per-request instructions say the selection controls all new answers,
  clarifications and greetings, regardless of the question/history language.
  Reassert the current selection after history without changing any history text.
- Require and validate an internal model JSON `language` field for model-written
  text. This is not a shared API contract change; the field is not exposed in the
  ChatResponse. Mismatched/missing metadata fails before history/cache mutation,
  with no automatic rewrite or paid correction call. The fixed source_limitation
  result remains its existing exact kind-only shape and uses the selected template.
- Request plain words for planting methods and days after transplanting/sowing.
  Reject TPR/DWSR/DAT/DAS in farmer-facing text, while preserving internal source
  quotes, quantities, conditions, source bytes and evidence validation.
- Disable the tester language selector while a request is pending. A later change
  affects the next submission. New successful submissions get fresh IDs; an
  identical failed request retains its retry ID, including the captured language.

## Live verification after the fix

Three sequential requests through the actual development tester /api/chat route,
one anonymous conversation. deepseek-flash at api.deepseek.com, 900-token maximum,
30-second provider timeout, no retry/model switch. All upstream and API statuses
were 200. The earlier failing request makes four live requests total for this task.

| Case | Result | Returned text | Physical / printed page |
| --- | --- | --- | --- |
| Tagalog question, English selected | PASS: grounded English | The Leaf Color Chart is a tool used to visually assess the nitrogen status of the rice crop. | 38 / 33 |
| English question, switch to Filipino | PASS: grounded Filipino | Ang Leaf Color Chart ay ginagamit upang masuri sa pamamagitan ng paningin ang kalagayan ng nitroheno ng palay. | 38 / 33 |
| Switch back to English, ask for missing planting details | PASS: English clarification | Were your seedlings transplanted, or were the seeds sown directly into the field? | No invented reference |

The grounded statements were compared with the unchanged reviewed definition
p038-c01. Both retain its nitrogen-status meaning. The follow-up asks the planting
method needed to distinguish the existing p040-c01 conditions, without giving
premature fertilizer advice or using TPR/DWSR/DAT/DAS.

| UTC request timestamp | Local request ID | DeepSeek response ID | Prompt / completion / total tokens | Provider / HTTP elapsed ms |
| --- | --- | --- | --- | --- |
| 2026-10-24T12:03:10.265Z | 8ffde307-b028-4862-ad71-eaa0fa94c2eb | e28de04a-daaf-4155-9186-dcf66bd12980 | 1347 / 64 / 1411 | 817 / 897 |
| 2026-10-24T12:03:11.128Z | 5b9bf6b7-863c-425c-a42c-b6d75e24c200 | 721fac5d-e97c-427b-8108-4253d1bb1ef1 | 1378 / 78 / 1456 | 1043 / 1047 |
| 2026-10-24T12:03:12.186Z | 0603873b-4dc0-4f0d-b383-610f23b7e55b | 222edc2d-8b5b-4db4-ad9d-f11b12f9482c | 1437 / 28 / 1465 | 773 / 788 |

Post-fix usage totals: 4,162 prompt + 170 completion = 4,332 tokens, reported by
DeepSeek for whole requests. Counts are not estimated from character length.

## Focused checks and limits

`npm test`: PASS, 24 tests. `npm run typecheck`: PASS. `npm run build`: PASS.
New regression checks execute the actual tester script in a small mocked DOM to
inspect outgoing payloads and IDs. They cover English/Filipino mapping, pending
selector locking, identical retries, fresh IDs on changed language and new
successful submissions. HTTP tests cover language switching without history
translation, changed-language/payload ID rejection for new/existing conversations,
no caching on model-language mismatch, all supported model-written response kinds,
both fixed clarification templates, acronym rejection, and unchanged source quotes.
Ordinary tests use stubs; only the four requests described above were live.

No statistical language detector or general-answer translator was introduced.
The declared-language check cannot prove the language of arbitrary prose by
itself; the actual bilingual live responses were inspected. Technical error
messages retain their existing contract wording. Broader source review, media
tests and consent remain outside this change.

Before restarting PID 21988, verified its tester command, listener ownership,
served assets and canonical document hash against this project. Only that project
tester was stopped. The updated tester was restarted on port 3001 and left running.
Frontend files, shared contract/types, source PDF/reviewed evidence, environment,
package manifest and lockfile remained unchanged.
