import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

const ENGINE = `127.0.0.1:${process.env.AVS_PORT ?? 8765}`;

/** Strict CSP in builds; dev additionally allows Vite's inline React-refresh preamble and HMR socket. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'avs-csp',
    transformIndexHtml(html, ctx) {
      const dev = !!ctx.server;
      const policy = [
        "default-src 'self'",
        `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: http://${ENGINE}`,
        `media-src 'self' blob: http://${ENGINE}`,
        `connect-src 'self' blob: http://${ENGINE} ws://${ENGINE}${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; ');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'electron/ipc'),
    },
  },
  worker: { format: 'es' },
  plugins: [
    contentSecurityPolicy(),
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      // Preload is bundled to a single CJS file so it works with sandbox: true.
      preload: { input: 'electron/preload.ts' },
    }),
  ],
});
