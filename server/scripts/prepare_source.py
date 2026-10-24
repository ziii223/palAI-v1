"""Prepare the supplied PDF locally. Does not call providers or build retrieval."""

import argparse
from collections import Counter
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path
import platform
import time

import pdfplumber
from pdfplumber.utils import extract_text
from pypdf import PdfReader


EXPECTED_SHA256 = '17da4d5f11024a04230059b075072ad917f9c0e464c4fbd842a547f9f5fb2caa'
DOCUMENT_ID = 'palaycheck-2020-revised-17da4d5f1102'
# Verified against the contents and the corresponding section-opening pages.
SECTIONS = [
    (6, 7, 'Foreword'),
    (8, 8, 'Abbreviations, acronyms, and symbols used:'),
    (9, 16, 'The PalayCheck System'),
    (17, 20, 'Variety and Seed Selection'),
    (21, 24, 'Land Preparation'),
    (25, 34, 'Crop Establishment'),
    (35, 46, 'Nutrient Management'),
    (47, 50, 'Water Management'),
    (51, 56, 'Pest Management'),
    (57, 60, 'Harvest Management'),
    (61, 66, 'Postharvest Management'),
    (67, 74, 'Summary of Key Checks and Assessment, Monitoring, Analysis, and Improvement'),
    (75, 92, 'Annexes'),
    (93, 105, 'Appendices'),
]
NON_SUBSTANTIVE = {1, 2, 3, 4, 5, 17, 21, 25, 35, 47, 51, 57, 61, 67, 74, 75, 93, 94, 95, 106, 107, 108}
# The cover/back-cover raster overlays hide native footer text. Page 2 has no
# visible numeral. Embedded PDF labels are retained independently, never guessed.
NO_VISIBLE_LABEL = {1, 2, 108}
# Visually identified tables, including ones whose open/merged borders defeat
# grid detection. Decorative rectangles and photo panels are not treated as tables.
VISUAL_TABLE_PAGES = {30, 32, 33, 41, 42, 43, 44, 45, 53, 54, 56, 63, 73,
                      77, 78, 79, 89, 90, 92, 94, 95, *range(96, 106)}


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def clockwise_char(char, page_height):
    """Rotate character coordinates for sideways tables; source bytes stay exact."""
    result = dict(char)
    result.update(
        x0=page_height - char['bottom'], x1=page_height - char['top'],
        top=char['x0'], bottom=char['x1'], doctop=char['x0'],
        width=char['bottom'] - char['top'], height=char['x1'] - char['x0'],
        upright=True,
    )
    return result


def extract_page(page, embedded_label):
    raw = page.extract_text(x_tolerance=2, y_tolerance=3) or ''
    words = page.extract_words(x_tolerance=2, y_tolerance=3)
    footers = [word for word in words
               if word['text'] == embedded_label and word['upright']
               and word['top'] >= page.height - 36]
    chars = [char for char in page.chars if not any(
        word['x0'] - .1 <= (char['x0'] + char['x1']) / 2 <= word['x1'] + .1
        and word['top'] - .1 <= (char['top'] + char['bottom']) / 2 <= word['bottom'] + .1
        for word in footers)]
    rotated = sum(not char['upright'] for char in chars)
    rotated_page = bool(chars) and rotated / len(chars) > .8
    ordered_chars = [clockwise_char(char, page.height) for char in chars] if rotated_page else chars
    body = (extract_text(ordered_chars, x_tolerance=2, y_tolerance=3) or '').strip()
    # Only whitespace may be inserted/dropped when assembling native characters.
    assert Counter(c for c in body if not c.isspace()) == Counter(
        c for char in chars for c in char['text'] if not c.isspace())
    tables = []
    for table in page.find_tables():
        cells = table.extract(line_dir_rotated='ltr', char_dir_rotated='btt')
        if len(page.lines) >= 8 and len(cells) >= 2 and max(map(len, cells), default=0) >= 2:
            tables.append({
                'bbox': [round(n, 4) for n in table.bbox],
                'rows': cells,
                'status': 'unverified_native_grid',
                'note': 'Original page coordinates; merged cells and orientation are not reconstructed. Null cells are not inferred.',
            })
    notes = []
    if page.images:
        notes.append('Raster images/photographs/diagram contents are not transcribed by native text extraction; captions alone do not describe all visual evidence.')
    if rotated_page:
        notes.append('Reading coordinates rotated clockwise 90 degrees; original rawText retained. Multiline table headers/cells can still interleave.')
    if tables or page.page_number in VISUAL_TABLE_PAGES:
        notes.append('Table candidate: flattened reading order and unverified cell grid may lose row/column associations or merged-cell text. Review the source before using table values.')
    if '>' in body or '<' in body:
        notes.append('Comparison glyphs require review: visible greater-than-or-equal signs can extract as > with a separate vector underline. No operator was silently repaired.')
    if any(0xE000 <= ord(c) <= 0xF8FF for c in body):
        notes.append('Font-specific private-use checkmark/bullet glyphs retained unchanged; no semantic replacement inferred.')
    if page.page_number in {1, 108}:
        notes.append('Cover/back-cover content is rasterized; native text is only a hidden page-number artifact. No OCR performed.')
    if page.page_number == 72:
        notes.append('Crop-stage chart labels, ticks and illustrations are raster content. Native text captures its title and DAS/DAT only, not the complete chart.')
    if page.page_number == 73:
        notes.append('Schedule shading and rotated column headers are not represented reliably as text; do not infer stage/check relationships from extraction.')
    if page.page_number == 77:
        notes.append('Source cross-reference discrepancy: Annex 3a says Annex 4 is on printed p. 72, but Annex 4 actually begins on physical page 79 / printed p. 74. Preserve source wording; resolve citations from the manifest, not internal page mentions.')
    if not body:
        notes.append('No body text after footer removal. This is not evidence that the visible page or source topic has no content.')
    review = bool(tables or page.page_number in VISUAL_TABLE_PAGES or rotated_page or '>' in body or '<' in body)
    status = ('non_substantive' if page.page_number in NON_SUBSTANTIVE else
              'requires_visual_review' if review else 'native_text_only')
    return raw, body, tables, notes, status, rotated_page, len(chars)


def prepare(directory):
    source = directory / 'palaycheck.pdf'
    source_bytes = source.read_bytes()
    digest = sha256(source_bytes).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError('Source differs from the reviewed 2020 edition. Review identity/page mappings before preparing another PDF.')
    reader = PdfReader(source)
    assert not reader.is_encrypted and len(reader.pages) == 108
    labels = reader.page_labels
    assert labels[:6] == ['i', 'ii', 'iii', 'iv', 'v', '1']
    pages, evidence = [], []
    started = time.perf_counter()
    with pdfplumber.open(source, unicode_norm=None) as pdf:
        for page in pdf.pages:
            number = page.page_number
            label = labels[number - 1]
            raw, text, tables, notes, status, rotated, char_count = extract_page(page, label)
            section = next((title for first, last, title in SECTIONS if first <= number <= last), None)
            printed = None if number in NO_VISIBLE_LABEL else label
            row = {
                'documentId': DOCUMENT_ID, 'sourceSha256': digest, 'pdfPage': number,
                'printedLabel': printed, 'embeddedPageLabel': label, 'section': section,
                'pageSizePoints': {'width': page.width, 'height': page.height},
                'rawText': raw, 'text': text, 'nativeCharacterCount': char_count,
                'clockwiseReadingRotationDegrees': 90 if rotated else 0,
                'imageObjectCount': len(page.images), 'tableCandidates': tables,
                'visuallyIdentifiedTable': number in VISUAL_TABLE_PAGES,
                'groundingStatus': status, 'extractionNotes': notes,
            }
            if number in NO_VISIBLE_LABEL:
                row['printedLabelNote'] = 'No visible printed label; the embedded PDF label is not presented as a printed numeral.'
            pages.append(row)
            if text:
                evidence.append({
                    'evidenceId': f'p{number:03}-c01', 'documentId': DOCUMENT_ID,
                    'sourceSha256': digest, 'pdfPage': number, 'printedLabel': printed,
                    'section': section, 'text': text,
                    'textSha256': sha256(text.encode('utf-8')).hexdigest(),
                    'groundingStatus': status, 'extractionNotes': notes,
                })
            page.close()
    assert [row['pdfPage'] for row in pages] == list(range(1, 109))
    assert len({row['evidenceId'] for row in evidence}) == len(evidence)
    files = {}
    for name, records in [('pages.jsonl', pages), ('evidence.jsonl', evidence)]:
        payload = ('\n'.join(dumps(row) for row in records) + '\n').encode('utf-8')
        (directory / name).write_bytes(payload)
        files[name] = {'sha256': sha256(payload).hexdigest(), 'sizeBytes': len(payload), 'recordCount': len(records)}
    counts = Counter(row['groundingStatus'] for row in evidence)
    raw_text = '\n\n'.join(row['rawText'] for row in pages)
    body_text = '\n\n'.join(row['text'] for row in pages if row['text'])
    eligible = '\n\n'.join(row['text'] for row in evidence if row['groundingStatus'] == 'native_text_only')
    manifest = {
        'schemaVersion': 1, 'documentId': DOCUMENT_ID,
        'title': 'PalayCheck System',
        'subtitle': 'For irrigated lowland rice (transplanted/ direct wet-seeded)',
        'issuingOrganization': 'Philippine Rice Research Institute (PhilRice), Department of Agriculture',
        'edition': '2020 Revised edition', 'year': 2020,
        'identityVerifiedOnPhysicalPages': [3, 4],
        'file': 'palaycheck.pdf', 'sha256': digest,
        'sizeBytes': len(source_bytes), 'pageCount': len(pages),
        'preparedOn': '2026-10-24', 'timezone': 'Asia/Singapore',
        'pageLabelPolicy': 'Physical pages are 1-based. Printed numerals are separate from embedded labels; visible-label exceptions: 1, 2, 108.',
        'sectionRanges': [{'firstPdfPage': a, 'lastPdfPage': b, 'section': c} for a, b, c in SECTIONS],
        'extraction': {
            'pythonVersion': platform.python_version(),
            'libraries': {name: version(name) for name in ['pdfplumber', 'pdfminer.six', 'pypdf', 'pypdfium2']},
            'method': 'Native characters, x_tolerance=2/y_tolerance=3; exact footer removal; coordinate rotation for sideways text. No OCR or guessed corrections.',
            'evidencePolicy': 'One nonempty physical-page body per passage. IDs are stable for this fixed hash, extractor and settings. No passage spans pages.',
            'nativeExtractionSeconds': round(time.perf_counter() - started, 3),
            'rawTextCharacters': len(raw_text), 'rawTextUtf8Bytes': len(raw_text.encode('utf-8')),
            'bodyTextCharacters': len(body_text), 'bodyTextUtf8Bytes': len(body_text.encode('utf-8')),
            'bodyWhitespaceWordCount': len(body_text.split()),
            'nativeTextOnlyUtf8Bytes': len(eligible.encode('utf-8')),
            'groundingStatusCounts': dict(counts),
            'pagesWithNoBodyText': [row['pdfPage'] for row in pages if not row['text']],
            'rotatedReadingPages': [row['pdfPage'] for row in pages if row['clockwiseReadingRotationDegrees']],
            'tableCandidatePages': [row['pdfPage'] for row in pages if row['tableCandidates']],
            'visuallyIdentifiedTablePages': sorted(VISUAL_TABLE_PAGES),
            'comparisonGlyphReviewPages': [row['pdfPage'] for row in pages if '>' in row['text'] or '<' in row['text']],
            'imageObjectPages': [row['pdfPage'] for row in pages if row['imageObjectCount']],
            'unrecoverableReplacementCharacterCount': body_text.count('\ufffd'),
        },
        'files': files,
        'groundingRecommendation': {
            'strategy': 'Full page-tagged reviewed text before adding a retrieval index; recommendation only, no answering/retrieval implemented.',
            'constraints': 'native_text_only is an extraction classification, not semantic claim verification. Quarantine requires_visual_review/non_substantive records; explicitly retain visual/table coverage gaps and ask for source review rather than treating gaps as outside-PDF topics.',
            'modelTokenCount': None, 'providerLatency': None,
            'measurementNote': 'Character/UTF-8 sizes measured locally. Model-specific tokens and full-context provider latency not measured.',
        },
    }
    (directory / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'documentId': DOCUMENT_ID, 'pageCount': len(pages), 'evidenceCount': len(evidence), 'extraction': manifest['extraction']}, ensure_ascii=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('data/palaycheck'))
    prepare(parser.parse_args().directory)
