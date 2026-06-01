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
        output: {
          // Split large third-party libraries into their own long-lived chunks
          // so the homepage entry stays small and heavy dependencies are only
          // fetched (and cached) by the routes that actually use them.
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('react-dom') || /[\\/]react[\\/]/.test(id) || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('framer-motion') || id.includes('/motion/') || id.includes('popmotion')) return 'vendor-motion';
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-charts';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('dompurify')) return 'vendor-dompurify';
          },
        },
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
