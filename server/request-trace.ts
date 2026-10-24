import { AsyncLocalStorage } from 'node:async_hooks';

// Only the separate development tester enables this metadata-only context.
export interface RequestTrace {
  requestId: string;
  timestamp: string;
  responseOrigin: 'local' | 'application cache' | 'DeepSeek';
  upstreamAttempted: boolean;
  upstreamHttpStatus: number | null;
  providerResponseId: string | null;
  model: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  modelDecision: string | null;
  apiStatus: number;
  elapsedMs: number;
}

export const requestTrace = new AsyncLocalStorage<RequestTrace>();

export function traceMetadata(metadata: Partial<RequestTrace>) {
  const trace = requestTrace.getStore();
  if (trace) Object.assign(trace, metadata);
}
