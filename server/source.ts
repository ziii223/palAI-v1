import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DocumentMetadata, EvidenceReference } from '../shared/types.js';
import { ApiError, isRecord } from './errors.js';

interface NativeEvidence extends EvidenceReference {
  sourceSha256: string;
  text: string;
  textSha256: string;
  groundingStatus: string;
}

export interface ReviewedEvidence extends EvidenceReference {
  reviewedText: string;
}

export interface SourceDocument {
  metadata: DocumentMetadata;
  pdf: Buffer;
  reviewed: Map<string, ReviewedEvidence>;
  context: string;
}

export const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Source integrity check failed.');
}

export async function loadSource(directory = resolve('data/palaycheck')): Promise<SourceDocument> {
  try {
    const names = ['palaycheck.pdf', 'manifest.json', 'pages.jsonl', 'evidence.jsonl', 'reviewed-evidence.json', 'verification.json'];
    const buffers = await Promise.all(names.map(name => readFile(resolve(directory, name))));
    const [pdf, manifestBytes, pagesBytes, evidenceBytes, reviewBytes, verificationBytes] = buffers;
    check(pdf && manifestBytes && pagesBytes && evidenceBytes && reviewBytes && verificationBytes);
    const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
    const review: unknown = JSON.parse(reviewBytes.toString('utf8'));
    const verification: unknown = JSON.parse(verificationBytes.toString('utf8'));
    check(isRecord(manifest) && isRecord(review) && isRecord(verification));
    check(typeof manifest.sha256 === 'string' && hash(pdf) === manifest.sha256 && pdf.subarray(0, 5).toString() === '%PDF-');
    check(Number.isInteger(manifest.pageCount) && Number(manifest.pageCount) > 0);
    check(verification.status === 'PASS' && verification.sourceSha256 === manifest.sha256
      && verification.pdfOpenAndRenderPageCount === manifest.pageCount);
    check(typeof manifest.documentId === 'string' && typeof manifest.title === 'string'
      && (manifest.edition === null || typeof manifest.edition === 'string'));
    check(isRecord(manifest.files));
    for (const [name, bytes] of [['pages.jsonl', pagesBytes], ['evidence.jsonl', evidenceBytes]] as const) {
      const info = manifest.files[name];
      check(isRecord(info) && info.sha256 === hash(bytes));
    }
    const pages: unknown[] = pagesBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    check(pages.length === manifest.pageCount);
    pages.forEach((page, index) => check(isRecord(page) && page.pdfPage === index + 1 && page.sourceSha256 === manifest.sha256));
    const originals = new Map<string, NativeEvidence>();
    for (const line of evidenceBytes.toString('utf8').trim().split('\n')) {
      const row: unknown = JSON.parse(line);
      check(isRecord(row) && typeof row.evidenceId === 'string' && !originals.has(row.evidenceId));
      check(typeof row.text === 'string' && row.textSha256 === hash(row.text)
        && row.sourceSha256 === manifest.sha256 && row.documentId === manifest.documentId);
      check(Number.isInteger(row.pdfPage) && Number(row.pdfPage) >= 1 && Number(row.pdfPage) <= pages.length);
      const page = pages[Number(row.pdfPage) - 1];
      check(isRecord(page) && row.printedLabel === page.printedLabel && row.section === page.section);
      check((row.printedLabel === null || typeof row.printedLabel === 'string')
        && (row.section === null || typeof row.section === 'string'));
      originals.set(row.evidenceId, row as unknown as NativeEvidence);
    }
    check(review.sourceSha256 === manifest.sha256 && typeof review.coverageStatement === 'string' && Array.isArray(review.records));
    const reviewed = new Map<string, ReviewedEvidence>();
    for (const entry of review.records) {
      check(isRecord(entry) && typeof entry.evidenceId === 'string' && !reviewed.has(entry.evidenceId));
      const original = originals.get(entry.evidenceId);
      check(original && entry.sourceSha256 === manifest.sha256 && entry.originalTextSha256 === original.textSha256);
      check(entry.documentId === original.documentId && entry.pdfPage === original.pdfPage
        && entry.printedLabel === original.printedLabel && entry.section === original.section);
      check(entry.reviewStatus === 'verified_excerpt' && typeof entry.reviewedText === 'string' && entry.reviewedText.trim());
      check(entry.reviewedTextSha256 === hash(entry.reviewedText) && original.text.includes(entry.reviewedText));
      reviewed.set(entry.evidenceId, {
        evidenceId: original.evidenceId, documentId: original.documentId, pdfPage: original.pdfPage,
        printedLabel: original.printedLabel, section: original.section, reviewedText: entry.reviewedText,
      });
    }
    check(reviewed.size > 0);
    const coverage = new Map<string, { unreviewed: number; flagged: number; partlyReviewed: number }>();
    for (const row of originals.values()) {
      const excerpt = reviewed.get(row.evidenceId);
      if (excerpt?.reviewedText === row.text) continue;
      const section = row.section || 'Front matter / credits';
      const entry = coverage.get(section) || { unreviewed: 0, flagged: 0, partlyReviewed: 0 };
      if (excerpt) entry.partlyReviewed++;
      else entry.unreviewed++;
      if (!excerpt && row.groundingStatus === 'requires_visual_review') entry.flagged++;
      coverage.set(section, entry);
    }
    const context = JSON.stringify({
      source: { documentId: manifest.documentId, sha256: manifest.sha256, physicalPages: pages.length },
      scopeDiscoveryOnly: {
        purpose: 'Scope discovery only, NOT approved answer evidence. Extraction/review gaps are not proof of absence. Only clearly unrelated non-agricultural requests may trigger consent.',
        physicalPages: [3, 5, 9].map(number => {
          const page = pages[number - 1];
          check(isRecord(page));
          return { pdfPage: number, printedLabel: page.printedLabel, text: page.text };
        }),
      },
      coverageStatement: review.coverageStatement,
      coverageSummary: { reviewedExcerptCount: reviewed.size, totalPageRecords: pages.length,
        totalEvidenceRecords: originals.size, unreviewedRecords: originals.size - reviewed.size },
      reviewedEvidence: [...reviewed.values()],
      coverageOnlyNotAnswerEvidence: [...coverage].map(([section, counts]) => ({ section, ...counts })),
      limitations: 'Other passages, tables, diagrams and internal cross-references are not approved answer evidence. Exclusion never means the PDF lacks coverage. Do not infer table values or use general knowledge.',
    });
    return {
      pdf, reviewed, context,
      metadata: { documentId: manifest.documentId, title: manifest.title, edition: manifest.edition,
        pageCount: Number(manifest.pageCount), sha256: manifest.sha256, pdfUrl: '/api/document/pdf' },
    };
  } catch {
    throw new ApiError(503, 'SOURCE_NOT_READY', 'The PalayCheck source is not ready. Please try again later.', true);
  }
}
