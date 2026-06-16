// Bundles src/code.ts -> dist/code.js for the Figma plugin sandbox (single
// IIFE, no DOM). ui.html is referenced directly by manifest.json.
import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

await esbuild.build({
  entryPoints: ['src/code.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: 'info',
});
