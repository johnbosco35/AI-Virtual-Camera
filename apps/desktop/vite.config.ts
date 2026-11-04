import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'electron/ipc'),
    },
  },
  plugins: [
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      // Preload is bundled to a single CJS file so it works with sandbox: true.
      preload: { input: 'electron/preload.ts' },
    }),
  ],
});
