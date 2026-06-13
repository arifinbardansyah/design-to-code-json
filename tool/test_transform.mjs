// Unit tests for src/transform.ts. Bundles it to a temp ESM file (so the .ts
// imports resolve) and asserts against a small synthetic variable catalog.
import esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), `fde_transform_${Date.now()}.mjs`);
await esbuild.build({
  entryPoints: ['src/transform.ts'],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  target: 'es2020',
  logLevel: 'error',
});
const T = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp, { force: true });

let pass = 0;
let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${label}` + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}
function truthy(label, got) {
  const ok = !!got;
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${label}` + (ok ? '' : `  got ${JSON.stringify(got)}`));
  ok ? pass++ : fail++;
}

// --- colour -----------------------------------------------------------------
eq('opaque green -> #11AC4A', T.rgbaToHex({ r: 0.0667, g: 0.6745, b: 0.2902, a: 1 }), '#11AC4A');
eq('translucent -> #RRGGBBAA', T.rgbaToHex({ r: 0, g: 0, b: 0, a: 0.15 }), '#00000026');
eq('white', T.rgbaToHex({ r: 1, g: 1, b: 1, a: 1 }), '#FFFFFF');

// --- synthetic catalog ------------------------------------------------------
// Primitives (single mode) + Semantic (Light default / Dark / Brand).
const catalog = {
  collections: [
    { id: 'C1', name: 'Primitives', modes: [{ id: 'p0', name: 'Value' }], defaultModeId: 'p0' },
    { id: 'C2', name: 'Semantic', modes: [{ id: 's0', name: 'Light' }, { id: 's1', name: 'Dark' }, { id: 's2', name: 'Brand' }], defaultModeId: 's0' },
  ],
  variables: [
    {
      id: 'V_green500', name: 'color/primitive/green/500', type: 'COLOR', collectionId: 'C1', scopes: [],
      valuesByMode: { p0: { kind: 'COLOR', rgba: { r: 0.11, g: 0.796, b: 0.36, a: 1 } } },
    },
    {
      id: 'V_bgPrimaryBold', name: 'color/bg/primary/bold', type: 'COLOR', collectionId: 'C2', scopes: [],
      valuesByMode: {
        s0: { kind: 'COLOR', rgba: { r: 0.0667, g: 0.6745, b: 0.2902, a: 1 } }, // #11AC4A
        s1: { kind: 'ALIAS', id: 'V_green500' }, // Dark -> primitive
        s2: { kind: 'COLOR', rgba: { r: 1, g: 0, b: 0, a: 1 } }, // Brand #FF0000
      },
    },
    {
      id: 'V_radiusMd', name: 'radius/md', type: 'FLOAT', collectionId: 'C2', scopes: [],
      valuesByMode: { s0: { kind: 'FLOAT', value: 12 }, s1: { kind: 'FLOAT', value: 12 }, s2: { kind: 'FLOAT', value: 16 } },
    },
  ],
};
const varById = Object.fromEntries(catalog.variables.map((v) => [v.id, v]));
const collById = Object.fromEntries(catalog.collections.map((c) => [c.id, c]));

// --- mode selection ---------------------------------------------------------
eq('lightDark picks default + Dark', T.selectModeIds(collById.C2, 'lightDark'), ['s0', 's1']);
eq('default picks one', T.selectModeIds(collById.C2, 'default'), ['s0']);
eq('all picks every mode', T.selectModeIds(collById.C2, 'all').length, 3);

// --- alias resolution -------------------------------------------------------
eq('resolve alias chain -> literal', T.resolveToLiteral({ kind: 'ALIAS', id: 'V_bgPrimaryBold' }, 's1', varById, collById), '#1CCB5C');
const cyclic = { A: { id: 'A', name: 'a', type: 'COLOR', collectionId: 'C1', scopes: [], valuesByMode: { p0: { kind: 'ALIAS', id: 'B' } } }, B: { id: 'B', name: 'b', type: 'COLOR', collectionId: 'C1', scopes: [], valuesByMode: { p0: { kind: 'ALIAS', id: 'A' } } } };
eq('cycle guard returns null', T.resolveToLiteral({ kind: 'ALIAS', id: 'A' }, 'p0', cyclic, collById), null);

// --- flat catalog -----------------------------------------------------------
const referenced = new Set(['V_bgPrimaryBold', 'V_radiusMd']); // primitive not directly referenced
const flat = T.buildFlatCatalog(catalog, referenced, 'lightDark');
eq('colors: referenced-only, resolved per mode', flat.colors, {
  'color/bg/primary/bold': { Light: '#11AC4A', Dark: '#1CCB5C' },
});
eq('dimensions: FLOAT vars as numbers', flat.dimensions, { 'radius/md': { Light: 12, Dark: 12 } });
truthy('primitive (unreferenced) excluded', flat.colors['color/primitive/green/500'] === undefined);

const flatDefault = T.buildFlatCatalog(catalog, referenced, 'default');
eq('default mode -> single value', flatDefault.colors['color/bg/primary/bold'], { Light: '#11AC4A' });

const flatAll = T.buildFlatCatalog(catalog, referenced, 'all');
eq('all modes incl Brand', flatAll.colors['color/bg/primary/bold'], { Light: '#11AC4A', Dark: '#1CCB5C', Brand: '#FF0000' });

const empty = T.buildFlatCatalog(catalog, new Set(), 'all');
eq('no references -> empty catalog', empty, {});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
