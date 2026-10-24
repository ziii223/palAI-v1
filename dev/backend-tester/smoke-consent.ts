/** Explicit paid verification: maximum five provider generations, no automatic retries. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../../server/app.js';
import { loadSource } from '../../server/source.js';
import type { RequestTrace } from '../../server/request-trace.js';
import type { ChatMetrics } from '../../server/chat.js';

const source = await loadSource();
const traces: RequestTrace[] = [];
const metrics: ChatMetrics[] = [];
const server = createApp(undefined, { source, testerDirectory: resolve('dev/backend-tester/public'),
  onTrace: trace => traces.push(trace), onMetrics: metric => metrics.push(metric) }).listen(0, '127.0.0.1');
const rows: Record<string, unknown>[] = [];
let base = '';
const question = 'Why does the Moon have phases?';
async function post(name: string, route: string, request: Record<string, unknown>) {
  const started = performance.now();
  const response = await fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(35_000) });
  const body = await response.json();
  const trace = traces.find(item => item.requestId === response.headers.get('x-local-request-id'));
  rows.push({ name, request, http: response.status, httpLatencyMs: Math.round(performance.now() - started), response: body, trace });
  assert.equal(response.status, 200, body.error?.code || 'Unexpected HTTP status');
  return body;
}
const chat = (message: string, language = 'en', conversationId: string | null = null) => ({
  conversationId, clientMessageId: crypto.randomUUID(), language, message, image: null,
});
try {
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
  const outside = await post('outside_no_general_before_consent', 'chat', chat(question));
  assert.equal(outside.assistantMessage.kind, 'consent_prompt');
  assert.equal(outside.assistantMessage.text, 'This is outside PalayCheck. Would you like a general AI answer?');
  assert.equal(outside.pendingGeneral.question, question);
  assert.equal(metrics.length, 1);
  const cancelAction = { conversationId: outside.conversationId, pendingId: outside.pendingGeneral.id,
    clientActionId: crypto.randomUUID(), decision: 'cancel', language: 'en' };
  const cancelled = await post('cancel_local', 'consent', cancelAction);
  assert.equal(cancelled.assistantMessage.text, 'General answer cancelled.');
  assert.equal(metrics.length, 1);
  assert.deepEqual(await post('cancel_replay_local', 'consent', cancelAction), cancelled);
  assert.equal(metrics.length, 1);

  const mixed = await post('partial_grounded_plus_pending', 'chat', chat(`Para saan ginagamit ang Leaf Color Chart? ${question}`));
  assert.equal(mixed.assistantMessage.kind, 'grounded');
  assert.ok(mixed.assistantMessage.references.some((ref: { evidenceId: string; pdfPage: number; printedLabel: string }) =>
    ref.evidenceId === 'p038-c01' && ref.pdfPage === 38 && ref.printedLabel === '33'));
  assert.match(mixed.assistantMessage.text, /nitrogen/i);
  assert.equal(mixed.pendingGeneral.question, question);
  const continueAction = { conversationId: mixed.conversationId, pendingId: mixed.pendingGeneral.id,
    clientActionId: crypto.randomUUID(), decision: 'continue', language: 'fil' };
  const general = await post('continue_filipino', 'consent', continueAction);
  assert.equal(general.assistantMessage.kind, 'general');
  assert.deepEqual(general.assistantMessage.references, []);
  assert.equal(general.pendingGeneral, null);
  assert.match(general.assistantMessage.text, /\b(ang|ng|sa|ito)\b/i);
  const beforeReplay = metrics.length;
  assert.deepEqual(await post('continue_replay_local', 'consent', continueAction), general);
  assert.equal(metrics.length, beforeReplay);

  const supported = await post('return_to_grounding_english', 'chat', chat('Gaano kalalim ang tubig habang namumulaklak ang palay?', 'en', mixed.conversationId));
  assert.equal(supported.assistantMessage.kind, 'grounded');
  assert.equal(supported.pendingGeneral, null);
  assert.match(supported.assistantMessage.text, /5\s*(cm|centimeter)/i);
  assert.ok(supported.assistantMessage.references.some((ref: { evidenceId: string }) => ref.evidenceId === 'p050-c01'));
  assert.doesNotMatch(supported.assistantMessage.text, /\b(ang|iyong|habang)\b/i);

  const limitation = await post('unreviewed_not_outside_filipino', 'chat', chat('What is the average yield of PSB Rc 2 in the variety table?', 'fil'));
  assert.equal(limitation.assistantMessage.kind, 'clarification');
  assert.equal(limitation.pendingGeneral, null);
  assert.match(limitation.assistantMessage.text, /Hindi ito nangangahulugang/);
  assert.deepEqual(limitation.assistantMessage.references, []);
  assert.equal(metrics.length, 5);
  console.log(JSON.stringify({ status: 'PASS', providerCalls: metrics.length, metrics }));
} catch (error) {
  rows.push({ status: 'FAIL', failure: error instanceof Error && error.name === 'AssertionError' ? error.message : 'Request failed; no automatic retry.' });
  process.exitCode = 1;
  console.log(JSON.stringify({ status: 'FAIL', providerCalls: metrics.length }));
} finally {
  await new Promise<void>(done => server.close(() => done()));
  let output = JSON.stringify({ recordedAt: new Date().toISOString(), source: source.metadata,
    scopeVerification: 'AI-assisted comparison of original PDF title physical 3/printed iii, contents 5/v and scope statement 9/4: irrigated lowland rice crop management. Lunar phases are unrelated non-agricultural knowledge, not an excluded rice passage. No source artifacts altered.',
    sourceContextUtf8Bytes: Buffer.byteLength(source.context), reviewedEvidenceCount: source.reviewed.size,
    note: 'Synthetic public questions only; maximum five bounded calls, 900 output tokens, 30-second provider timeout, no automatic retries. Local cache/Cancel actions are separately recorded. General answer warning tested with actual tester script; final frontend unverified.', metrics, rows }, null, 2);
  for (const key of [process.env.DEEPSEEK_API_KEY, process.env.GROQ_API_KEY]) if (key) output = output.replaceAll(key, '[REDACTED]');
  await writeFile('dev/backend-tester/consent-smoke-results.json', output + '\n');
}
