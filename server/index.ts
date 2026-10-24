import { resolve } from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createApp(resolve('dist/client'), {
  onMetrics: metrics => console.log(JSON.stringify({ event: 'grounded_text_request', ...metrics })),
}).listen(port, () => {
  console.log(`PalAI Check listening on port ${port}`);
});

server.on('error', () => {
  console.error('PalAI Check could not start. Check PORT and port availability.');
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close());
}
