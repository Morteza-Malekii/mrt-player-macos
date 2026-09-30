import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist/app', { recursive: true });
await build({ entryPoints: ['src/main.tsx'], bundle: true, outfile: 'dist/app/app.js', format: 'iife', target: 'chrome120', minify: true, legalComments: 'eof' });
await writeFile('dist/app/index.html', '<!doctype html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MRT-Player</title><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script src="./app.js"></script></body></html>');
await build({ entryPoints: ['src/platform/mac/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outfile: 'dist/main.cjs' });
await build({ entryPoints: ['src/platform/mac/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], outfile: 'dist/preload.cjs' });
