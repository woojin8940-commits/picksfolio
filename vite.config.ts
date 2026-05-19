import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    base: '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
    ],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        external: ['amazon-ivs-web-broadcast'],
      },
    },
    esbuild: {
      // Strip noisy console.* / debugger from the production bundle.
      // Keep warn/error so genuine problems still surface.
      drop: mode === 'production' ? ['debugger'] : [],
      pure: mode === 'production'
        ? ['console.log', 'console.info', 'console.debug', 'console.trace']
        : [],
    },
    define: {
      // IVS playback URL is a public CDN URL and is referenced from client code.
      // Gemini API key is intentionally NOT injected — AI calls must go through
      // a server-side function so the key never reaches the browser.
      'process.env.VITE_IVS_PLAYBACK_URL': JSON.stringify(
        env.VITE_IVS_PLAYBACK_URL || process.env.VITE_IVS_PLAYBACK_URL || ''
      ),
    },
  };
});
