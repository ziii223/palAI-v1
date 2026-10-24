import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test, type TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createApp, type AppOptions } from '../server/app.js';
import { MAX_AUDIO_BYTES } from '../server/transcribe.js';

const execute = promisify(execFile);
// Synthetic PCM tones are parser/decoder fixtures only. Never submitted to a real provider or called speech.
function wav(seconds = 0.1, silence = false) {
  const samples = Math.round(16_000 * seconds);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  if (!silence) for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(8000 * Math.sin(index * Math.PI / 20)), 44 + index * 2);
  return bytes;
}
async function start(t: TestContext, transcription: AppOptions['transcription'] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'palai-transcribe-test-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('palai-transcribe-test-'));
  const server = createApp(undefined, { provider: async () => { throw new Error('Chat must not be called by transcription.'); },
    transcription: { apiKey: 'unit-key-never-live', model: 'whisper-large-v3-turbo', temporaryRoot: directory,
      fetcher: async () => { throw new Error('Unexpected provider request.'); }, ...transcription } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    // The absolute test root was checked above and is never supplied by an upload.
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/transcribe`;
  return { directory, url, post: (bytes = wav(), language = 'auto', name = 'sample.wav', mime = 'audio/wav') => {
    const body = new FormData(); body.set('audio', new Blob([new Uint8Array(bytes)], { type: mime }), name); body.set('language', language);
    return fetch(url, { method: 'POST', body });
  } };
}

test('multipart rejects wrong content type, malformed/duplicate/missing fields and invalid languages', async t => {
  const { url, directory } = await start(t);
  for (const body of [new FormData(), (() => { const f = new FormData(); f.set('audio', 'not a file'); f.set('language', 'auto'); return f; })()]) {
    const response = await fetch(url, { method: 'POST', body }); assert.equal(response.status, 400);
  }
  for (const modification of ['duplicate', 'extra', 'missing', 'bad-language']) {
    const body = new FormData(); body.set('audio', new Blob([new Uint8Array(wav())]), 'sample.wav');
    if (modification !== 'missing') body.set('language', modification === 'bad-language' ? 'tl' : 'en');
    if (modification === 'duplicate') body.append('audio', new Blob(), 'other.wav');
    if (modification === 'extra') body.set('question', 'not accepted');
    const response = await fetch(url, { method: 'POST', body }); assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  }
  for (const headers of [{ 'Content-Type': 'application/json' }, { 'Content-Type': 'multipart/form-data; boundary=bad' }]) {
    const response = await fetch(url, { method: 'POST', headers, body: '{}' }); assert.equal(response.status, 400);
  }
  assert.deepEqual(await readdir(directory), []);
});

test('actual audio bytes, MIME/extension, duration, silence and both upload size bounds are enforced locally', async t => {
  const { post, directory } = await start(t);
  for (const [bytes, name, mime, code] of [
    [Buffer.alloc(0), 'empty.wav', 'audio/wav', 'UNSUPPORTED_AUDIO'],
    [Buffer.from('<html>not audio</html>'), 'fake.wav', 'audio/wav', 'UNSUPPORTED_AUDIO'],
    [wav(), 'fake.mp3', 'audio/mpeg', 'UNSUPPORTED_AUDIO'],
    [wav(), 'sample.wav', 'audio/webm', 'UNSUPPORTED_AUDIO'],
    [wav(61), 'long.wav', 'audio/wav', 'UNSUPPORTED_AUDIO'],
    [wav(1, true), 'silence.wav', 'audio/wav', 'EMPTY_TRANSCRIPT'],
    [wav().subarray(0, 20), 'broken.wav', 'audio/wav', 'UNSUPPORTED_AUDIO'],
    [Buffer.alloc(MAX_AUDIO_BYTES + 1), 'large.wav', 'audio/wav', 'AUDIO_TOO_LARGE'],
    [Buffer.alloc(MAX_AUDIO_BYTES + 65 * 1024), 'huge.wav', 'audio/wav', 'AUDIO_TOO_LARGE'],
  ] as const) {
    const response = await post(bytes, 'auto', name, mime);
    assert.equal(response.status, code === 'AUDIO_TOO_LARGE' ? 413 : 400);
    assert.equal((await response.json()).error.code, code);
    assert.deepEqual(await readdir(directory), []);
  }
});

test('Groq formatting uses transcription, exact bytes, turbo, en/tl/omitted language; quota errors are sanitized and cleaned', async t => {
  let calls = 0;
  const bytes = wav();
  const { post, directory } = await start(t, { fetcher: async (input, init) => {
    assert.equal(input, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(init?.method, 'POST'); assert.ok(init?.signal);
    assert.ok(!new Headers(init.headers).has('content-type'));
    const form = init?.body; assert.ok(form instanceof FormData);
    assert.equal(form.get('model'), 'whisper-large-v3-turbo');
    assert.equal(form.get('response_format'), 'verbose_json'); assert.equal(form.get('temperature'), '0');
    assert.equal(form.get('language'), ['en', 'tl', null][calls++]);
    const file = form.get('file'); assert.ok(file instanceof File);
    assert.equal(file.name, 'recording.wav'); assert.equal(file.type, 'audio/wav');
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(bytes));
    return new Response('private-provider-body', { status: 429, headers: { 'Retry-After': '3' } });
  } });
  for (const language of ['en', 'fil', 'auto']) {
    const response = await post(bytes, language);
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '3');
    const body = await response.json(); assert.equal(body.error.code, 'RATE_LIMITED');
    assert.ok(!JSON.stringify(body).includes('private-provider-body'));
    assert.deepEqual(await readdir(directory), []);
  }
  assert.equal(calls, 3); // No retries. All responses above are deliberately mocked failures, not successful transcripts.
});

test('blank/no-speech/malformed responses and provider failure/timeout never fabricate a transcript; cleanup always runs', async t => {
  const cases = [
    { response: () => new Response(JSON.stringify({ text: ' ' })), status: 400, code: 'EMPTY_TRANSCRIPT' },
    { response: () => new Response(JSON.stringify({ text: 'hallucinated test text', segments: [{ no_speech_prob: 0.99 }] })), status: 400, code: 'EMPTY_TRANSCRIPT' },
    { response: () => new Response(JSON.stringify({ text: 'unusable test text', segments: [] })), status: 400, code: 'EMPTY_TRANSCRIPT' },
    { response: () => new Response('{}'), status: 502, code: 'UPSTREAM_UNAVAILABLE' },
    { response: () => new Response('not json'), status: 502, code: 'UPSTREAM_UNAVAILABLE' },
    { response: () => new Response('private-provider-failure', { status: 503 }), status: 502, code: 'UPSTREAM_UNAVAILABLE' },
    { response: () => { throw new DOMException('test timeout', 'TimeoutError'); }, status: 504, code: 'REQUEST_TIMEOUT' },
  ];
  for (const item of cases) {
    let calls = 0;
    const { post, directory } = await start(t, { fetcher: async () => { calls++; return item.response(); } });
    const response = await post(); assert.equal(response.status, item.status);
    const body = await response.json(); assert.equal(body.error.code, item.code); assert.equal(body.text, undefined);
    assert.equal(calls, 1); assert.deepEqual(await readdir(directory), []);
  }
});

test('real FFmpeg validators accept supported containers without rewriting bytes and reject forged short duration', async t => {
  let calls = 0;
  const { post, directory } = await start(t, { fetcher: async () => { calls++; return new Response('test outage', { status: 503 }); } });
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'palai-audio-fixtures-'));
  assert.equal(dirname(resolve(fixtureDirectory)), resolve(tmpdir()));
  assert.ok(basename(fixtureDirectory).startsWith('palai-audio-fixtures-'));
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  const input = join(fixtureDirectory, 'tone.wav'); await writeFile(input, wav());
  for (const [extension, codec, mime] of [['webm', 'libopus', 'audio/webm;codecs=opus'], ['m4a', 'aac', 'audio/mp4'],
    ['mp3', 'libmp3lame', 'audio/mpeg'], ['ogg', 'libopus', 'audio/ogg'], ['flac', 'flac', 'audio/flac']]) {
    const output = join(fixtureDirectory, `tone.${extension}`);
    await execute('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c:a', codec!, output], { timeout: 10_000, windowsHide: true });
    const response = await post(await readFile(output), 'auto', `tone.${extension}`, mime);
    assert.equal(response.status, 502, `${extension} should reach only the mocked outage`);
    assert.deepEqual(await readdir(directory), []);
  }
  assert.equal(calls, 5);
  await writeFile(input, wav(61));
  const output = join(fixtureDirectory, 'long.webm');
  await execute('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c:a', 'libopus', output], { timeout: 10_000, windowsHide: true });
  const forged = await readFile(output);
  const durationIndex = forged.indexOf(Buffer.from([0x44, 0x89, 0x88])); assert.ok(durationIndex > 0);
  forged.writeDoubleBE(100, durationIndex + 3); // Advertise 100ms; actual decoded content is still 61 seconds.
  const response = await post(forged, 'auto', 'long.webm', 'audio/webm');
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'UNSUPPORTED_AUDIO');
  assert.equal(calls, 5); assert.deepEqual(await readdir(directory), []);
});

test('actual tester audio script preserves edits, allows review/append and never auto-sends a question', async () => {
  class Element {
    value = ''; disabled = false; textContent = ''; hidden = false; src = ''; files: File[] = [];
    listeners = new Map<string, () => unknown>();
    addEventListener(event: string, listener: () => unknown) { this.listeners.set(event, listener); }
    focus() {}
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const context = { document: { querySelector: element }, navigator: {}, window: { addEventListener() {} },
    MediaRecorder: undefined, fetch: () => { throw new Error('Review/insert must not call any provider or chat endpoint.'); },
    clearInterval, clearTimeout, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } };
  runInNewContext(await readFile('dev/backend-tester/public/audio.js', 'utf8'), context);
  element('#question').value = 'existing draft';
  // Direct UI-boundary fixture text: no provider mock and not a claimed real transcript.
  runInNewContext("insertTranscript('[unit review text]', 'existing draft', 0)", context);
  assert.equal(element('#question').value, '[unit review text]');
  element('#question').value = 'farmer edited'; element('#question').listeners.get('input')!();
  runInNewContext("insertTranscript('[second unit review text]', '[unit review text]', 1)", context);
  assert.equal(element('#question').value, 'farmer edited');
  assert.equal(element('#transcript').value, '[second unit review text]');
  assert.match(element('#audio-status').textContent, /edited draft was preserved/);
  element('#append-transcript').listeners.get('click')!();
  assert.equal(element('#question').value, 'farmer edited\n[second unit review text]');
  assert.match(element('#audio-status').textContent, /explicitly press Send/);
  assert.equal(element('#record').disabled, true);
});

test('exact 10 MiB valid audio reaches only a mocked outage; temp files disappear on model/config failures', async t => {
  const short = wav();
  const padded = Buffer.alloc(MAX_AUDIO_BYTES);
  short.copy(padded); padded.writeUInt32LE(padded.length - 8, 4);
  padded.write('JUNK', short.length); padded.writeUInt32LE(padded.length - short.length - 8, short.length + 4);
  let calls = 0;
  const normal = await start(t, { fetcher: async () => { calls++; return new Response('outage', { status: 503 }); } });
  assert.equal((await normal.post(padded)).status, 502);
  assert.equal(calls, 1); assert.deepEqual(await readdir(normal.directory), []);
  for (const options of [{ model: 'not-the-configured-turbo' }, { apiKey: '' }]) {
    const { post, directory } = await start(t, options);
    assert.equal((await post()).status, 503); assert.deepEqual(await readdir(directory), []);
  }
});

test('two concurrent transcriptions are bounded and failures release capacity and remove uploads', async t => {
  let calls = 0;
  let entered!: () => void; const bothEntered = new Promise<void>(done => { entered = done; });
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  const { post, directory } = await start(t, { fetcher: async () => {
    if (++calls === 2) entered();
    await gate;
    return new Response('outage', { status: 503 });
  } });
  const first = post(); const second = post();
  await bothEntered;
  const limited = await post(); assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  release();
  assert.equal((await first).status, 502); assert.equal((await second).status, 502);
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await post()).status, 502); assert.equal(calls, 3);
  assert.deepEqual(await readdir(directory), []);
});

test('recording MIME/timer/Stop/Cancel release tracks; transcription failure preserves the draft with no chat send', async () => {
  class Element {
    value = ''; disabled = false; textContent = ''; files: File[] = [];
    listeners = new Map<string, () => unknown>();
    addEventListener(event: string, listener: () => unknown) { this.listeners.set(event, listener); }
    focus() {}
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  let stoppedTracks = 0;
  let current!: Recorder;
  class Recorder {
    static isTypeSupported(mime: string) { return mime === 'audio/webm;codecs=opus'; }
    state = 'inactive'; mimeType: string;
    ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
    constructor(_stream: unknown, options: { mimeType: string }) { this.mimeType = options.mimeType; current = this; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['unit-container-placeholder'], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const timers: { fn: () => void; ms: number }[] = [];
  let requests = 0;
  const context = { document: { querySelector: element }, window: { addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stoppedTracks++; } }] }) } },
    MediaRecorder: Recorder, Blob, File, FormData, AbortController, performance,
    setInterval: () => 1, clearInterval() {}, setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:unit', revokeObjectURL() {} },
    fetch: async (url: string, init: { body: FormData }) => {
      requests++; assert.equal(url, '/api/transcribe');
      const file = init.body.get('audio'); assert.ok(file instanceof File);
      assert.equal(file.name, 'recording.webm'); assert.equal(file.type, 'audio/webm;codecs=opus');
      assert.equal(init.body.get('language'), 'fil');
      return { ok: false, json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Mocked outage.' } }) };
    } };
  runInNewContext(await readFile('dev/backend-tester/public/audio.js', 'utf8'), context);
  element('#question').value = 'keep my draft';
  await element('#record').listeners.get('click')!();
  assert.equal(current.state, 'recording'); assert.equal(requests, 0);
  assert.equal(element('#stop-recording').disabled, false);
  assert.ok(timers.some(timer => timer.ms === 59_000));
  element('#stop-recording').listeners.get('click')!();
  assert.ok(stoppedTracks > 0); assert.equal(requests, 0);
  assert.equal(element('#transcribe').disabled, false);
  element('#spoken-language').value = 'fil';
  await element('#transcribe').listeners.get('click')!();
  assert.equal(requests, 1); assert.equal(element('#question').value, 'keep my draft');
  assert.match(element('#audio-status').textContent, /UPSTREAM_UNAVAILABLE/);
  const before = stoppedTracks;
  await element('#record').listeners.get('click')!();
  element('#cancel-audio').listeners.get('click')!();
  assert.ok(stoppedTracks > before); assert.equal(requests, 1);
  await element('#record').listeners.get('click')!();
  timers.filter(timer => timer.ms === 59_000).at(-1)!.fn();
  assert.equal(current.state, 'inactive'); assert.equal(requests, 1);
});
