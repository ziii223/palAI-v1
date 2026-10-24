# Source extraction report

Prepared 2026-10-24 (Asia/Singapore). This report concerns source preparation, not agricultural answering.

## Fixed document

- Title: PalayCheck System.
- Subtitle: For irrigated lowland rice (transplanted/ direct wet-seeded).
- Issuer: Philippine Rice Research Institute (PhilRice), Department of Agriculture.
- Edition/year: 2020 Revised edition; title and copyright verified on physical pages 3 and 4.
- Document ID: `palaycheck-2020-revised-17da4d5f1102`.
- Source bytes: 15,420,857 (14.71 MiB).
- Physical pages: 108 (all opened and rendered successfully).
- SHA-256: `17da4d5f11024a04230059b075072ad917f9c0e464c4fbd842a547f9f5fb2caa`.
- Canonical `palaycheck.pdf` is byte-identical to the user-supplied Downloads file. The original was preserved.

## Extraction and measured size

Native text was extracted with pdfplumber; pypdf independently checked page labels and the ASCII character inventory on every page. PDFium2 rendered the source because system Poppler utilities were unavailable. Python dependencies were installed in a temporary isolated virtual environment, not globally or in the Node package.

- Primary libraries: pdfplumber 0.11.10, pdfminer.six 20260107, pypdf 6.21.2, pypdfium2 5.14.0.
- Raw extracted text including native footer artifacts: 72,066 characters / 72,500 UTF-8 bytes (including page separators).
- Body text after exact footer removal and sideways-text coordinate handling: 71,853 characters / 72,287 UTF-8 bytes (70.6 KiB), 11,850 whitespace-separated words.
- Primary extraction/serialization run: 3.237 seconds locally. This is not provider latency.
- Records: 108 physical pages and 105 nonempty one-page bodies. Maximum passage size: 2,190 characters. No passage crosses a page.
- Classifications: 53 native_text_only; 33 requires_visual_review; 19 non_substantive. The native-text-only subset is 39,314 UTF-8 bytes with separators.
- No Unicode replacement characters in the primary body extraction. Private-use font symbols are retained and flagged; this does not mean all source content was extracted.

## Explicit coverage and quality limitations

1. The cover (physical 1) and back cover (108) are rasterized: their native text is only hidden footer artifacts. No OCR or fabricated replacement text was added. Physical 74 is a visually blank divider with printed 69; removing its footer correctly leaves no body passage. No evidence record is created for these three pages.
2. Raster content occurs on 66 pages. Photos and chart details are not converted into semantic evidence by caption extraction. Physical 72 / printed 67 is predominantly an image-based growth-stage chart; only its native title and DAS/DAT extract. Diagram axes, colors, shading and relationships require source inspection.
3. Thirteen sideways-text pages (72, 73, 95-105) were read using clockwise coordinate rotation without editing the PDF. The variety row on physical 96 / printed 91 was checked against its original rendered table. Wrapped headers, multiline values and merged cells still require review.
4. Ruled-table grids are retained as unverified candidates in original physical-page coordinates. Null cells remain null. Open borders and merged cells can omit first/last-column values; no row associations or fill-down values were guessed. Visually identified tables that defeat grid detection are separately flagged.
5. Comparison operators require review on physical pages 8, 41, 49, 53, 54, 58. In the pest tables, visible greater-than-or-equal signs can be composed of a greater-than character plus a separate underline. Plain extraction loses the equality bar. The extracted `>` was not silently changed to `>=`; affected evidence is quarantined for visual review.
6. The crop-stage assessment matrix on physical 73 / printed 68 has rotated headers and meaningful cell shading. Flattened text does not reliably encode these relationships.
7. A source-internal cross-reference discrepancy is preserved: physical 77 / printed 72 refers to Annex 4 as printed p. 72; Annex 4 actually starts on physical 79 / printed p. 74. Resolve future citations from canonical evidence metadata, never by treating internal page mentions as physical PDF positions.
8. Native text classification does not establish semantic support for a generated answer. Representative checks do not certify every numeric table entry. No source gap may be treated as proof that a farmer question is outside the PDF.

## Physical positions versus printed labels

Physical positions are 1-based. Embedded labels are i-v, then 1-103. Visible main-text numbering starts with physical 6 = printed 1. Physical 1, 2 and 108 have no visible printed label; their printedLabel is null even though embedded labels are i, ii and 103.

| Evidence ID | Physical PDF page | Printed label | Verified content | Classification |
| --- | --- | --- | --- | --- |
| p003-c01 | 3 | iii | 2020 Revised edition | non_substantive |
| p040-c01 | 40 | 35 | use LCC every 7 days | native_text_only |
| p053-c01 | 53 | 48 | Insect pest level associated with significant yield loss | requires_visual_review |
| p072-c01 | 72 | 67 | CROP MANAGEMENT AREA | requires_visual_review |
| p077-c01 | 77 | 72 | Schematic Guide for Monitoring Key | requires_visual_review |
| p096-c01 | 96 | 91 | PSB Rc 2 Nahalin 5.1 7.1 123 99 15 | requires_visual_review |

All 108 pages were rendered and inspected in overview contact sheets. Full-page images reviewed included physical 3, 4, 40, 53, 54, 72, 77, 96 and 108. These manual findings are tied to the fixed source hash. Temporary PNGs are outside product files.

## File structure

- manifest.json: source identity/hash, page count, sections, tool versions, exact data-file hashes/sizes and quality metrics.
- pages.jsonl: physical page metadata, rawText, footer-free text, orientation, image/table flags, unverified grid cells and notes.
- evidence.jsonl: evidenceId, documentId, sourceSha256, pdfPage, printedLabel, section, exact page-local text, textSha256, groundingStatus and extractionNotes.
- verification.json: all-source render/integrity checks and six representative evidence-to-page checks.
- server/scripts/prepare_source.py: deterministic extraction of this reviewed hash; refuses a different source. Does not call models or implement retrieval.
- server/scripts/verify_source.py: independent PDF character/page-label checks, file/text hashes, IDs, page boundaries, representative phrases and page rendering.

## Grounding recommendation

Start with full page-tagged text rather than a retrieval index: the entire native body is only about 71.9k characters / 70.6 KiB. Keep physical-page and evidence tags plus source-status flags. Exclude non-substantive and requires_visual_review records from automatic answering until curated; carry an explicit coverage-gap list so an extraction gap cannot trigger outside-PDF classification. Existing native-text-only content is small enough to be a simple initial context, subject to claim review. The missing diagrams and risky quantitative tables need manual verification or explicit page-image review before using their content.

This is a recommendation based on measured text size, not BE-04 completion. Model-specific token count and full-context latency were not measured. No prompt, answer generation, retrieval index or document endpoint was implemented.

## Media smoke tests

Photo, English recording and Filipino recording were all absent from dev/provider-samples/. All three tests are BLOCKED; no provider request, transcript, latency or error exists for them in this step. Provider keys are PRESENT (values never printed). The sample folder is now ignored by Git, including recordings and expected-phrase notes. Do not substitute PDF illustrations for the requested crop photo or fabricate audio.
