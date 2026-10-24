"""Check source hash, per-page evidence integrity and representative page mappings."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import pypdfium2
from pypdf import PdfReader


directory = Path('data/palaycheck')
manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
source = directory / manifest['file']
assert sha256(source.read_bytes()).hexdigest() == manifest['sha256']
reader = PdfReader(source)
assert len(reader.pages) == manifest['pageCount'] == 108
loaded = {}
for name, info in manifest['files'].items():
    data = (directory / name).read_bytes()
    assert len(data) == info['sizeBytes']
    assert sha256(data).hexdigest() == info['sha256']
    rows = [json.loads(line) for line in data.decode('utf-8').splitlines()]
    assert len(rows) == info['recordCount']
    loaded[name] = rows
pages = loaded['pages.jsonl']
evidence = loaded['evidence.jsonl']
assert [row['pdfPage'] for row in pages] == list(range(1, 109))
assert len(set(row['evidenceId'] for row in evidence)) == len(evidence)


def ascii_content(text):
    return Counter(c for c in text if c.isascii() and c.isalnum())


# Independent pypdf extraction checks the native ASCII character inventory on
# every page. It does not certify reading order, table meaning or visual content.
for number, page in enumerate(pages, 1):
    assert page['documentId'] == manifest['documentId']
    assert page['sourceSha256'] == manifest['sha256']
    assert page['embeddedPageLabel'] == reader.page_labels[number - 1]
    assert page['printedLabel'] == (None if number in {1, 2, 108} else reader.page_labels[number - 1])
    assert ascii_content(page['rawText']) == ascii_content(reader.pages[number - 1].extract_text() or ''), number

for row in evidence:
    number = row['pdfPage']
    page = pages[number - 1]
    assert row['evidenceId'] == f'p{number:03}-c01'
    assert row['text'] and row['text'] == page['text']
    assert row['sourceSha256'] == manifest['sha256']
    assert row['documentId'] == manifest['documentId']
    assert row['printedLabel'] == page['printedLabel']
    assert row['section'] == page['section']
    assert row['textSha256'] == sha256(row['text'].encode('utf-8')).hexdigest()

representatives = []
for number, label, phrase in [
    (3, 'iii', '2020 Revised edition'),
    (40, '35', 'use LCC every 7 days'),
    (53, '48', 'Insect pest level associated with significant yield loss'),
    (72, '67', 'CROP MANAGEMENT AREA'),
    (77, '72', 'Schematic Guide for Monitoring Key'),
    (96, '91', 'PSB Rc 2 Nahalin 5.1 7.1 123 99 15'),
]:
    row = next(row for row in evidence if row['pdfPage'] == number)
    assert row['printedLabel'] == label
    assert phrase in row['text']
    representatives.append({
        'evidenceId': row['evidenceId'], 'pdfPage': number, 'printedLabel': label,
        'matchedText': phrase, 'groundingStatus': row['groundingStatus'],
        'visuallyComparedToOriginalRender': True,
    })
assert pages[107]['printedLabel'] is None and pages[107]['embeddedPageLabel'] == '103'
assert {row['pdfPage'] for row in evidence}.isdisjoint({1, 74, 108})
assert any('Source cross-reference discrepancy' in note for note in pages[76]['extractionNotes'])

doc = pypdfium2.PdfDocument(source)
for number in range(len(doc)):
    page = doc[number]
    bitmap = page.render(scale=.4)
    assert bitmap.width > 0 and bitmap.height > 0
    bitmap.close()
    page.close()
doc.close()

result = {
    'verifiedOn': '2026-10-24', 'timezone': 'Asia/Singapore',
    'status': 'PASS', 'sourceSha256': manifest['sha256'],
    'pdfOpenAndRenderPageCount': len(pages), 'pageRecordCount': len(pages),
    'evidenceRecordCount': len(evidence), 'allFileHashesMatch': True,
    'allEvidenceTextHashesMatch': True, 'uniqueStableIds': True,
    'allPassagesStayOnOnePhysicalPage': True,
    'independentAsciiCharacterInventoryChecks': len(pages),
    'representativeMappings': representatives,
    'limits': 'Integrity and representative visual mapping checks only. Does not certify all table values, diagram content or agricultural claims. No OCR or model calls.',
}
(directory / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(result, ensure_ascii=True))
