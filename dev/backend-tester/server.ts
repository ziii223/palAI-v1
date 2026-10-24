import { resolve } from 'node:path';
import { createApp } from '../../server/app.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const server = createApp(undefined, {
  testerDirectory: resolve(import.meta.dirname, 'public'),
  onMetrics: metrics => console.log(JSON.stringify({ event: 'grounded_text_request', ...metrics })),
  onTrace: trace => console.log(JSON.stringify({ event: 'development_chat_trace', ...trace })),
}).listen(port, '127.0.0.1', () => {
  console.log(`Backend tester: http://127.0.0.1:${port}/dev/backend-tester/`);
});
server.on('error', () => {
  console.error('Could not start the tester. Check PORT and port availability.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
