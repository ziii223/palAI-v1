import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const port = process.env.PORT || loadEnv(mode, process.cwd(), 'PORT').PORT || '3001';

  return {
    plugins: [react()],
    // Provider secrets are never public Vite variables.
    envPrefix: 'VITE_',
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
    build: { outDir: 'dist/client' },
  };
});
