import { ApiError, isRecord } from './errors.js';
import { traceMetadata } from './request-trace.js';
import type { ChatImage } from '../shared/types.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Internal attachment; serialized only as an actual user image_url content part. */
  image?: ChatImage;
}

export interface ModelUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerLatencyMs: number;
}

export interface ModelResult {
  output: unknown;
  usage: ModelUsage;
}

export type TextProvider = (messages: ModelMessage[]) => Promise<ModelResult>;

export function createDeepSeek(options: {
  apiKey?: string; model?: string; timeoutMs?: number; fetcher?: typeof fetch;
} = {}): TextProvider {
  const key = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
  const fetcher = options.fetcher ?? fetch;
  return async messages => {
    if (!key?.trim()) throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'The answer service is not configured. Please try again later.', true);
    if (messages.some(message => message.image && message.role !== 'user')) throw new ApiError(400, 'INVALID_REQUEST', 'Photos must be attached to a user question.');
    if (messages.some(message => message.image) && model !== 'deepseek-flash') {
      throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'The configured model is not verified for images. Photo requests are unavailable.');
    }
    const started = performance.now();
    try {
      traceMetadata({ upstreamAttempted: true });
      const response = await fetcher('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: messages.map(({ image, ...message }) => image ? { ...message,
          content: [{ type: 'text', text: message.content }, { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }],
        } : message), response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, max_tokens: 900, stream: false }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      traceMetadata({ upstreamHttpStatus: response.status });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const retry = response.headers.get('retry-after') || '';
          throw new ApiError(429, 'RATE_LIMITED', 'The answer service is busy. Please try again later.', true,
            /^\d{1,5}$/.test(retry) ? retry : undefined);
        }
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The answer service could not complete that request. Please try again.', true);
      }
      const invalid = () => new ApiError(422, 'INVALID_MODEL_RESPONSE', 'The answer could not be verified. Please try again.', true);
      let payload: unknown;
      try { payload = await response.json(); } catch (error) {
        if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw error;
        throw invalid();
      }
      if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])
        || payload.choices[0].finish_reason !== 'stop' || !isRecord(payload.choices[0].message)
        || typeof payload.choices[0].message.content !== 'string' || !isRecord(payload.usage)) throw invalid();
      const usage = payload.usage;
      for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
        if (!Number.isSafeInteger(usage[field]) || Number(usage[field]) < 0) throw invalid();
      }
      const safeMetadata = (value: unknown) => typeof value === 'string' && value.length <= 128
        && /^[A-Za-z0-9._:-]+$/.test(value) ? value.replaceAll(key, '[REDACTED]') : null;
      traceMetadata({ providerResponseId: safeMetadata(payload.id), model: safeMetadata(payload.model),
        usage: { promptTokens: Number(usage.prompt_tokens), completionTokens: Number(usage.completion_tokens), totalTokens: Number(usage.total_tokens) } });
      let output: unknown;
      try { output = JSON.parse(payload.choices[0].message.content); } catch { throw invalid(); }
      return { output, usage: {
        model: typeof payload.model === 'string' ? payload.model.replaceAll(key, '[REDACTED]').slice(0, 128) : model,
        promptTokens: Number(usage.prompt_tokens), completionTokens: Number(usage.completion_tokens),
        totalTokens: Number(usage.total_tokens), providerLatencyMs: Math.round(performance.now() - started),
      } };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new ApiError(504, 'REQUEST_TIMEOUT', 'The answer service timed out. Please try again.', true);
      }
      throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The answer service could not complete that request. Please try again.', true);
    }
  };
}
