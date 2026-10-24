/** Explicit, bounded paid verification: five calls; no retry loop. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../../server/app.js';
import type { ChatMetrics } from '../../server/chat.js';
import type { ChatResponse, Language } from '../../shared/types.js';

const metrics: ChatMetrics[] = [];
const server = createApp(undefined, { onMetrics: value => metrics.push(value) }).listen(0, '127.0.0.1');
const results: unknown[] = [];
try {
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const metadata = await (await fetch(`${base}/api/document`)).json();
  assert.equal(metadata.pageCount, 108);
  let firstConversation: string | null = null;
  const cases: { name: string; language: Language; message: string; followUp?: boolean }[] = [
    { name: 'supported_en', language: 'en', message: 'What is the Leaf Color Chart (LCC) used for?' },
    { name: 'contextual_follow_up', language: 'en', message: 'When should I start using it, and how often?', followUp: true },
    { name: 'equivalent_fil', language: 'fil', message: 'Para saan ginagamit ang Leaf Color Chart (LCC)?' },
    { name: 'unreviewed_table', language: 'en', message: 'What is the average yield of PSB Rc 2 in the variety table?' },
    { name: 'missing_crop_context', language: 'en', message: 'Ask me for any missing crop details before answering: my LCC reading is 3.7.' },
  ];
  for (const item of cases) {
    const started = performance.now();
    const response: Response = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: item.followUp ? firstConversation : null,
        clientMessageId: crypto.randomUUID(), language: item.language, message: item.message, image: null }),
      signal: AbortSignal.timeout(35_000),
    });
    const body = await response.json();
    const row = { test: item.name, http: response.status, httpLatencyMs: Math.round(performance.now() - started),
      question: item.message, response: body, metrics: metrics.at(-1) };
    results.push(row);
    assert.equal(response.status, 200, `Live ${item.name} failed with ${body.error?.code || response.status}`);
    const chat = body as ChatResponse;
    assert.equal(chat.pendingGeneral, null);
    if (item.name === 'supported_en' || item.name === 'equivalent_fil') {
      assert.equal(chat.assistantMessage.kind, 'grounded');
      assert.ok(chat.assistantMessage.references.some(ref => ref.evidenceId === 'p038-c01' && ref.pdfPage === 38 && ref.printedLabel === '33'));
      assert.match(chat.assistantMessage.text, /nitroheno|nitrogen/i);
      if (item.language === 'fil') assert.match(chat.assistantMessage.text, /\b(ang|ng|upang|para)\b/i);
    } else if (item.followUp) {
      assert.equal(chat.conversationId, firstConversation);
      assert.equal(chat.assistantMessage.kind, 'grounded');
      assert.ok(chat.assistantMessage.references.some(ref => ref.evidenceId === 'p040-c01' && ref.pdfPage === 40 && ref.printedLabel === '35'));
      for (const value of ['7', '14', '21']) assert.ok(chat.assistantMessage.text.includes(value));
      assert.match(chat.assistantMessage.text, /flower/i);
    } else {
      assert.equal(chat.assistantMessage.kind, 'clarification');
      assert.deepEqual(chat.assistantMessage.references, []);
      if (item.name === 'unreviewed_table') assert.match(chat.assistantMessage.text, /does not mean.*outside PalayCheck/);
      else assert.match(chat.assistantMessage.text, /transplant|direct|seed|leaves|method/i);
    }
    if (item.name === 'supported_en') firstConversation = chat.conversationId;
    console.log(JSON.stringify({ test: item.name, status: 'PASS', httpLatencyMs: row.httpLatencyMs,
      kind: chat.assistantMessage.kind, text: chat.assistantMessage.text,
      references: chat.assistantMessage.references, metrics: row.metrics }));
  }
  assert.equal(metrics.length, 5);
} finally {
  await new Promise<void>(done => server.close(() => done()));
  let output = JSON.stringify({ recordedOn: '2026-10-24', timezone: 'Asia/Singapore',
    note: 'Five bounded live calls; no retries. Semantic support reviewed separately against the cited source pages.', results }, null, 2);
  for (const key of [process.env.DEEPSEEK_API_KEY, process.env.GROQ_API_KEY].filter((value): value is string => Boolean(value))) {
    output = output.replaceAll(key, '[REDACTED]');
  }
  await writeFile(resolve('dev/backend-tester/text-smoke-results.json'), output + '\n', 'utf8');
}
