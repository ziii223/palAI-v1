# Expanded source review

2026-10-24, Asia/Singapore. Review type: **AI-assisted source comparison**.
This is not independent human/agronomist certification or full-document review.

The reviewer compared each selected native-text passage with its full original
physical-page render, including heading, relevant conditions/numbers and visible
printed page label. Existing PDFium renders were reused for 38/40. The already
installed isolated PDFium environment rendered 22/36/39/48/50/59/60 at scale 1.8;
no dependency or skill was installed. Page 60 was inspected but not approved.
The canonical PDF hash was checked before rendering:
`17da4d5f11024a04230059b075072ad917f9c0e464c4fbd842a547f9f5fb2caa`.

## Approved scope

| Evidence ID | Physical / printed | Exact reviewed scope | Explicitly excluded |
| --- | --- | --- | --- |
| p022-c01 | 22 / 17 | Heading and importance list for a well-leveled field | Photo interpretation, preparation steps, 5% yield claim, quantitative assessment |
| p036-c01 | 36 / 31 | Nutrient-importance prose and heading defining early panicle initiation | Photo interpretation, fertilizer rates, a confirmed crop diagnosis |
| p038-c01 | 38 / 33 | Existing LCC definition, unchanged | Plant diagnostic diagram, other tools/illustrations |
| p039-c01 | 39 / 34 | Right element, amount and timing of fertilizer application | Tool images, nitrogen-benefit list and any dose |
| p040-c01 | 40 / 35 | Existing nitrogen decision-tool and LCC timing/threshold excerpt, unchanged | Crop-image diagnosis and unselected symptom prose |
| p048-c01 | 48 / 43 | Water-management importance: consequences of insufficient/excessive water | Photo interpretation, assessment bullets and symptom thresholds |
| p050-c01 | 50 / 45 | Recommendations 3 and 4: 5cm at flowering; 5cm at ripening | Earlier-stage irrigation, drainage by soil/season, chart, controlled-irrigation instructions |
| p059-c01 | 59 / 54 | Recommendations 1 and 2: drain 1-2 weeks before expected harvest; golden-yellow maturity ranges | Diagram, moisture-meter images/captions, moisture ranges |

Included numerical statements were checked against visible prose, not inferred
from images: p040's every 7 days from 14 DAT or 21 DAS until early flowering,
and 6 or more of 10 leaves below 4 (TPR) or 3.5 (DWSR); p050's 5cm for both
named stages; p059's 1-2 weeks, 85-90% manual and 90-95% combine harvesting.
The p059 line wrap `85-\n90%` is preserved in reviewed text. No operators,
quantities or table relationships were repaired or silently normalized.

## Structure and remaining quality limits

reviewed-evidence.json contains eight source-hash-pinned entries with canonical
document ID, evidence ID, physical page, printed label, section, original/reviewed
text hashes, exact contiguous reviewedText, verified_excerpt status, reviewer type,
method, scope/review notes and empty correctionNotes. The original two LCC excerpts
retain their exact reviewed text and hashes; provenance/metadata were made explicit.

All entries remain within one physical page. Raw PDF, manifest, page/evidence
extraction and the 33-record flagged audit were preserved. None of those 33 flagged
records is approved. Harvest guidance comes from unflagged p059, not the problematic
operator/loss text on p058. There are 97 records with no approved excerpt and seven
partly reviewed records; p036's native text body is fully included, which still
does not approve its photo. No chapter or page image is certified wholesale.

All eight excerpts are sent together, with canonical tags and coverage-only counts
for excluded content. Adding another conforming review entry does not require
topic-specific code, an exact question string or a new keyword rule. The loader
validates its original/source/text hashes and physical/printed metadata. A focused
temporary-fixture test proves a ninth record can load and a wrong page is rejected.

Missing extracted text and excluded evidence are not proof of absence from the
PDF. Comparison-glyph issues, tables/merged cells, image diagrams and the known
Annex cross-reference discrepancy remain as documented in extraction-report.md
and flagged-record-review.json. No in-app page-review action exists or is offered.

## Context and actual model verification

Reviewed text including separators: 2,807 UTF-8 bytes. Complete source JSON:
6,155 UTF-8 bytes, including all eight tagged excerpts and the coverage inventory.
No source context was truncated and no retrieval index was added.

Authenticated model metadata returned deepseek-flash, context_window 1,048,576
and max_output_tokens 393,216. Our requests kept the existing 900-token output cap,
thinking disabled and 30-second timeout. The observed whole-request prompt usage
was 2,566-2,610 tokens, including instructions, source and any conversation history;
this is not estimated from characters or asserted to be source-only token usage.
Even maximum observed input plus the 900-token output cap fits that observed budget.
The [official model documentation](https://api-docs.deepseek.com/api/list-models/)
defines context_window as the combined input/output capacity.

Five live cases, all upstream/API HTTP 200, no retries:

| Case | Kind and AI-assisted support comparison | Actual cited physical / printed pages | Prompt / completion / total | API / HTTP ms |
| --- | --- | --- | --- | --- |
| Harvest readiness, Tagalog input / English selection | Golden yellow 85-90% for manual harvest matches p059 recommendation 2 | 59 / 54 | 2576 / 84 / 2660 | 1299 / 1308 |
| Flowering water depth, English input / Filipino selection | 5cm at flowering matches p050 recommendation 3 | 50 / 45 | 2566 / 65 / 2631 | 1040 / 1044 |
| Ripening follow-up, switch to English | 5cm at ripening matches p050 recommendation 4; drain 1-2 weeks matches p059 recommendation 1 | 50 / 45 and 59 / 54 | 2610 / 100 / 2710 | 1061 / 1079 |
| Vague farmer concern, Filipino selection | Asks what problem was noticed; water and fertilizer examples can lead to reviewed assessment; no diagnosis/treatment | No invented reference | 2566 / 54 / 2620 | 1437 / 1442 |
| Unreviewed variety table | Honest localized evidence limitation, no fabricated yield, outside-PDF declaration, review action or general answer | No invented reference | 2571 / 8 / 2579 | 702 / 720 |

Total: 12,889 prompt + 311 completion = 13,200 tokens. Provider latency was not
separately collected by this new runner; API elapsed includes local work and
provider time. Detailed sanitized requests/responses, UTC timestamps, local request
IDs, provider response IDs and usage are in
dev/backend-tester/expanded-smoke-results.json. They contain only synthetic test
questions and are development evidence, not browser fixtures or runtime fallbacks.

The source-limitation text is local wording chosen after a real DeepSeek
source_limitation decision; its trace has responseOrigin=local and
upstreamAttempted=true. Unrelated non-rice requests have a separate localized
scope response with no general answer or consent. Technical failures remain
non-2xx errors. New English/Filipino selection, original history preservation,
language validation, plain-language checks and idempotency regression tests remain.
