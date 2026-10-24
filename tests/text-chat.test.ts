import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp, type AppOptions } from '../server/app.js';
import { createDeepSeek, type ModelMessage, type ModelResult } from '../server/deepseek.js';
import { hash, loadSource } from '../server/source.js';
import { ApiError } from '../server/errors.js';
import { validateModelOutput } from '../server/chat.js';
import type { RequestTrace } from '../server/request-trace.js';
import { runInNewContext } from 'node:vm';

const source = await loadSource();
const sample = {
  kind: 'grounded', language: 'en', claims: [{ text: 'The Leaf Color Chart visually assesses the nitrogen status of rice.',
    evidenceId: 'p038-c01', quote: 'A tool to visually assess the nitrogen status of the rice crop.' }],
};
const result = (output: unknown = sample): ModelResult => ({ output, usage: {
  model: 'test-stub', promptTokens: 100, completionTokens: 20, totalTokens: 120, providerLatencyMs: 1,
} });

async function start(t: TestContext, options: AppOptions = {}) {
  const server = createApp(undefined, { source, ...options }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(done => server.close(() => done())));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return { base, post: (overrides: Record<string, unknown> = {}) => fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: null, clientMessageId: crypto.randomUUID(), language: 'en',
      message: 'What is the Leaf Color Chart used for?', image: null, ...overrides }),
  }) };
}

test('document endpoints deliver the verified source, positive count, exact hash and PDF bytes', async t => {
  const { base } = await start(t);
  const metadata = await (await fetch(`${base}/api/document`)).json();
  assert.deepEqual(metadata, source.metadata);
  assert.equal(metadata.pageCount, 108);
  const pdf = await fetch(`${base}/api/document/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type') || '', /^application\/pdf/);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(hash(bytes), metadata.sha256);
  assert.ok(bytes.equals(await readFile('data/palaycheck/palaycheck.pdf')));
  assert.equal((await fetch(`${base}/dev/backend-tester/`)).status, 404);
});

test('source failure is SOURCE_NOT_READY and changed PDF is rejected', async t => {
  const server = createApp(undefined, { sourceDirectory: 'data/does-not-exist' }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(done => server.close(() => done())));
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/document`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'SOURCE_NOT_READY');
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'palai-source-test-'));
  assert.equal(dirname(directory), temporaryRoot);
  assert.ok(basename(directory).startsWith('palai-source-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['manifest.json', 'pages.jsonl', 'evidence.jsonl', 'reviewed-evidence.json', 'verification.json']) {
    await writeFile(join(directory, name), await readFile(resolve('data/palaycheck', name)));
  }
  await writeFile(join(directory, 'palaycheck.pdf'), '%PDF-wrong');
  await assert.rejects(loadSource(directory), { code: 'SOURCE_NOT_READY' });
});

test('only explicit reviewed excerpts enter answer context; flagged source stays coverage-only', () => {
  assert.deepEqual([...source.reviewed.keys()], ['p022-c01', 'p036-c01', 'p038-c01', 'p039-c01', 'p040-c01', 'p048-c01', 'p050-c01', 'p059-c01']);
  const context = JSON.parse(source.context);
  assert.equal(context.reviewedEvidence.length, source.reviewed.size);
  assert.equal(context.coverageSummary.unreviewedRecords, 97);
  assert.equal(context.coverageOnlyNotAnswerEvidence.reduce((n: number, row: { partlyReviewed: number }) => n + row.partlyReviewed, 0), 7);
  assert.equal(context.coverageOnlyNotAnswerEvidence.reduce((n: number, row: { flagged: number }) => n + row.flagged, 0), 33);
  assert.ok(!source.context.includes('>30%'));
  assert.ok(!source.context.includes('PSB Rc 2 Nahalin'));
  assert.ok(!source.context.includes('Example for TPR'));
  for (const row of source.reviewed.values()) assert.equal(context.reviewedEvidence.find((entry: { evidenceId: string }) => entry.evidenceId === row.evidenceId)?.reviewedText, row.reviewedText);
});

test('new review records load without topic code changes; wrong physical-page metadata fails closed', async t => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'palai-source-test-'));
  assert.equal(dirname(directory), temporaryRoot);
  assert.ok(basename(directory).startsWith('palai-source-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['palaycheck.pdf', 'manifest.json', 'pages.jsonl', 'evidence.jsonl', 'reviewed-evidence.json', 'verification.json']) {
    await copyFile(resolve('data/palaycheck', name), join(directory, name));
  }
  const review = JSON.parse(await readFile(join(directory, 'reviewed-evidence.json'), 'utf8'));
  review.coverageStatement = 'TEST FIXTURE ONLY: partial excerpts listed in this temporary file.';
  const originals = (await readFile(join(directory, 'evidence.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const original = originals.find(row => row.evidenceId === 'p065-c01');
  const reviewedText = original.text.slice(0, original.text.indexOf('\n•'));
  // Synthetic approval exists only in this temporary fixture, never in production source data.
  const entry = { ...review.records[0], evidenceId: original.evidenceId, documentId: original.documentId,
    pdfPage: original.pdfPage, printedLabel: original.printedLabel, section: original.section,
    originalTextSha256: original.textSha256, reviewedText, reviewedTextSha256: hash(reviewedText), reviewMethod: 'TEST FIXTURE ONLY' };
  review.records.push(entry);
  await writeFile(join(directory, 'reviewed-evidence.json'), JSON.stringify(review));
  const expanded = await loadSource(directory);
  assert.equal(expanded.reviewed.size, source.reviewed.size + 1);
  assert.equal(expanded.reviewed.get('p065-c01')?.reviewedText, reviewedText);
  assert.ok(expanded.context.includes('p065-c01'));
  entry.pdfPage = 64;
  await writeFile(join(directory, 'reviewed-evidence.json'), JSON.stringify(review));
  await assert.rejects(loadSource(directory), { code: 'SOURCE_NOT_READY' });
});

test('expanded harvest and water references resolve canonical pages for varied question wording', async t => {
  const inputs: ModelMessage[][] = [];
  const { post } = await start(t, { provider: async messages => {
    inputs.push(messages);
    const harvest = inputs.length === 1;
    return result({ kind: 'grounded', language: 'en', claims: [{
      text: harvest ? 'For manual harvesting, 85-90% of grains should be golden yellow.' : 'Maintain 5 cm of water at flowering.',
      evidenceId: harvest ? 'p059-c01' : 'p050-c01',
      quote: harvest ? 'when 85-\n90% (manual) or 90-95% (if using combine\nharvester) of the grains are golden yellow.' : 'Maintain 5cm water level during the\nflowering stage.',
    }] });
  } });
  const harvest = await (await post({ message: 'How can I judge whether my grains are ready for cutting by hand?' })).json();
  assert.equal(harvest.assistantMessage.references[0]?.pdfPage, 59);
  assert.equal(harvest.assistantMessage.references[0]?.printedLabel, '54');
  const water = await (await post({ message: 'What depth should I keep when the plants flower?' })).json();
  assert.equal(water.assistantMessage.references[0]?.pdfPage, 50);
  assert.equal(water.assistantMessage.references[0]?.printedLabel, '45');
  assert.match(inputs[0]?.[0]?.content || '', /"reviewedExcerptCount":8/);
  assert.match(inputs[1]?.[0]?.content || '', /Ask only when the farmer's answer can enable an assessment supported by reviewedEvidence/);
});

const waterSupports = [
  { evidenceId: 'p048-c01', quote: 'The right volume of water promotes\nbetter nutrient uptake' },
  { evidenceId: 'p050-c01', quote: 'Maintain 5cm water level during the\nflowering stage.' },
];

test('a supported conclusion can combine exact premises from different pages in either selected language', async t => {
  const inputs: ModelMessage[][] = [];
  const texts = {
    en: 'Yes. Maintain 5 cm of water during flowering to support nutrient uptake.',
    fil: 'Oo. Panatilihin ang 5 cm na lalim ng tubig habang namumulaklak ang palay upang makatulong sa pagsipsip ng sustansiya.',
  };
  const { post } = await start(t, { provider: async messages => {
    inputs.push(messages);
    const language = messages.at(-1)?.content.includes('language code: fil') ? 'fil' : 'en';
    return result({ kind: 'grounded', language, claims: [{ text: texts[language], supports: waterSupports }] });
  } });
  const first = await (await post({ language: 'en', message: 'Makakatulong ba sa pagsipsip ng sustansiya ang tamang tubig habang namumulaklak, at gaano ito kalalim?' })).json();
  const second = await (await post({ conversationId: first.conversationId, language: 'fil', message: 'Can the recommended flowering water level help nutrient uptake, and how deep should it be?' })).json();
  assert.equal(first.assistantMessage.text, texts.en);
  assert.equal(second.assistantMessage.text, texts.fil);
  for (const body of [first, second]) {
    assert.equal(body.assistantMessage.kind, 'grounded');
    assert.equal(body.pendingGeneral, null);
    assert.deepEqual(body.assistantMessage.references.map((ref: { pdfPage: number; printedLabel: string }) => [ref.pdfPage, ref.printedLabel]), [[48, '43'], [50, '45']]);
    assert.ok(!JSON.stringify(body).includes('"supports"'));
    assert.ok(!JSON.stringify(body).includes('"quote"'));
  }
  const context = JSON.parse(inputs[0]![0]!.content.split('SOURCE DATA JSON:\n')[1]!);
  assert.equal(context.reviewedEvidence.length, source.reviewed.size);
  for (const support of waterSupports) assert.ok(context.reviewedEvidence.some((entry: { evidenceId: string }) => entry.evidenceId === support.evidenceId));
  assert.match(inputs[0]![0]!.content, /An exact matching sentence or a single page containing the complete answer is NOT required/);
  assert.match(inputs[0]![0]!.content, /Answer the farmer directly/);
  assert.equal(inputs[1]?.[1]?.content, 'Makakatulong ba sa pagsipsip ng sustansiya ang tamang tubig habang namumulaklak, at gaano ito kalalim?');
  assert.equal(inputs[1]?.[2]?.content, texts.en);
});

test('multi-passage validation checks every support and returns the canonical page union', () => {
  const claim = { text: 'Maintain 5 cm of water during flowering to support nutrient uptake.', supports: waterSupports };
  const valid = { kind: 'grounded', language: 'en', claims: [claim, { text: 'Use the recommended flowering depth.', supports: [waterSupports[1]] }] };
  assert.deepEqual(validateModelOutput(valid, source, 'en').references.map(ref => ref.evidenceId), ['p048-c01', 'p050-c01']);
  for (const supports of [
    [], Array(9).fill(waterSupports[0]), [waterSupports[0], { ...waterSupports[1], evidenceId: 'p999-c01' }],
    [waterSupports[0], { ...waterSupports[1], evidenceId: 'p053-c01' }],
    [waterSupports[0], { ...waterSupports[1], quote: 'This is an invented supporting premise.' }],
    [waterSupports[0], { evidenceId: 'p050-c01' }],
    [waterSupports[0], { ...waterSupports[1], pdfPage: 49 }],
  ]) {
    assert.throws(() => validateModelOutput({ ...valid, claims: [{ ...claim, supports }] }, source, 'en'), { code: 'INVALID_MODEL_RESPONSE' });
  }
  assert.throws(() => validateModelOutput({ ...valid, claims: [{ ...claim, evidenceId: 'p050-c01', quote: waterSupports[1]!.quote }] }, source, 'en'), { code: 'INVALID_MODEL_RESPONSE' });
  assert.throws(() => validateModelOutput(valid, source, 'fil'), { code: 'INVALID_MODEL_RESPONSE' });
});

test('a proposed conclusion with an unavailable essential link remains a source limitation, not a general answer', async t => {
  const { post } = await start(t, { provider: async messages => {
    assert.match(messages[0]?.content || '', /Never invent a missing causal link/);
    assert.match(messages[0]?.content || '', /Do not use this merely because reasoning across passages is needed/);
    return result({ kind: 'source_limitation' });
  } });
  for (const language of ['en', 'fil']) {
    const body = await (await post({ language, message: 'Does 5 cm of water at flowering let me halve fertilizer without reducing yield?' })).json();
    assert.equal(body.assistantMessage.kind, 'clarification');
    assert.deepEqual(body.assistantMessage.references, []);
    assert.equal(body.pendingGeneral, null);
    assert.doesNotMatch(body.assistantMessage.text, /50%|halve|Would you like|Gusto mo bang/i);
    assert.match(body.assistantMessage.text, language === 'en' ? /does not mean.*outside PalayCheck/ : /Hindi ito nangangahulugang/);
  }
});

test('grounded response resolves canonical references and a duplicate first submission is idempotent', async t => {
  let calls = 0;
  const { post } = await start(t, { provider: async () => { calls++; return result(); } });
  const id = crypto.randomUUID();
  const first = await post({ clientMessageId: id });
  const body = await first.json();
  assert.equal(first.status, 200);
  assert.equal(body.assistantMessage.kind, 'grounded');
  assert.equal(body.pendingGeneral, null);
  assert.deepEqual(body.assistantMessage.references, [{ evidenceId: 'p038-c01', documentId: source.metadata.documentId,
    pdfPage: 38, printedLabel: '33', section: 'Nutrient Management' }]);
  assert.deepEqual(await (await post({ clientMessageId: id })).json(), body);
  assert.equal(calls, 1);
  assert.equal((await post({ clientMessageId: id, message: 'different' })).status, 400);
});

test('existing conversation preserves follow-up context and selected answer language', async t => {
  const inputs: ModelMessage[][] = [];
  const { post } = await start(t, { provider: async messages => { inputs.push(messages);
    const language = messages[0]?.content.includes('language code: fil') ? 'fil' : 'en';
    return result({ ...sample, language, claims: [{ ...sample.claims[0],
      text: language === 'fil' ? 'Sinusuri ng chart ang nitrogen status ng palay.' : sample.claims[0]!.text }] }); } });
  const first = await (await post()).json();
  await post({ conversationId: first.conversationId, language: 'fil', message: 'Kailan ko ito gagamitin?' });
  assert.equal(inputs.length, 2);
  assert.equal(inputs[1]?.[1]?.role, 'user');
  assert.match(inputs[1]?.[1]?.content || '', /Leaf Color Chart/);
  assert.equal(inputs[1]?.[2]?.role, 'assistant');
  assert.match(inputs[1]?.[0]?.content || '', /Answer language: Filipino/);
  assert.equal(inputs[1]?.at(-2)?.content, 'Kailan ko ito gagamitin?');
  assert.equal(inputs[1]?.at(-1)?.role, 'system');
});

test('source-limitation is a truthful localized clarification, never consent or general advice', async t => {
  const { post } = await start(t, { provider: async () => result({ kind: 'source_limitation' }) });
  for (const language of ['en', 'fil']) {
    const response = await post({ language, message: language === 'en' ? 'Ano ang ani ng PSB Rc 2 sa talahanayan?' : 'What is the yield of PSB Rc 2 in the table?' });
    const body = await response.json();
    assert.equal(body.assistantMessage.kind, 'clarification');
    assert.deepEqual(body.assistantMessage.references, []);
    assert.equal(body.pendingGeneral, null);
    assert.match(body.assistantMessage.text, language === 'en' ? /does not mean.*outside PalayCheck/ : /Hindi ito nangangahulugang/);
    assert.doesNotMatch(body.assistantMessage.text, /request review|humiling.*pagsusuri|Please ask about the Leaf Color Chart/i);
  }
});

test('legacy outside_scope output fails explicitly instead of returning the retired refusal', async t => {
  const { post } = await start(t, { provider: async () => result({ kind: 'outside_scope' }) });
  for (const language of ['en', 'fil']) {
    const response = await post({ language, message: 'Write a short birthday greeting for my friend.' });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, 'INVALID_MODEL_RESPONSE');
    assert.equal(body.assistantMessage, undefined);
    assert.doesNotMatch(JSON.stringify(body), /I can only provide source-backed rice guidance|Makapagbibigay lamang/);
  }
});

test('each explicit language selection overrides question/history language without rewriting old messages', async t => {
  const inputs: ModelMessage[][] = [];
  const texts = ['The chart visually checks the nitrogen status of rice.', 'Sinusuri nito ang nitrogen status ng palay.', 'It checks nitrogen status.'];
  const { post } = await start(t, { provider: async messages => {
    inputs.push(messages);
    const language = inputs.length === 2 ? 'fil' : 'en';
    assert.match(messages.at(-1)?.content || '', new RegExp(`language code: ${language}`));
    assert.match(messages.at(-1)?.content || '', /regardless of the language of the farmer/);
    return result({ ...sample, language, claims: [{ ...sample.claims[0], text: texts[inputs.length - 1] }] });
  } });
  const first = await (await post({ language: 'en', message: 'Para saan ginagamit ang Leaf Color Chart?' })).json();
  assert.equal(first.assistantMessage.text, texts[0]);
  const second = await (await post({ conversationId: first.conversationId, language: 'fil', message: 'What does the chart check?' })).json();
  assert.equal(second.assistantMessage.text, texts[1]);
  const third = await (await post({ conversationId: first.conversationId, language: 'en', message: 'Ano ang sinusuri nito?' })).json();
  assert.equal(third.assistantMessage.text, texts[2]);
  assert.equal(third.conversationId, first.conversationId);
  assert.deepEqual(inputs[2]?.slice(1, 5), [
    { role: 'user', content: 'Para saan ginagamit ang Leaf Color Chart?' },
    { role: 'assistant', content: texts[0] },
    { role: 'user', content: 'What does the chart check?' },
    { role: 'assistant', content: texts[1] },
  ]);
});

test('language is part of idempotency for new and existing conversations; changed payloads never hit a cached answer', async t => {
  let calls = 0;
  const { post } = await start(t, { provider: async () => { calls++; return result(); } });
  const id = crypto.randomUUID();
  const first = await (await post({ clientMessageId: id })).json();
  assert.equal((await post({ clientMessageId: id, language: 'fil' })).status, 400);
  assert.equal((await post({ conversationId: first.conversationId, clientMessageId: id, language: 'fil' })).status, 400);
  assert.equal((await post({ conversationId: first.conversationId, clientMessageId: id, message: 'changed' })).status, 400);
  assert.deepEqual(await (await post({ conversationId: first.conversationId, clientMessageId: id })).json(), first);
  assert.equal(calls, 1);
  assert.equal((await post({ conversationId: first.conversationId })).status, 200);
  assert.equal(calls, 2);
});

test('mismatched model language is rejected before caching; identical failed submission can be retried', async t => {
  let calls = 0;
  const { post } = await start(t, { provider: async () => {
    calls++; return result({ ...sample, language: calls === 1 ? 'fil' : 'en' });
  } });
  const id = crypto.randomUUID();
  const failed = await post({ clientMessageId: id });
  assert.equal(failed.status, 422);
  assert.equal((await failed.json()).assistantMessage, undefined);
  assert.equal((await post({ clientMessageId: id })).status, 200);
  assert.equal(calls, 2);
});

test('clarifications and greetings validate language; farmer-facing acronyms are rejected while source quotes stay exact', () => {
  for (const language of ['en', 'fil'] as const) {
    for (const kind of ['clarification', 'acknowledgement']) {
      const text = language === 'en' ? 'Did you transplant seedlings or sow seeds directly into the field?' : 'Naglipat ka ba ng mga punla o direktang naghasik ng binhi sa bukid?';
      assert.equal(validateModelOutput({ kind, language, text }, source, language).text, text);
      assert.throws(() => validateModelOutput({ kind, language: language === 'en' ? 'fil' : 'en', text }, source, language), { code: 'INVALID_MODEL_RESPONSE' });
      for (const acronym of ['TPR', 'DWSR', 'DAT', 'DAS']) {
        assert.throws(() => validateModelOutput({ kind, language, text: `Which ${acronym}?` }, source, language), { code: 'INVALID_MODEL_RESPONSE' });
      }
    }
  }
  assert.throws(() => validateModelOutput(sample, source, 'fil'), { code: 'INVALID_MODEL_RESPONSE' });
  assert.throws(() => validateModelOutput({ ...sample, claims: [{ ...sample.claims[0], text: 'Start at 14 DAT.' }] }, source, 'en'), { code: 'INVALID_MODEL_RESPONSE' });
  const quote = 'use LCC every 7 days from 14 DAT or 21\nDAS until early flowering';
  const output = { ...sample, claims: [{ text: 'Check every 7 days, starting 14 days after transplanting or 21 days after sowing, until early flowering.', evidenceId: 'p040-c01', quote }] };
  assert.equal(validateModelOutput(output, source, 'en').references[0]?.pdfPage, 40);
});

test('actual tester script maps selectors and keeps retry IDs only for identical submissions', async () => {
  class Element {
    value = ''; disabled = false; textContent = ''; children: unknown[] = [];
    listeners = new Map<string, (event: { preventDefault: () => void }) => Promise<void>>();
    addEventListener(event: string, callback: (event: { preventDefault: () => void }) => Promise<void>) { this.listeners.set(event, callback); }
    append(...children: unknown[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    focus() {}
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const payloads: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>(done => { release = done; });
  const script = await readFile('dev/backend-tester/public/tester.js', 'utf8');
  const html = await readFile('dev/backend-tester/public/index.html', 'utf8');
  assert.match(html, /value="en">English/);
  assert.match(html, /value="fil">Filipino/);
  runInNewContext(script, {
    document: { querySelector: element, createElement: () => new Element() }, crypto,
    fetch: async (url: string, init?: { body: string }) => {
      if (url === '/api/document') return { ok: true, json: async () => ({}) };
      assert.equal(url, '/api/chat');
      payloads.push(JSON.parse(init!.body));
      if (payloads.length === 1) await gate;
      if (payloads.length <= 2) return { ok: false, json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'test failure' } }) };
      return { ok: true, json: async () => ({ conversationId: 'test-conversation', assistantMessage: { kind: 'clarification', text: 'test-only answer', references: [] } }) };
    },
  });
  const submit = () => element('#chat-form').listeners.get('submit')!({ preventDefault() {} });
  element('#question').value = 'Para saan ang chart?'; element('#language').value = 'en';
  const pending = submit();
  assert.equal(element('#language').disabled, true);
  release?.(); await pending;
  assert.equal(element('#language').disabled, false);
  await submit();
  assert.equal(payloads[0]?.language, 'en');
  assert.equal(payloads[0]?.clientMessageId, payloads[1]?.clientMessageId);
  element('#language').value = 'fil'; await submit();
  assert.equal(payloads[2]?.language, 'fil');
  assert.notEqual(payloads[2]?.clientMessageId, payloads[1]?.clientMessageId);
  element('#question').value = 'Para saan ang chart?'; element('#language').value = 'en'; await submit();
  assert.equal(payloads[3]?.conversationId, 'test-conversation');
  assert.equal(payloads[3]?.language, 'en');
  assert.notEqual(payloads[3]?.clientMessageId, payloads[2]?.clientMessageId);
});

test('invalid IDs, unreviewed IDs, unsupported quotes and general response kinds are rejected', () => {
  for (const id of ['p999-c01', 'p053-c01']) {
    assert.throws(() => validateModelOutput({ ...sample, claims: [{ ...sample.claims[0], evidenceId: id }] }, source, 'en'),
      { code: 'INVALID_MODEL_RESPONSE' });
  }
  assert.throws(() => validateModelOutput({ ...sample, claims: [{ ...sample.claims[0], quote: 'fabricated source passage text' }] }, source, 'en'),
    { code: 'INVALID_MODEL_RESPONSE' });
  assert.throws(() => validateModelOutput({ kind: 'general', text: 'Do this' }, source, 'en'), { code: 'INVALID_MODEL_RESPONSE' });
});

test('HTTP invalid model evidence becomes a controlled error without fabricated references', async t => {
  const { post } = await start(t, { provider: async () => result({ ...sample, claims: [{ ...sample.claims[0], evidenceId: 'p053-c01' }] }) });
  const response = await post();
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, 'INVALID_MODEL_RESPONSE');
  assert.equal(body.assistantMessage, undefined);
});

test('upstream failure stays an error, retries safely, and never enters conversation history', async t => {
  let calls = 0;
  const inputs: ModelMessage[][] = [];
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { message: 'secret-bearing upstream body must not escape' } }), { status: 503 });
    return new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(sample) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  };
  const provider = createDeepSeek({ apiKey: 'unit-test-only', fetcher });
  const { post } = await start(t, { provider: async messages => { inputs.push(messages); return provider(messages); } });
  const id = crypto.randomUUID();
  const failed = await post({ clientMessageId: id });
  assert.equal(failed.status, 502);
  const errorBody = await failed.text();
  assert.match(errorBody, /UPSTREAM_UNAVAILABLE/);
  assert.ok(!errorBody.includes('secret-bearing'));
  assert.equal((await post({ clientMessageId: id })).status, 200);
  assert.equal(calls, 2);
  assert.equal(inputs[1]?.length, 3);
});

test('in-flight duplicates conflict; expiry never silently creates another existing session', async t => {
  let clock = 1000;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(done => { release = done; });
  let entered: (() => void) | undefined;
  const ready = new Promise<void>(done => { entered = done; });
  let calls = 0;
  const { post } = await start(t, { now: () => clock, provider: async () => { calls++; entered?.(); await gate; return result(); } });
  const id = crypto.randomUUID();
  const first = post({ clientMessageId: id });
  await ready;
  const duplicate = await post({ clientMessageId: id });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'REQUEST_IN_PROGRESS');
  release?.();
  const body = await (await first).json();
  assert.equal(calls, 1);
  clock += 60 * 60 * 1000 + 1;
  const expired = await post({ conversationId: body.conversationId });
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).error.code, 'SESSION_EXPIRED');
});

test('request validation rejects invalid language, blank messages and malformed image input', async t => {
  let calls = 0;
  const { post } = await start(t, { provider: async () => { calls++; return result(); } });
  for (const override of [{ language: 'fr' }, { language: ['en'] }, { message: ' ' }, { image: { mimeType: 'image/png', base64: 'x' } }]) {
    assert.equal((await post(override)).status, 400);
  }
  assert.equal(calls, 0);
});

test('provider has finite output/timeout, records actual usage, and does not retry a failure', async () => {
  let calls = 0;
  const provider = createDeepSeek({ apiKey: 'unit-test-only', timeoutMs: 25, fetcher: async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(String(options?.body)).max_tokens, 900);
    assert.ok(options?.signal);
    return new Response('', { status: 429, headers: { 'Retry-After': '3' } });
  } });
  await assert.rejects(provider([{ role: 'user', content: 'test' }]), { code: 'RATE_LIMITED', retryAfter: '3' });
  assert.equal(calls, 1);
});

test('malformed or truncated provider output is rejected without returning raw bodies', async () => {
  for (const body of ['not-json', JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }], usage: {} })]) {
    const provider = createDeepSeek({ apiKey: 'unit-test-only', fetcher: async () => new Response(body) });
    await assert.rejects(provider([{ role: 'user', content: 'test' }]), { code: 'INVALID_MODEL_RESPONSE' });
  }
});

test('provider timeout is a controlled retryable error, not an outside-source answer', async () => {
  const provider = createDeepSeek({ apiKey: 'unit-test-only', fetcher: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  await assert.rejects(provider([{ role: 'user', content: 'test' }]), { code: 'REQUEST_TIMEOUT', retryable: true });
});

test('tester is served only when explicitly enabled; its assets are separate from the app', async t => {
  const { base } = await start(t, { testerDirectory: resolve('dev/backend-tester/public') });
  const response = await fetch(`${base}/dev/backend-tester/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Development only/);
  assert.equal((await fetch(`${base}/dev/backend-tester/tester.js`)).status, 200);
  assert.equal((await fetch(`${base}/dev/backend-tester/server.ts`)).status, 404);
  assert.equal((await fetch(`${base}/dev/provider-samples/photo.jpg`)).status, 404);
});

test('development trace distinguishes DeepSeek from an idempotent application-cache replay', async t => {
  const traces: RequestTrace[] = [];
  let calls = 0;
  const provider = createDeepSeek({ apiKey: 'unit-test-only', fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ id: 'fixture-response-id', model: 'fixture-model',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(sample) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  } });
  const { post } = await start(t, { provider, testerDirectory: resolve('dev/backend-tester/public'), onTrace: trace => traces.push(trace) });
  const id = crypto.randomUUID();
  const first = await post({ clientMessageId: id });
  const body = await first.json();
  assert.equal(first.headers.get('x-local-request-id'), traces[0]?.requestId);
  assert.equal(traces[0]?.responseOrigin, 'DeepSeek');
  assert.equal(traces[0]?.upstreamHttpStatus, 200);
  assert.equal(traces[0]?.providerResponseId, 'fixture-response-id');
  assert.deepEqual(traces[0]?.usage, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
  assert.equal(traces[0]?.modelDecision, 'grounded');
  assert.equal(traces[0]?.apiStatus, 200);
  assert.ok(Number.isFinite(Date.parse(traces[0]!.timestamp)) && traces[0]!.elapsedMs >= 0);
  assert.deepEqual(await (await post({ clientMessageId: id })).json(), body);
  assert.equal(calls, 1);
  assert.equal(traces[1]?.responseOrigin, 'application cache');
  assert.equal(traces[1]?.upstreamAttempted, false);
  assert.equal(traces[1]?.usage, null);
  assert.equal(traces[1]?.providerResponseId, null);
  assert.notEqual(traces[1]?.requestId, traces[0]?.requestId);
  assert.ok(!JSON.stringify(traces).includes('unit-test-only'));
  assert.ok(!JSON.stringify(traces).includes('Leaf Color Chart'));
});

test('harvesting limitation uses a local template only after the provider decision; failures remain errors', async t => {
  const traces: RequestTrace[] = [];
  let calls = 0;
  const provider = createDeepSeek({ apiKey: 'unit-test-only', fetcher: async () => {
    calls++;
    if (calls === 2) return new Response('private upstream error', { status: 503 });
    return new Response(JSON.stringify({ id: 'fixture-limitation-id', model: 'fixture-model',
      choices: [{ finish_reason: 'stop', message: { content: '{"kind":"source_limitation"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } }));
  } });
  const { post } = await start(t, { provider, testerDirectory: resolve('dev/backend-tester/public'), onTrace: trace => traces.push(trace) });
  const response = await post({ message: 'When should I harvest my rice?' });
  const body = await response.json();
  assert.equal(body.assistantMessage.kind, 'clarification');
  assert.match(body.assistantMessage.text, /cannot yet verify/);
  assert.equal(traces[0]?.responseOrigin, 'local');
  assert.equal(traces[0]?.upstreamAttempted, true);
  assert.equal(traces[0]?.modelDecision, 'source_limitation');
  assert.equal(traces[0]?.providerResponseId, 'fixture-limitation-id');
  const failed = await post({ message: 'When should I harvest my rice?' });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).assistantMessage, undefined);
  assert.equal(traces[1]?.upstreamHttpStatus, 503);
  assert.equal(traces[1]?.responseOrigin, 'local');
  assert.equal(traces[1]?.apiStatus, 502);
  assert.equal(traces[1]?.usage, null);
  assert.equal(traces[1]?.providerResponseId, null);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(traces).includes('harvest'));
  assert.ok(!JSON.stringify(traces).includes('private upstream'));
});

test('local validation has no upstream attempt and production does not enable development tracing', async t => {
  const traces: RequestTrace[] = [];
  let calls = 0;
  const provider = async () => { calls++; return result(); };
  const development = await start(t, { provider, testerDirectory: resolve('dev/backend-tester/public'), onTrace: trace => traces.push(trace) });
  assert.equal((await development.post({ message: ' ' })).status, 400);
  assert.equal(traces[0]?.responseOrigin, 'local');
  assert.equal(traces[0]?.upstreamAttempted, false);
  const production = await start(t, { provider, onTrace: trace => traces.push(trace) });
  const response = await production.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-local-request-id'), null);
  assert.equal(traces.length, 1);
  assert.equal(calls, 1);
});


const outsideQuestion = 'Why does the Moon have phases?';
const outsideResult = (question = outsideQuestion, language = 'en') => result({ kind: 'outside', language,
  unsupported: { question, basis: 'unrelated_to_rice_crop_management' } });
const generalResult = (language = 'en') => result({ kind: 'general', language, text: language === 'en' ? 'The lit portion changes as the Moon orbits Earth.' : 'Nagbabago ang nakikitang maliwanag na bahagi habang umiikot ang Buwan sa Daigdig.' });
const consentPost = (base: string, body: Record<string, unknown>) => fetch(`${base}/api/consent`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const decisionFor = (body: ChatResponseLike, overrides: Record<string, unknown> = {}) => ({
  conversationId: body.conversationId, pendingId: body.pendingGeneral.id, clientActionId: crypto.randomUUID(), decision: 'continue', language: 'en', ...overrides,
});
interface ChatResponseLike { conversationId: string; pendingGeneral: { id: string; question: string } }

test('consent stores exact question; Cancel is local, localized and idempotent, with no general call', async t => {
  let calls = 0;
  const { post, base } = await start(t, { provider: async () => { calls++; return outsideResult(outsideQuestion, 'fil'); } });
  const body = await (await post({ message: outsideQuestion, language: 'fil' })).json();
  assert.equal(calls, 1);
  assert.equal(body.assistantMessage.kind, 'consent_prompt');
  assert.equal(body.assistantMessage.text, 'Hindi ito saklaw ng PalayCheck. Gusto mo bang magpatuloy sa pangkalahatang sagot ng AI?');
  assert.deepEqual(body.assistantMessage.references, []);
  assert.equal(body.pendingGeneral.question, outsideQuestion);
  const blocked = await post({ conversationId: body.conversationId });
  assert.equal((await blocked.json()).error.code, 'CONSENT_PENDING');
  const action = decisionFor(body, { decision: 'cancel', language: 'fil' });
  const cancelled = await (await consentPost(base, action)).json();
  assert.equal(cancelled.assistantMessage.kind, 'acknowledgement');
  assert.equal(cancelled.assistantMessage.text, 'Kinansela ang pangkalahatang sagot.');
  assert.equal(cancelled.pendingGeneral, null);
  assert.deepEqual(await (await consentPost(base, action)).json(), cancelled);
  assert.equal(calls, 1);
  assert.equal((await consentPost(base, { ...action, decision: 'continue' })).status, 400);
  assert.equal((await consentPost(base, { ...action, clientActionId: crypto.randomUUID() })).status, 409);
});

test('Continue is one-question only, idempotent and language-selected; general history never reaches grounding', async t => {
  const inputs: ModelMessage[][] = [];
  const { post, base } = await start(t, { provider: async messages => {
    inputs.push(messages);
    return inputs.length === 1 || inputs.length === 4 ? outsideResult() : inputs.length === 2 ? generalResult('fil') : result();
  } });
  const body = await (await post({ message: outsideQuestion })).json();
  assert.equal(body.assistantMessage.text, 'This is outside PalayCheck. Would you like a general AI answer?');
  assert.equal(inputs.length, 1);
  const action = decisionFor(body, { language: 'fil' });
  const response = await (await consentPost(base, action)).json();
  assert.equal(response.assistantMessage.kind, 'general');
  assert.deepEqual(response.assistantMessage.references, []);
  assert.equal(response.pendingGeneral, null);
  assert.match(inputs[1]![0]!.content, /Filipino/);
  assert.equal(inputs[1]![1]!.content, outsideQuestion);
  assert.equal(inputs[1]!.length, 2);
  assert.ok(!JSON.stringify(inputs[1]).includes('reviewedEvidence'));
  assert.deepEqual(await (await consentPost(base, action)).json(), response);
  assert.equal(inputs.length, 2);
  const grounded = await (await post({ conversationId: body.conversationId })).json();
  assert.equal(grounded.assistantMessage.kind, 'grounded');
  assert.ok(!JSON.stringify(inputs[2]).includes(response.assistantMessage.text));
  assert.equal((await consentPost(base, { ...action, clientActionId: crypto.randomUUID() })).status, 409);
  assert.equal(inputs.length, 3);
  const nextPending = await (await post({ conversationId: body.conversationId, message: outsideQuestion })).json();
  assert.notEqual(nextPending.pendingGeneral.id, body.pendingGeneral.id);
  assert.deepEqual(await (await consentPost(base, action)).json(), response);
  assert.equal(inputs.length, 4);
  assert.equal((await post({ conversationId: body.conversationId })).status, 409);
  assert.equal((await consentPost(base, decisionFor(nextPending, { decision: 'cancel' }))).status, 200);
});

test('consent rejects absent, stale, mismatched and replacement-question actions; expiry remains explicit', async t => {
  let current = 100;
  const { post, base } = await start(t, { now: () => current, provider: async () => outsideResult() });
  const body = await (await post({ message: outsideQuestion })).json();
  const another = await (await post({ message: outsideQuestion })).json();
  const action = decisionFor(body);
  for (const mutation of [{ pendingId: 'wrong' }, { pendingId: another.pendingGeneral.id }]) {
    const response = await consentPost(base, { ...action, ...mutation });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'STALE_CONSENT');
  }
  for (const mutation of [{ pendingId: null }, { question: 'replacement' }, { decision: 'yes' }, { decision: ['continue'] }, { language: ['en'] }, { language: 'tl' }, { clientActionId: '' }]) {
    assert.equal((await consentPost(base, { ...action, ...mutation })).status, 400);
  }
  assert.equal((await consentPost(base, { ...action, conversationId: 'missing' })).status, 410);
  current += 60 * 60 * 1000;
  assert.equal((await consentPost(base, action)).status, 410);
});

test('failed Continue preserves pending and same action retry; in-flight duplicate cannot generate twice', async t => {
  let calls = 0;
  let release!: () => void;
  let entered!: () => void;
  const reachedProvider = new Promise<void>(done => { entered = done; });
  const gate = new Promise<void>(done => { release = done; });
  const { post, base } = await start(t, { provider: async () => {
    calls++;
    if (calls === 1) return outsideResult();
    if (calls === 2) throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Test failure.', true);
    entered();
    await gate;
    return generalResult();
  } });
  const body = await (await post({ message: outsideQuestion })).json();
  const action = decisionFor(body);
  assert.equal((await consentPost(base, action)).status, 502);
  assert.equal((await consentPost(base, { ...action, language: 'fil' })).status, 400);
  const pending = consentPost(base, action);
  await reachedProvider;
  assert.equal((await consentPost(base, action)).status, 409);
  assert.equal((await consentPost(base, { ...action, clientActionId: crypto.randomUUID(), decision: 'cancel' })).status, 409);
  release();
  const completed = await (await pending).json();
  assert.equal(completed.assistantMessage.kind, 'general');
  assert.deepEqual(await (await consentPost(base, action)).json(), completed);
  assert.equal(calls, 3);
});

test('partial coverage preserves validated references and consents only to stored unsupported substring', async t => {
  const inputs: ModelMessage[][] = [];
  const { post, base } = await start(t, { provider: async messages => {
    inputs.push(messages);
    return inputs.length === 1 ? result({ ...sample, unsupported: { question: outsideQuestion, basis: 'unrelated_to_rice_crop_management' } }) : generalResult();
  } });
  const message = `What is the Leaf Color Chart used for? ${outsideQuestion}`;
  const body = await (await post({ message })).json();
  assert.equal(body.assistantMessage.kind, 'grounded');
  assert.equal(body.assistantMessage.references[0].evidenceId, 'p038-c01');
  assert.equal(body.pendingGeneral.question, outsideQuestion);
  await consentPost(base, decisionFor(body));
  assert.equal(inputs[1]![1]!.content, outsideQuestion);
  assert.ok(!inputs[1]![1]!.content.includes('Leaf Color Chart'));
});

test('invalid partial evidence, fabricated pending portions and invalid general output fail closed', async t => {
  for (const output of [
    { ...sample, unsupported: { question: 'not in request', basis: 'unrelated_to_rice_crop_management' } },
    { ...sample, unsupported: { question: outsideQuestion, basis: 'not_in_reviewed_evidence' } },
    { ...sample, claims: [{ ...sample.claims[0], evidenceId: 'p053-c01' }], unsupported: { question: outsideQuestion, basis: 'unrelated_to_rice_crop_management' } },
  ]) {
    const { post } = await start(t, { provider: async () => result(output) });
    assert.equal((await post({ message: outsideQuestion })).status, 422);
  }
  for (const output of [
    { kind: 'general', language: 'fil', text: 'Wrong selected language.' },
    { kind: 'general', language: 'en', text: 'Invented citation.', references: [{ evidenceId: 'p038-c01' }] },
    { kind: 'grounded', language: 'en', claims: sample.claims },
  ]) {
    let calls = 0;
    const { post, base } = await start(t, { provider: async () => ++calls === 1 ? outsideResult() : result(output) });
    const body = await (await post({ message: outsideQuestion })).json();
    assert.equal((await consentPost(base, decisionFor(body))).status, 422);
    assert.equal((await consentPost(base, decisionFor(body, { decision: 'cancel' }))).status, 200);
  }
});

test('scope discovery is complete section metadata plus actual scope pages, never approved answer evidence', () => {
  const context = JSON.parse(source.context);
  assert.deepEqual(context.scopeDiscoveryOnly.physicalPages.map((p: { pdfPage: number }) => p.pdfPage), [3, 5, 9]);
  assert.match(context.scopeDiscoveryOnly.physicalPages[0].text, /IRRIGATED LOWLAND RICE/);
  assert.match(context.scopeDiscoveryOnly.physicalPages[1].text, /Postharvest Management/);
  assert.equal(source.reviewed.has('p009-c01'), false);
});


test('tester consent controls lock duplicates, retry IDs safely and retain localized warnings without references', async () => {
  class Element {
    value = ''; disabled = false; textContent = ''; className = ''; children: Element[] = [];
    listeners = new Map<string, (event?: unknown) => Promise<void>>();
    addEventListener(event: string, callback: (event?: unknown) => Promise<void>) { this.listeners.set(event, callback); }
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    focus() {}
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const requests: { url: string; payload: Record<string, unknown> }[] = [];
  let resolveGate!: () => void;
  const gate = new Promise<void>(done => { resolveGate = done; });
  let actionCount = 0;
  let pendingIndex = 0;
  runInNewContext(await readFile('dev/backend-tester/public/tester.js', 'utf8'), {
    document: { querySelector: element, createElement: () => new Element() }, crypto,
    fetch: async (url: string, init?: { body: string }) => {
      if (url === '/api/document') return { ok: true, json: async () => ({}) };
      const payload = JSON.parse(init!.body);
      requests.push({ url, payload });
      if (url === '/api/chat') return { ok: true, json: async () => ({ conversationId: 'conversation',
        assistantMessage: { kind: 'grounded', text: 'Supported portion.', references: [{ pdfPage: 38 }] },
        pendingGeneral: { id: `pending-${++pendingIndex}`, question: outsideQuestion } }) };
      actionCount++;
      if (actionCount === 1) {
        await gate;
        return { ok: false, json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Retry.' } }) };
      }
      return { ok: true, json: async () => ({ conversationId: 'conversation',
        assistantMessage: { kind: 'general', text: 'General text.', references: [{ pdfPage: 99 }] }, pendingGeneral: null }) };
    },
  });
  const submit = () => element('#chat-form').listeners.get('submit')!({ preventDefault() {} });
  element('#question').value = 'Mixed question'; element('#language').value = 'en';
  await submit();
  const card = element('#answers').children[0]!;
  const controls = card.children.at(-1)!;
  const continueButton = controls.children[1]!;
  const cancelButton = controls.children[2]!;
  assert.equal(continueButton.textContent, 'Continue');
  assert.equal(element('#send').disabled, true);
  element('#language').value = 'fil';
  const first = continueButton.listeners.get('click')!();
  assert.equal(continueButton.disabled, true);
  assert.equal(cancelButton.disabled, true);
  assert.equal(element('#language').disabled, true);
  await cancelButton.listeners.get('click')!();
  assert.equal(actionCount, 1);
  resolveGate(); await first;
  assert.equal(continueButton.disabled, false);
  await continueButton.listeners.get('click')!();
  assert.equal(requests[1]!.payload.clientActionId, requests[2]!.payload.clientActionId);
  assert.equal(requests[2]!.payload.language, 'fil');
  const generalCard = element('#answers').children[1]!;
  const warning = generalCard.children.find(child => child.className === 'general-warning')!;
  assert.equal(warning.textContent, 'Hindi ito saklaw ng PalayCheck PDF');
  assert.ok(!generalCard.children.some(child => 'href' in child));
  assert.equal(controls.children.length, 0);
  assert.equal(element('#send').disabled, false);
  element('#question').value = 'Next mixed question'; element('#language').value = 'en';
  await submit();
  const nextControls = element('#answers').children[2]!.children.at(-1)!;
  await nextControls.children[1]!.listeners.get('click')!();
  const nextWarning = element('#answers').children[3]!.children.find(child => child.className === 'general-warning');
  assert.equal(nextWarning?.textContent, 'This is outside PalayCheck PDF');
  assert.equal(warning.textContent, 'Hindi ito saklaw ng PalayCheck PDF');
  assert.match(await readFile('dev/backend-tester/public/style.css', 'utf8'), /general-warning[^}]*color: #b00020/);
});


test('birthday writing requests and mixed LCC requests retain server-held consent in both selected languages', async t => {
  for (const language of ['en', 'fil']) {
    const outside = 'Write a short birthday greeting for my friend.';
    const mixed = 'Explain what the Leaf Color Chart is used for, and write a birthday greeting for my friend.';
    for (const message of [outside, mixed]) {
      let calls = 0;
      const unsupportedQuestion = message === outside ? outside : 'write a birthday greeting for my friend.';
      const { post, base } = await start(t, { provider: async messages => {
        calls++;
        const rules = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        assert.doesNotMatch(rules, /outside_scope/);
        assert.match(rules, /Writing a birthday greeting is an unrelated creative-writing task/);
        assert.match(messages.at(-1)!.content, /mixed request keeps grounded claims plus unsupported/);
        const unsupported = { question: unsupportedQuestion, basis: 'unrelated_to_rice_crop_management' };
        return result(message === outside ? { kind: 'outside', language, unsupported }
          : { ...sample, language, claims: [{ ...sample.claims[0], text: language === 'en' ? sample.claims[0]!.text : 'Sinusuri ng Leaf Color Chart ang nitrogen status ng palay.' }], unsupported });
      } });
      const body = await (await post({ message, language })).json();
      assert.equal(body.pendingGeneral.question, unsupportedQuestion);
      assert.ok(body.pendingGeneral.id);
      if (message === outside) {
        assert.equal(body.assistantMessage.kind, 'consent_prompt');
        assert.equal(body.assistantMessage.text, language === 'en'
          ? 'This is outside PalayCheck. Would you like a general AI answer?'
          : 'Hindi ito saklaw ng PalayCheck. Gusto mo bang magpatuloy sa pangkalahatang sagot ng AI?');
      } else {
        assert.equal(body.assistantMessage.kind, 'grounded');
        assert.equal(body.assistantMessage.references[0].evidenceId, 'p038-c01');
      }
      const cancelled = await (await consentPost(base, decisionFor(body, { decision: 'cancel', language }))).json();
      assert.equal(cancelled.assistantMessage.kind, 'acknowledgement');
      assert.equal(calls, 1);
    }
  }
});
