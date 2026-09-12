import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, cp, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
await mkdir('dist', { recursive: true });
await build({ entryPoints: { main: 'src/desktop/main.ts', preload: 'src/desktop/preload.ts', service: 'src/service/entry.ts' },
  outdir: 'dist', bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true,
  external: ['electron', 'tesseract.js', 'dotenv', 'fastify', 'uiohook-napi'] });
await Promise.all([rename('dist/main.js', 'dist/main.cjs'), rename('dist/preload.js', 'dist/preload.cjs'), rename('dist/service.js', 'dist/service.cjs')]);
await viteBuild();
await mkdir('dist/ocr', { recursive: true });
const language = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await cp(path.join(language, '4.0.0'), 'dist/ocr', { recursive: true });
console.log('Built desktop, service, renderer and local OCR language assets.');
