// Bundles src/code.ts -> dist/code.js for the Figma plugin sandbox (single
// IIFE, no DOM). ui.html is referenced directly by manifest.json.
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/code.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
  logLevel: 'info',
});
