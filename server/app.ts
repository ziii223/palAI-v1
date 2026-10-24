import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { ApiErrorResponse, HealthResponse } from '../shared/types.js';
import { createChatHandler, parseChatRequest, parseConsentRequest, type ChatMetrics } from './chat.js';
import { createDeepSeek, type TextProvider } from './deepseek.js';
import { ApiError, isRecord } from './errors.js';
import { loadSource, type SourceDocument } from './source.js';
import { requestTrace, type RequestTrace } from './request-trace.js';
import { createTranscribeHandler, MAX_AUDIO_BYTES } from './transcribe.js';

export interface AppOptions {
  sourceDirectory?: string;
  source?: SourceDocument;
  provider?: TextProvider;
  onMetrics?: (metrics: ChatMetrics) => void;
  now?: () => number;
  testerDirectory?: string;
  onTrace?: (trace: RequestTrace) => void;
  transcription?: Parameters<typeof createTranscribeHandler>[0];
}

export function createApp(clientDirectory?: string, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  let sourcePromise: Promise<SourceDocument> | undefined;
  const getSource = () => sourcePromise ??= options.source ? Promise.resolve(options.source) : loadSource(options.sourceDirectory);
  const chat = createChatHandler({ getSource, provider: options.provider ?? createDeepSeek(),
    ...(options.onMetrics ? { onMetrics: options.onMetrics } : {}), ...(options.now ? { now: options.now } : {}) });
  const transcribe = createTranscribeHandler(options.transcription);

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' } satisfies HealthResponse);
  });

  app.get('/api/document', async (_request, response) => {
    response.json((await getSource()).metadata);
  });

  app.get('/api/document/pdf', async (_request, response) => {
    const source = await getSource();
    response.type('application/pdf').set({
      'Content-Disposition': 'inline; filename="palaycheck.pdf"',
      'Cache-Control': 'public, max-age=3600', ETag: `"${source.metadata.sha256}"`,
    }).send(source.pdf);
  });

  if (options.testerDirectory && options.onTrace) app.post(['/api/chat', '/api/consent'], (_request, response, next) => {
    const started = performance.now();
    const trace: RequestTrace = { requestId: randomUUID(), timestamp: new Date().toISOString(),
      responseOrigin: 'local', upstreamAttempted: false, upstreamHttpStatus: null,
      providerResponseId: null, model: null, usage: null, modelDecision: null, apiStatus: 0, elapsedMs: 0 };
    response.set('X-Local-Request-Id', trace.requestId);
    response.once('finish', () => {
      trace.apiStatus = response.statusCode;
      trace.elapsedMs = Math.round(performance.now() - started);
      try { options.onTrace?.(trace); } catch { /* tracing must not change request behavior */ }
    });
    requestTrace.run(trace, next);
  });
  app.post('/api/chat', express.json({ limit: '8mb' }), async (request, response) => {
    response.json(await chat(parseChatRequest(request.body)));
  });

  app.post('/api/consent', express.json({ limit: '8mb' }), async (request, response) => {
    response.json(await chat.consent(parseConsentRequest(request.body)));
  });

  app.post('/api/transcribe', (request, response, next) => {
    request.setTimeout(15_000);
    const timedOut = () => request.destroy();
    request.once('timeout', timedOut);
    const clear = () => { request.removeListener('timeout', timedOut); request.setTimeout(0); };
    response.once('finish', clear);
    response.once('close', clear);
    next();
  }, express.raw({ type: 'multipart/form-data', limit: MAX_AUDIO_BYTES + 64 * 1024 }), async (request, response) => {
    request.setTimeout(0);
    response.json(await transcribe(request));
  });

  // API misses must never fall through to frontend assets.
  app.use('/api', (_request, response) => {
    response.status(404).json({
      error: { code: 'INVALID_REQUEST', message: 'API route not found.', retryable: false },
    } satisfies ApiErrorResponse);
  });

  if (options.testerDirectory) {
    app.use('/dev/backend-tester', express.static(options.testerDirectory, { dotfiles: 'deny' }));
  }
  if (clientDirectory) app.use(express.static(clientDirectory, { dotfiles: 'deny' }));

  app.use((_request, response) => {
    response.sendStatus(404);
  });

  const handleError: ErrorRequestHandler = (error: unknown, request, response, _next) => {
    const controlled = error instanceof ApiError ? error
      : isRecord(error) && error.type === 'entity.too.large'
        ? request.path === '/api/transcribe' ? new ApiError(413, 'AUDIO_TOO_LARGE', 'Audio must be at most 10 MiB.')
          : new ApiError(413, 'IMAGE_TOO_LARGE', 'The request is too large. Resize the photo below 4 MiB or shorten the question.')
        : error instanceof SyntaxError ? new ApiError(400, 'INVALID_REQUEST', 'Send valid JSON.')
          : new ApiError(500, 'UPSTREAM_UNAVAILABLE', 'We could not complete that request. Please try again.', true);
    if (controlled.retryAfter) response.set('Retry-After', controlled.retryAfter);
    response.status(controlled.status).json({ error: {
      code: controlled.code, message: controlled.message, retryable: controlled.retryable,
    } } satisfies ApiErrorResponse);
  };
  app.use(handleError);
  return app;
}
