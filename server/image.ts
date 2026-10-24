import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatImage } from '../shared/types.js';
import { ApiError, isRecord } from './errors.js';

const execute = promisify(execFile);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_PIXELS = 16_777_216;
const unreadable = () => new ApiError(422, 'UNREADABLE_IMAGE', 'The photo could not be read. Please select a complete, still JPEG, PNG or WebP image.');

export function parseImage(value: unknown): ChatImage | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.mimeType !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType)
    || typeof value.base64 !== 'string' || !value.base64.length) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Send image as null or {mimeType, base64} using JPEG, PNG or WebP.');
  }
  if (value.base64.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The photo exceeds 4 MiB. Resize or compress it and try again.');
  if (value.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'The photo encoding is invalid. Select the photo again.');
  }
  const bytes = Buffer.from(value.base64, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The photo exceeds 4 MiB. Resize or compress it and try again.');
  if (!bytes.length || bytes.toString('base64') !== value.base64) throw new ApiError(400, 'INVALID_REQUEST', 'The photo encoding is invalid. Select the photo again.');
  return value as unknown as ChatImage;
}

function validateContainer(bytes: Buffer, mime: ChatImage['mimeType']) {
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw unreadable();
    return;
  }
  if (mime === 'image/png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw unreadable();
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const kind = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      if (offset + length + 12 > bytes.length || kind === 'acTL') throw unreadable();
      offset += length + 12;
      if (kind === 'IEND') { if (length !== 0 || offset !== bytes.length) throw unreadable(); return; }
    }
    throw unreadable();
  }
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw unreadable();
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (kind === 'ANIM' || kind === 'ANMF') throw unreadable();
    offset += 8 + length + (length % 2);
  }
  if (offset !== bytes.length) throw unreadable();
}

export async function validateImage(image: ChatImage): Promise<void> {
  const bytes = Buffer.from(image.base64, 'base64');
  validateContainer(bytes, image.mimeType);
  let directory: string | undefined;
  let file: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'palai-image-'));
    file = join(directory, `photo.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.slice(6)}`);
    await writeFile(file, bytes, { mode: 0o600 });
    const common = ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-f', 'image2'];
    const probe = await execute('ffprobe', [...common, '-show_entries', 'stream=codec_name,codec_type,width,height', '-of', 'json', file],
      { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
    const metadata: unknown = JSON.parse(probe.stdout);
    if (!isRecord(metadata) || !Array.isArray(metadata.streams) || metadata.streams.length !== 1) throw unreadable();
    const stream = metadata.streams[0];
    const codec = { 'image/jpeg': 'mjpeg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimeType];
    if (!isRecord(stream) || stream.codec_type !== 'video' || stream.codec_name !== codec
      || !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height) || Number(stream.width) < 1 || Number(stream.height) < 1) throw unreadable();
    const width = Number(stream.width), height = Number(stream.height);
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
      throw new ApiError(413, 'IMAGE_TOO_LARGE', 'Resize the photo to at most 8192 pixels per side and 16,777,216 pixels total.');
    }
    await execute('ffmpeg', ['-nostdin', ...common, '-err_detect', 'crccheck+bitstream+buffer+explode', '-xerror', '-i', file,
      '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isRecord(error) && error.code === 'ENOENT') throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'Image validation tools are unavailable. Please try again later.', true);
    throw unreadable();
  } finally {
    if (file) await rm(file, { force: true });
    if (directory) await rmdir(directory);
  }
}
