/** Explicit paid verification: at most five generations, one per case, no retries. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../../server/app.js';
import { loadSource } from '../../server/source.js';
import type { RequestTrace } from '../../server/request-trace.js';
import type { ChatRequest, ChatResponse, Language } from '../../shared/types.js';

const source = await loadSource();
const traces: RequestTrace[] = [];
const server = createApp(undefined, { source, testerDirectory: resolve('dev/backend-tester/public'),
  onTrace: trace => traces.push(trace) }).listen(0, '127.0.0.1');
const results: unknown[] = [];
const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
let modelMetadata: Record<string, unknown> = { model, status: 'NOT_CHECKED' };
try {
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    try {
      const metadataResponse = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, signal: AbortSignal.timeout(10_000),
      });
      modelMetadata = { model, http: metadataResponse.status };
      if (metadataResponse.ok) {
        const payload = await metadataResponse.json();
        const item = Array.isArray(payload.data) ? payload.data.find((entry: { id?: string }) => entry.id === model) : undefined;
        modelMetadata = { ...modelMetadata, listed: Boolean(item),
          contextWindowTokens: Number.isSafeInteger(item?.context_window) ? item.context_window : null,
          maxOutputTokens: Number.isSafeInteger(item?.max_output_tokens) ? item.max_output_tokens : null };
      } else await metadataResponse.body?.cancel();
    } catch { modelMetadata = { model, status: 'METADATA_UNAVAILABLE' }; }
  }
  let waterConversation: string | null = null;
  const cases: { name: string; language: Language; message: string; followUp?: boolean; kind: string; evidence?: string }[] = [
    { name: 'harvest_readiness', language: 'en', message: 'Kailan handa nang anihin ang palay kapag mano-mano ang pag-aani?', kind: 'grounded', evidence: 'p059-c01' },
    { name: 'water_flowering', language: 'fil', message: 'How deep should the water be while my rice is flowering?', kind: 'grounded', evidence: 'p050-c01' },
    { name: 'water_contextual_follow_up', language: 'en', message: 'Paano naman kapag naghihinog na ang palay?', followUp: true, kind: 'grounded', evidence: 'p050-c01' },
    { name: 'vague_farmer_concern', language: 'fil', message: 'Something seems wrong with my rice. What should I do?', kind: 'clarification' },
    { name: 'unreviewed_variety_table', language: 'en', message: 'What is the average yield of PSB Rc 2 in the variety table?', kind: 'clarification' },
  ];
  for (const item of cases) {
    if (item.followUp && !waterConversation) { results.push({ test: item.name, status: 'BLOCKED', reason: 'Previous water question did not establish a conversation.' }); continue; }
    const request: ChatRequest = { conversationId: item.followUp ? waterConversation : null, clientMessageId: crypto.randomUUID(),
      language: item.language, message: item.message, image: null };
    const started = performance.now();
    let row: Record<string, unknown> = { test: item.name, request, status: 'FAIL' };
    try {
      const response: Response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(35_000) });
      const body = await response.json();
      const trace = traces.find(entry => entry.requestId === response.headers.get('x-local-request-id'));
      row = { ...row, http: response.status, httpLatencyMs: Math.round(performance.now() - started), response: body, trace };
      assert.equal(response.status, 200, body.error?.code || 'Unexpected HTTP status');
      const chat = body as ChatResponse;
      assert.equal(chat.assistantMessage.kind, item.kind);
      assert.equal(chat.pendingGeneral, null);
      assert.equal(trace?.upstreamHttpStatus, 200);
      assert.ok(trace.usage && trace.usage.promptTokens > 0);
      if (typeof modelMetadata.contextWindowTokens === 'number') assert.ok(trace.usage.promptTokens + 900 <= modelMetadata.contextWindowTokens);
      const text = chat.assistantMessage.text;
      assert.doesNotMatch(text, /\b(TPR|DWSR|DAT|DAS)\b/i);
      if (item.language === 'en') assert.doesNotMatch(text, /\b(ang|iyong|nito|ginagamit|kapag|palay)\b/i);
      else assert.match(text, /\b(ang|ng|mo|mong|ano|iyong|may|sa|ito|kailan)\b/i);
      if (item.evidence) {
        const expected = source.reviewed.get(item.evidence)!;
        assert.ok(chat.assistantMessage.references.some(ref => ref.evidenceId === expected.evidenceId && ref.pdfPage === expected.pdfPage && ref.printedLabel === expected.printedLabel));
      } else assert.deepEqual(chat.assistantMessage.references, []);
      if (item.name === 'harvest_readiness') { assert.match(text, /85\s*[-–]\s*90/); assert.match(text, /golden.*yellow/i); }
      if (item.name.startsWith('water_')) assert.match(text, /5\s*(cm|sentimetro|centimeter)/i);
      if (item.name === 'water_flowering') waterConversation = chat.conversationId;
      if (item.followUp) assert.equal(chat.conversationId, waterConversation);
      if (item.name === 'vague_farmer_concern') assert.equal(trace.modelDecision, 'clarification');
      if (item.name === 'unreviewed_variety_table') {
        assert.equal(trace.modelDecision, 'source_limitation');
        assert.match(text, /does not mean.*outside PalayCheck/);
        assert.doesNotMatch(text, /request review|Would you like/);
      }
      row.status = 'PASS';
    } catch (error) {
      row.failure = error instanceof Error && error.name === 'AssertionError' ? error.message : 'Request failed or timed out; no retry.';
      process.exitCode = 1;
    }
    results.push(row);
    console.log(JSON.stringify({ test: item.name, status: row.status, http: row.http, httpLatencyMs: row.httpLatencyMs }));
  }
} finally {
  await new Promise<void>(done => server.close(() => done()));
  let output = JSON.stringify({ recordedAt: new Date().toISOString(), note: 'Five bounded cases with synthetic questions; real default provider; no automatic retries. No full-document coverage claim. AI-assisted semantic comparison is recorded separately; no independent human/agronomist certification.',
    source: source.metadata, reviewedEvidenceCount: source.reviewed.size, sourceContextUtf8Bytes: Buffer.byteLength(source.context),
    reviewedTextUtf8Bytes: Buffer.byteLength([...source.reviewed.values()].map(entry => entry.reviewedText).join('\n')),
    modelMetadata, results }, null, 2);
  for (const key of [process.env.DEEPSEEK_API_KEY, process.env.GROQ_API_KEY].filter((entry): entry is string => Boolean(entry))) output = output.replaceAll(key, '[REDACTED]');
  await writeFile(resolve('dev/backend-tester/expanded-smoke-results.json'), output + '\n');
}
