import { defineConfig } from 'vite';

// GitHub Pages serves the site from /flickline/. Production builds and `vite preview` use that
// base; the dev server and tests use '/'.
// Override with BASE_PATH (e.g. BASE_PATH=/ npm run build for a root-hosted build).
export default defineConfig(({ command, isPreview }) => ({
  base: process.env.BASE_PATH ?? (command === 'build' || isPreview ? '/flickline/' : '/'),
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
}));
