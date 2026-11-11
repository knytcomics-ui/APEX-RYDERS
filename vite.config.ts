import { defineConfig } from 'vite';

export default defineConfig({
  // 5180 on purpose: another local project already answers on localhost:5173 on this machine.
  server: { host: true, port: 5180, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 },
});
