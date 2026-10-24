import type { Request as ExpressRequest } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import type { TranscriptionLanguage, TranscribeResponse } from '../shared/types.js';
import { ApiError, isRecord } from './errors.js';

const execute = promisify(execFile);
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const PCM_BYTES_PER_SECOND = 16_000 * 2;
const audioError = (message = 'Send a valid supported audio recording.') => new ApiError(400, 'UNSUPPORTED_AUDIO', message);
const emptySpeech = () => new ApiError(400, 'EMPTY_TRANSCRIPT', 'No usable speech was detected. Please record again.');

interface AudioFormat { extension: string; mime: string; demuxer: string; aliases: string[]; extensions: string[] }
const formats: AudioFormat[] = [
  { extension: 'webm', mime: 'audio/webm', demuxer: 'matroska', aliases: ['audio/webm', 'video/webm'], extensions: ['.webm'] },
  { extension: 'm4a', mime: 'audio/mp4', demuxer: 'mov', aliases: ['audio/mp4', 'audio/x-m4a', 'video/mp4'], extensions: ['.m4a', '.mp4'] },
  { extension: 'wav', mime: 'audio/wav', demuxer: 'wav', aliases: ['audio/wav', 'audio/x-wav', 'audio/wave'], extensions: ['.wav'] },
  { extension: 'mp3', mime: 'audio/mpeg', demuxer: 'mp3', aliases: ['audio/mpeg', 'audio/mp3'], extensions: ['.mp3', '.mpeg', '.mpga'] },
  { extension: 'ogg', mime: 'audio/ogg', demuxer: 'ogg', aliases: ['audio/ogg', 'application/ogg'], extensions: ['.ogg', '.opus'] },
  { extension: 'flac', mime: 'audio/flac', demuxer: 'flac', aliases: ['audio/flac', 'audio/x-flac'], extensions: ['.flac'] },
];

function identifyAudio(bytes: Buffer, file: File): AudioFormat {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('ascii');
  let format: AudioFormat | undefined;
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    && bytes.subarray(0, 4096).includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) format = formats[0];
  else if (ascii(4, 8) === 'ftyp') format = formats[1];
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') format = formats[2];
  else if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) format = formats[3];
  else if (ascii(0, 4) === 'OggS') format = formats[4];
  else if (ascii(0, 4) === 'fLaC') format = formats[5];
  const mime = file.type.split(';')[0]?.trim().toLowerCase();
  const extension = extname(file.name).toLowerCase();
  if (!format || (mime && mime !== 'application/octet-stream' && !format.aliases.includes(mime))
    || !format.extensions.includes(extension)) throw audioError('The audio bytes, MIME type and filename format must agree. Use WebM, MP4/M4A, WAV, MP3, Ogg or FLAC.');
  return format;
}

async function parseUpload(request: ExpressRequest): Promise<{ file: File; language: TranscriptionLanguage }> {
  const contentType = request.headers['content-type'];
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Send multipart/form-data with audio and language.');
  }
  let form: FormData;
  try {
    if (!Buffer.isBuffer(request.body)) throw new Error('Missing multipart body.');
    form = await new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': contentType },
      body: new Blob([new Uint8Array(request.body)]) }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_REQUEST', 'The audio upload was incomplete or malformed.');
  }
  const keys = [...form.keys()];
  const file = form.get('audio');
  const language = form.get('language');
  if (keys.length !== 2 || !keys.includes('audio') || !keys.includes('language') || !(file instanceof File)
    || (language !== 'en' && language !== 'fil' && language !== 'auto')) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Send exactly one audio file and language en, fil or auto.');
  }
  if (file.size > MAX_AUDIO_BYTES) throw new ApiError(413, 'AUDIO_TOO_LARGE', 'Audio must be at most 10 MiB.');
  if (!file.size) throw audioError('The recording is empty. Please record again.');
  return { file, language };
}

async function inspectAudio(path: string, format: AudioFormat): Promise<void> {
  const common = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format.demuxer];
  try {
    const probe = await execute('ffprobe', [...common, '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', path],
      { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
    const metadata: unknown = JSON.parse(probe.stdout);
    if (!isRecord(metadata) || !Array.isArray(metadata.streams) || metadata.streams.length !== 1
      || !isRecord(metadata.streams[0]) || metadata.streams[0].codec_type !== 'audio') throw audioError('Send a file containing exactly one audio track and no video.');
    if (isRecord(metadata.format) && Number(metadata.format.duration) > 60) throw audioError('Audio must be no longer than 60 seconds.');
    // Decode the complete stream: browser WebM often has no duration header; headers alone are not a duration check.
    const decoded = await execute('ffmpeg', ['-nostdin', ...common, '-xerror', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '16000',
      '-af', 'aresample=async=1:first_pts=0',
      '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'],
    { timeout: 10_000, maxBuffer: 60 * PCM_BYTES_PER_SECOND + 2, encoding: 'buffer', windowsHide: true });
    const pcm = decoded.stdout;
    if (pcm.length > 60 * PCM_BYTES_PER_SECOND) throw audioError('Audio must be no longer than 60 seconds.');
    if (!pcm.length) throw emptySpeech();
    let energy = 0;
    for (let index = 0; index + 1 < pcm.length; index += 2) energy += pcm.readInt16LE(index) ** 2;
    // Conservative near-digital-silence gate, not a speech detector. Other unusable speech is checked with provider segment metadata.
    if (Math.sqrt(energy / (pcm.length / 2)) < 2) throw emptySpeech();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isRecord(error) && error.code === 'ENOENT') throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'Audio validation tools are unavailable. Please try again later.', true);
    if (isRecord(error) && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw audioError('Audio must be no longer than 60 seconds.');
    throw audioError('The audio could not be decoded or validated within the time limit. Please record again.');
  }
}

export function createTranscribeHandler(options: {
  apiKey?: string; model?: string; fetcher?: typeof fetch; timeoutMs?: number; temporaryRoot?: string;
} = {}) {
  let active = 0;
  const fetcher = options.fetcher ?? fetch;
  return async (request: ExpressRequest): Promise<TranscribeResponse> => {
    if (active >= 2) throw new ApiError(429, 'RATE_LIMITED', 'Two recordings are already processing. Please try again shortly.', true);
    active++;
    let directory: string | undefined;
    let temporaryFile: string | undefined;
    try {
      const { file, language } = await parseUpload(request);
      const bytes = Buffer.from(await file.arrayBuffer());
      const format = identifyAudio(bytes, file);
      directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'palai-audio-'));
      const path = join(directory, `input.${format.extension}`);
      temporaryFile = path;
      await writeFile(path, bytes, { mode: 0o600 });
      await inspectAudio(path, format);
      const key = options.apiKey ?? process.env.GROQ_API_KEY;
      if (!key?.trim()) throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'Transcription is not configured. Please try again later.', true);
      const model = options.model ?? process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo';
      if (model !== 'whisper-large-v3-turbo') throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'The configured transcription model is not supported.');
      const body = new FormData();
      // Keep original bytes and a matching filename/MIME; never convert or disguise an unsupported upload.
      body.set('file', new Blob([new Uint8Array(bytes)], { type: format.mime }), `recording${extname(file.name).toLowerCase()}`);
      body.set('model', model);
      body.set('response_format', 'verbose_json');
      body.set('temperature', '0');
      if (language !== 'auto') body.set('language', language === 'fil' ? 'tl' : 'en');
      let response: Response;
      try {
        response = await fetcher('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${key}` }, body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429) {
            const retry = response.headers.get('retry-after') || '';
            throw new ApiError(429, 'RATE_LIMITED', 'The transcription service is busy. Please try again later.', true, /^\d{1,5}$/.test(retry) ? retry : undefined);
          }
          if (response.status === 400 || response.status === 422) throw audioError('The transcription service could not read this recording. Please record again.');
          throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Transcription could not be completed. Please try again.', true);
        }
        const result: unknown = await response.json();
        if (!isRecord(result) || typeof result.text !== 'string' || result.text.length > 16_000) {
          throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The transcription response was invalid. Please try again.', true);
        }
        if (!result.text.trim() || (Array.isArray(result.segments) && result.segments.length === 0)
          || (Array.isArray(result.segments) && result.segments.length > 0 && result.segments.every(segment =>
            isRecord(segment) && typeof segment.no_speech_prob === 'number' && segment.no_speech_prob >= 0.6))) throw emptySpeech();
        return { text: result.text.trim() };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ApiError(504, 'REQUEST_TIMEOUT', 'Transcription timed out. Please try again.', true);
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Transcription could not be completed. Please try again.', true);
      }
    } finally {
      try {
        if (temporaryFile) await rm(temporaryFile, { force: true });
        if (directory) await rmdir(directory);
      }
      finally { active--; }
    }
  };
}
