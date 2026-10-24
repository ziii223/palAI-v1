# Prepared PalayCheck source

`palaycheck.pdf` is the exact supplied 2020 Revised edition. Its SHA-256,
identity, physical page count, printed-label policy and extraction metrics live
in `manifest.json`. Replacing the PDF requires a new source review; the preparation
script rejects a different hash.

- `pages.jsonl`: 108 physical-page records, including raw native text, body text,
  printed and embedded labels, unverified table grids and extraction notes.
- `evidence.jsonl`: 105 nonempty page-local bodies with stable `pNNN-c01` IDs,
  source/text hashes, page metadata and grounding classifications.
- `verification.json`: integrity checks and representative visual page mappings.
- `extraction-report.md`: measured sizes, visual limitations and preparation notes.
- `reviewed-evidence.json`: separately reviewed, hash-pinned excerpts approved for
  the current text slice. Eight excerpts on physical pages 22, 36, 38, 39, 40,
  48, 50 and 59 have AI-assisted visual comparison notes. This is not an
  independent human/agronomist certification or full-document coverage.
  The raw records remain unchanged.
- `flagged-record-review.json`: inspection notes for all 33 flagged records;
  they remain withheld from answer support.

`native_text_only` describes extraction, not verified agricultural claim support.
Keep `requires_visual_review` and `non_substantive` records out of an automatic
grounding context until reviewed. A failed extraction is never proof that the
PDF does not cover a topic. The backend sends all approved excerpts together;
adding a hash-pinned, page-local review entry needs no per-topic code or exact
question match. server/source.ts validates its canonical metadata and hashes.
Unselected content on partially reviewed pages is still withheld.
For another passage, visually compare it with the original page, append its
canonical metadata/provenance/hash-pinned exact excerpt to reviewed-evidence.json,
and update that file's coverage statement. Restart the backend to reload the
review file; source data is cached per process. No topic-specific code is needed.

Preparation and verification scripts are in `server/scripts/`; install their
pinned `source-requirements.txt` in a Python virtual environment, then run from
the project root:

```powershell
python server/scripts/prepare_source.py
python server/scripts/verify_source.py
```

Never put private photo/audio samples in this source folder. Use the Git-ignored
`dev/provider-samples/` location and preserve actual media extensions.
