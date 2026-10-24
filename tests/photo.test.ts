import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { before, after, test, type TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createApp, type AppOptions } from '../server/app.js';
import { createDeepSeek, type ModelMessage, type ModelResult } from '../server/deepseek.js';
import { parseImage, validateImage, MAX_IMAGE_BYTES } from '../server/image.js';
import { loadSource } from '../server/source.js';
import type { ChatImage } from '../shared/types.js';
import type { RequestTrace } from '../server/request-trace.js';

const execute = promisify(execFile);
const source = await loadSource();
const directory = await mkdtemp(join(tmpdir(), 'palai-photo-fixtures-'));
assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('palai-photo-fixtures-'));
const images = new Map<string, ChatImage>();
before(async () => {
  for (const [name, size, mime] of [['a.png', '32x16', 'image/png'], ['b.jpg', '16x32', 'image/jpeg'], ['c.webp', '32x16', 'image/webp'], ['wide.png', '9000x2', 'image/png']]) {
    const file = join(directory, name!);
    await execute('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red:s=${size}`, '-frames:v', '1', file], { timeout: 10_000, windowsHide: true });
    images.set(name!, { mimeType: mime as ChatImage['mimeType'], base64: (await readFile(file)).toString('base64') });
  }
});
after(() => rm(directory, { recursive: true, force: true })); // Absolute, checked, synthetic test-fixture root only.
const assessment = { language: 'en', status: 'observed', observations: ['A red shape is visible (unit stub).'] };
const sample = { kind: 'grounded', language: 'en', claims: [{ text: 'The Leaf Color Chart visually assesses rice nitrogen status.',
  supports: [{ evidenceId: 'p038-c01', quote: 'A tool to visually assess the nitrogen status of the rice crop.' }] }] };
const result = (output: unknown): ModelResult => ({ output, usage: { model: 'unit-only', promptTokens: 1, completionTokens: 1, totalTokens: 2, providerLatencyMs: 1 } });
async function start(t: TestContext, options: AppOptions = {}) {
  const server = createApp(undefined, { source, ...options }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(done => server.close(() => done())));
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const send = (route: string, body: unknown) => fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { send, post: (overrides: Record<string, unknown> = {}) => send('chat', { conversationId: null, clientMessageId: crypto.randomUUID(),
    language: 'en', message: 'What is the Leaf Color Chart used for?', image: null, ...overrides }) };
}

test('strict image shape/canonical base64 and decoded size are checked before any provider request', async t => {
  const { post } = await start(t, { provider: async () => { throw new Error('Invalid photos must not call provider.'); } });
  for (const image of [{ mimeType: ['image/png'], base64: 'AAAA' }, { mimeType: 'image/gif', base64: 'AAAA' },
    { mimeType: 'image/png', base64: 'bad' }, { mimeType: 'image/png', base64: 'AB==' }, { mimeType: 'image/png', base64: 'data:image/png;base64,AAAA' },
    { ...images.get('a.png'), unexpected: true }]) assert.equal((await post({ image })).status, 400);
  const large = { mimeType: 'image/png', base64: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') };
  assert.equal((await post({ image: large })).status, 413);
  assert.ok(parseImage({ mimeType: 'image/png', base64: Buffer.alloc(MAX_IMAGE_BYTES).toString('base64') }));
  assert.equal((await post({ message: '', image: images.get('a.png') })).status, 400);
});

test('real decoder validates JPEG/PNG/WebP, corruption, MIME mismatch, still-frame and dimension limits, with cleanup', async () => {
  const previous = (await readdir(tmpdir())).filter(name => name.startsWith('palai-image-')).sort();
  for (const name of ['a.png', 'b.jpg', 'c.webp']) await validateImage(images.get(name)!);
  await assert.rejects(validateImage({ ...images.get('a.png')!, mimeType: 'image/jpeg' }), { code: 'UNREADABLE_IMAGE' });
  const png = Buffer.from(images.get('a.png')!.base64, 'base64');
  const idat = png.indexOf('IDAT'); assert.ok(idat > 0); png[idat + 6] = (png[idat + 6] ?? 0) ^ 0xff;
  await assert.rejects(validateImage({ mimeType: 'image/png', base64: png.toString('base64') }), { code: 'UNREADABLE_IMAGE' });
  await assert.rejects(validateImage(images.get('wide.png')!), { code: 'IMAGE_TOO_LARGE' });
  const truncated = Buffer.from(images.get('b.jpg')!.base64, 'base64').subarray(0, 30);
  await assert.rejects(validateImage({ mimeType: 'image/jpeg', base64: truncated.toString('base64') }), { code: 'UNREADABLE_IMAGE' });
  const animated = Buffer.concat([Buffer.from(images.get('a.png')!.base64, 'base64').subarray(0, 8), Buffer.from([0,0,0,0]), Buffer.from('acTL'), Buffer.alloc(4)]);
  await assert.rejects(validateImage({ mimeType: 'image/png', base64: animated.toString('base64') }), { code: 'UNREADABLE_IMAGE' });
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('palai-image-')).sort(), previous);
});

test('DeepSeek adapter sends actual user text+image_url bytes and refuses image-incapable model/role without fallback', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.messages[0].content, 'unit rules');
    assert.deepEqual(body.messages[1].content, [{ type: 'text', text: 'unit image question' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${images.get('a.png')!.base64}` } }]);
    assert.equal(body.messages[1].image, undefined);
    return new Response('unit outage', { status: 503 });
  };
  const messages: ModelMessage[] = [{ role: 'system', content: 'unit rules' }, { role: 'user', content: 'unit image question', image: images.get('a.png')! }];
  await assert.rejects(createDeepSeek({ apiKey: 'unit-only', model: 'deepseek-flash', fetcher })(messages), { code: 'UPSTREAM_UNAVAILABLE' });
  await assert.rejects(createDeepSeek({ apiKey: 'unit-only', model: 'deepseek-v4-pro', fetcher })(messages), { code: 'UPSTREAM_UNAVAILABLE' });
  await assert.rejects(createDeepSeek({ apiKey: 'unit-only', fetcher })([{ role: 'assistant', content: 'bad role', image: images.get('a.png')! }]), { code: 'INVALID_REQUEST' });
  assert.equal(calls, 1);
});

test('image observations are separate from reviewed guidance; a text-only or invalid-citation model result fails closed', async t => {
  const valid = await start(t, { provider: async messages => {
    assert.deepEqual(messages.find(message => message.image)?.image, images.get('a.png'));
    assert.match(messages[0]!.content, /NOT a confirmed diagnosis/);
    return result({ ...sample, imageAssessment: assessment });
  } });
  const response = await (await valid.post({ image: images.get('a.png') })).json();
  assert.match(response.assistantMessage.text, /Visible in the photo \(not a diagnosis\)/);
  assert.match(response.assistantMessage.text, /PalayCheck guidance:/);
  assert.equal(response.assistantMessage.references[0].pdfPage, 38);
  for (const output of [sample, { ...sample, imageAssessment: { status: ['observed'], observations: ['bad'] } },
    { ...sample, imageAssessment: { ...assessment, language: 'fil' } },
    { ...sample, claims: [{ text: 'Unreviewed diagnosis', evidenceId: 'p053-c01', quote: 'unreviewed' }], imageAssessment: assessment }]) {
    const { post } = await start(t, { provider: async () => result(output) });
    assert.equal((await post({ image: images.get('a.png') })).status, 422);
  }
  const limited = await start(t, { provider: async () => result({ kind: 'source_limitation', imageAssessment: { language: 'fil', status: 'unclear', observations: [] } }) });
  const body = await (await limited.post({ language: 'fil', image: images.get('a.png') })).json();
  assert.equal(body.assistantMessage.kind, 'clarification'); assert.deepEqual(body.assistantMessage.references, []);
  assert.equal(body.pendingGeneral, null); assert.match(body.assistantMessage.text, /Hindi ko malinaw/);
  const filipino = await start(t, { provider: async () => result({ ...sample, language: 'fil',
    claims: [{ ...sample.claims[0], text: 'Sinusuri ng Leaf Color Chart ang nitrogen status ng palay.' }],
    imageAssessment: { language: 'fil', status: 'observed', observations: ['May pulang hugis sa larawan (unit stub).'] } }) });
  const translated = await (await filipino.post({ language: 'fil', image: images.get('a.png') })).json();
  assert.match(translated.assistantMessage.text, /Nakikita sa larawan \(hindi ito diagnosis\)/);
  assert.match(translated.assistantMessage.text, /Gabay ng PalayCheck/);
  assert.equal(translated.assistantMessage.references[0].pdfPage, 38);
});

test('active photo follows up, replaces without old observations, survives failed replacement and retries idempotently', async t => {
  const inputs: ModelMessage[][] = [];
  let failReplacement = true;
  const { post } = await start(t, { provider: async messages => {
    inputs.push(messages);
    const image = messages.find(message => message.image)?.image;
    if (image?.base64 === images.get('b.jpg')!.base64 && failReplacement) { failReplacement = false; throw new Error('unit outage'); }
    return result({ ...sample, imageAssessment: { language: 'en', status: 'observed', observations: [image?.base64 === images.get('a.png')!.base64 ? 'Unique old observation A.' : 'Unique new observation B.'] } });
  } });
  const first = await (await post({ image: images.get('a.png') })).json();
  await post({ conversationId: first.conversationId, message: 'Tell me more.' });
  assert.deepEqual(inputs[1]?.find(message => message.image)?.image, images.get('a.png'));
  const retryId = crypto.randomUUID();
  const replacement = { conversationId: first.conversationId, clientMessageId: retryId, message: 'Use this new photo.', image: images.get('b.jpg') };
  assert.equal((await post(replacement)).status, 500);
  await post({ conversationId: first.conversationId, message: 'Is the old photo still current?' });
  assert.deepEqual(inputs[3]?.find(message => message.image)?.image, images.get('a.png'));
  const replaced = await (await post(replacement)).json();
  assert.ok(!JSON.stringify(inputs[4]).includes('Unique old observation A'));
  assert.deepEqual(inputs[4]?.find(message => message.image)?.image, images.get('b.jpg'));
  assert.deepEqual(await (await post(replacement)).json(), replaced);
  assert.equal(inputs.length, 5);
  assert.equal((await post({ ...replacement, image: images.get('a.png') })).status, 400);
  await post({ conversationId: first.conversationId, message: 'What about this one?' });
  assert.deepEqual(inputs[5]?.find(message => message.image)?.image, images.get('b.jpg'));
  assert.ok(!JSON.stringify(inputs[5]).includes(images.get('a.png')!.base64));
});

test('photo consent stores the question and current photo; Continue is separate and general history is not grounding evidence', async t => {
  const inputs: ModelMessage[][] = [];
  const question = 'Write a birthday greeting for this picture.';
  const { post, send } = await start(t, { provider: async messages => {
    inputs.push(messages);
    if (inputs.length === 1) return result({ kind: 'outside', language: 'en', unsupported: { question, basis: 'unrelated_to_rice_crop_management' }, imageAssessment: { language: 'en', status: 'irrelevant', observations: [] } });
    if (inputs.length === 2) return result({ kind: 'general', language: 'en', text: 'Unit-only general birthday greeting.' });
    return result({ ...sample, imageAssessment: assessment });
  } });
  const pending = await (await post({ message: question, image: images.get('a.png') })).json();
  assert.equal(pending.assistantMessage.kind, 'consent_prompt');
  assert.equal(pending.assistantMessage.text, 'This is outside PalayCheck. Would you like a general AI answer?');
  const action = { conversationId: pending.conversationId, pendingId: pending.pendingGeneral.id, clientActionId: crypto.randomUUID(), decision: 'continue', language: 'en' };
  const general = await (await send('consent', action)).json(); assert.equal(general.assistantMessage.kind, 'general'); assert.deepEqual(general.assistantMessage.references, []);
  assert.deepEqual(inputs[1]?.find(message => message.image)?.image, images.get('a.png'));
  assert.deepEqual(await (await send('consent', action)).json(), general); assert.equal(inputs.length, 2);
  await post({ conversationId: pending.conversationId });
  assert.ok(!JSON.stringify(inputs[2]).includes(general.assistantMessage.text));
});

test('photo slots are bounded and expiry releases them', async t => {
  let clock = 100;
  const { post } = await start(t, { now: () => clock, provider: async () => result({ kind: 'source_limitation', imageAssessment: assessment }) });
  for (let index = 0; index < 16; index++) assert.equal((await post({ image: images.get('a.png') })).status, 200);
  assert.equal((await post({ image: images.get('a.png') })).status, 429);
  clock += 60 * 60 * 1000;
  assert.equal((await post({ image: images.get('a.png') })).status, 200);
});

test('development trace never contains image bytes or observations', async t => {
  const traces: RequestTrace[] = [];
  const provider = createDeepSeek({ apiKey: 'unit-only', fetcher: async () => new Response(JSON.stringify({ id: 'unit-photo-id', model: 'deepseek-flash',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...sample, imageAssessment: assessment }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })) });
  const { post } = await start(t, { provider, testerDirectory: resolve('dev/backend-tester/public'), onTrace: trace => traces.push(trace) });
  assert.equal((await post({ image: images.get('a.png') })).status, 200);
  assert.equal(traces[0]?.providerResponseId, 'unit-photo-id');
  assert.ok(!JSON.stringify(traces).includes(images.get('a.png')!.base64));
  assert.ok(!JSON.stringify(traces).includes('red shape'));
});

test('photo preparation normalizes orientation/size, previews, replaces and removes without sending anything', async () => {
  class Element {
    disabled = false; hidden = true; value = ''; textContent = ''; src = '';
    listeners = new Map<string, (event?: unknown) => unknown>();
    addEventListener(event: string, callback: (event?: unknown) => unknown) { this.listeners.set(event, callback); }
    removeAttribute() { this.src = ''; }
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  let closed = 0, encoded = 0, drawn = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() { drawn++; } }),
    toBlob: (callback: (blob: Blob) => void, mime: string) => { encoded++; assert.equal(mime, 'image/jpeg'); callback(new Blob([`unit-encoded-${encoded}`], { type: mime })); } };
  class Reader {
    result = ''; onload?: () => void;
    async readAsDataURL(blob: Blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload?.(); }
  }
  const context = { document: { querySelector: element, createElement: () => canvas },
    URL: { createObjectURL: () => 'blob:unit-preview', revokeObjectURL() {} }, FileReader: Reader,
    createImageBitmap: async (_file: File, options: { imageOrientation: string }) => {
      assert.equal(options.imageOrientation, 'from-image'); return { width: 4000, height: 2000, close: () => { closed++; } };
    }, fetch: () => { throw new Error('Photo selection must never send.'); } };
  runInNewContext(await readFile('dev/backend-tester/public/photo.js', 'utf8'), context);
  const select = (mime = 'image/png') => element('#photo-file').listeners.get('change')!({ target: { files: [new File(['unit-file'], 'unit.png', { type: mime })] } });
  await select();
  assert.equal(canvas.width, 2048); assert.equal(canvas.height, 1024); assert.equal(drawn, 1); assert.equal(closed, 1);
  assert.equal(element('#photo-preview').hidden, false);
  const first = runInNewContext('palaiPhotoDraft.snapshot()', context);
  assert.equal(first.image.mimeType, 'image/jpeg'); assert.equal(first.blocked, false);
  await select();
  const second = runInNewContext('palaiPhotoDraft.snapshot()', context);
  assert.notEqual(second.image.base64, first.image.base64); assert.notEqual(second.version, first.version);
  runInNewContext('palaiPhotoDraft.lock(true)', context); assert.equal(element('#remove-photo').disabled, true);
  runInNewContext('palaiPhotoDraft.lock(false)', context);
  await select('image/gif'); assert.equal(runInNewContext('palaiPhotoDraft.snapshot().blocked', context), true);
  element('#remove-photo').listeners.get('click')!();
  assert.equal(runInNewContext('palaiPhotoDraft.snapshot().image', context), null); assert.equal(element('#photo-preview').hidden, true);
  runInNewContext('createImageBitmap = undefined', context);
  await select();
  assert.equal(runInNewContext('palaiPhotoDraft.snapshot().blocked', context), true);
  assert.match(element('#photo-status').textContent, /current browser/);
});

test('tester forwards final photo, preserves retry attachment/ID, changes ID for replacement and never sends attachment alone', async () => {
  class Element {
    value = ''; disabled = false; textContent = ''; children: unknown[] = [];
    listeners = new Map<string, (event?: unknown) => Promise<void>>();
    addEventListener(event: string, callback: (event?: unknown) => Promise<void>) { this.listeners.set(event, callback); }
    append(...children: unknown[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    focus() {}
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  let image: ChatImage | null = images.get('a.png')!;
  let blocked = false, locked = false, successful = false, sent = 0;
  const requests: Record<string, unknown>[] = [];
  const context = { document: { querySelector: element, createElement: () => new Element() }, crypto,
    palaiPhotoDraft: { snapshot: () => ({ image, version: 1, blocked }), lock: (value: boolean) => { locked = value; },
      sent: () => { sent++; image = null; }, reset: () => { image = null; } },
    fetch: async (url: string, init?: { body: string }) => {
      if (url === '/api/document') return { ok: true, json: async () => ({}) };
      assert.equal(url, '/api/chat'); assert.equal(locked, true);
      requests.push(JSON.parse(init!.body));
      return successful ? { ok: true, json: async () => ({ conversationId: 'unit-conversation', assistantMessage: { kind: 'clarification', text: 'Unit-only response', references: [] }, pendingGeneral: null }) }
        : { ok: false, json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'unit outage' } }) };
    } };
  runInNewContext(await readFile('dev/backend-tester/public/tester.js', 'utf8'), context);
  const submit = () => element('#chat-form').listeners.get('submit')!({ preventDefault() {} });
  await submit(); assert.equal(requests.length, 0);
  element('#question').value = 'Unit farmer question'; element('#language').value = 'en';
  blocked = true; await submit(); assert.equal(requests.length, 0); blocked = false;
  await submit(); await submit();
  assert.equal(requests[0]?.clientMessageId, requests[1]?.clientMessageId);
  assert.deepEqual(requests[0]?.image, images.get('a.png')); assert.deepEqual(image, images.get('a.png')); assert.equal(sent, 0);
  image = images.get('b.jpg')!; successful = true; await submit();
  assert.notEqual(requests[2]?.clientMessageId, requests[1]?.clientMessageId);
  assert.deepEqual(requests[2]?.image, images.get('b.jpg')); assert.equal(image, null); assert.equal(sent, 1); assert.equal(locked, false);
});
