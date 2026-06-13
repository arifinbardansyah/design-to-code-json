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

// --- colour -----------------------------------------------------------------
eq('opaque green -> #11AC4A', T.rgbaToHex({ r: 0.0667, g: 0.6745, b: 0.2902, a: 1 }), '#11AC4A');
eq('translucent -> #RRGGBBAA', T.rgbaToHex({ r: 0, g: 0, b: 0, a: 0.15 }), '#00000026');
eq('white', T.rgbaToHex({ r: 1, g: 1, b: 1, a: 1 }), '#FFFFFF');

// --- name helpers -----------------------------------------------------------
eq('nameToPath', T.nameToPath('color/bg/primary/bold'), ['color', 'bg', 'primary', 'bold']);
eq('pathToRef', T.pathToRef('color/primitive/green/500'), '{color.primitive.green.500}');

// --- synthetic catalog ------------------------------------------------------
// Primitives collection (single mode) + Semantic collection (Light/Dark).
const catalog = {
  collections: [
    { id: 'C1', name: 'Primitives', modes: [{ id: 'p0', name: 'Value' }], defaultModeId: 'p0' },
    { id: 'C2', name: 'Semantic', modes: [{ id: 's0', name: 'Light' }, { id: 's1', name: 'Dark' }, { id: 's2', name: 'Brand' }], defaultModeId: 's0' },
  ],
  variables: [
    {
      id: 'V_green500', name: 'color/primitive/green/500', type: 'COLOR', collectionId: 'C1', scopes: ['ALL_FILLS'],
      valuesByMode: { p0: { kind: 'COLOR', rgba: { r: 0.11, g: 0.796, b: 0.36, a: 1 } } },
    },
    {
      id: 'V_green600', name: 'color/primitive/green/600', type: 'COLOR', collectionId: 'C1', scopes: ['ALL_FILLS'],
      valuesByMode: { p0: { kind: 'COLOR', rgba: { r: 0.0667, g: 0.6745, b: 0.2902, a: 1 } } },
    },
    {
      id: 'V_bgPrimaryBold', name: 'color/bg/primary/bold', type: 'COLOR', collectionId: 'C2', scopes: ['ALL_FILLS'],
      valuesByMode: {
        s0: { kind: 'COLOR', rgba: { r: 0.0667, g: 0.6745, b: 0.2902, a: 1 } }, // literal #11AC4A
        s1: { kind: 'ALIAS', id: 'V_green500' }, // Dark -> aliases a primitive
        s2: { kind: 'COLOR', rgba: { r: 1, g: 0, b: 0, a: 1 } }, // Brand -> #FF0000
      },
    },
    {
      id: 'V_radiusMd', name: 'radius/md', type: 'FLOAT', collectionId: 'C2', scopes: ['CORNER_RADIUS'],
      valuesByMode: { s0: { kind: 'FLOAT', value: 12 }, s1: { kind: 'FLOAT', value: 12 }, s2: { kind: 'FLOAT', value: 12 } },
    },
  ],
};

// --- Figma-shaped (name-keyed) ----------------------------------------------
const shaped = T.buildFigmaShaped(catalog); // 'all' modes
eq('shaped has 2 collections', shaped.collections.length, 2);
const semantic = shaped.collections.find((c) => c.name === 'Semantic');
const bgVar = semantic.variables.find((v) => v.name === 'color/bg/primary/bold');
eq('shaped default literal keyed by mode name', bgVar.valuesByMode.Light, '#11AC4A');
eq('shaped alias kept with resolved name', bgVar.valuesByMode.Dark, { type: 'VARIABLE_ALIAS', id: 'V_green500', name: 'color/primitive/green/500' });
eq('shaped defaultMode is a name', semantic.defaultMode, 'Light');

// --- mode filtering ---------------------------------------------------------
const ld = T.buildFigmaShaped(catalog, 'lightDark').collections.find((c) => c.name === 'Semantic');
eq('lightDark keeps Light+Dark only', ld.modes, ['Light', 'Dark']);
eq('lightDark drops Brand value', ld.variables[0].valuesByMode.Brand, undefined);
const def = T.buildFigmaShaped(catalog, 'default').collections.find((c) => c.name === 'Semantic');
eq('default keeps one mode', def.modes, ['Light']);
const ldTokens = T.buildTokens(catalog, 'lightDark');
eq('lightDark tokens drop Brand mode', ldTokens.color.bg.primary.bold.$extensions['com.figma'].modes.Brand, undefined);
eq('lightDark tokens keep Dark mode', ldTokens.color.bg.primary.bold.$extensions['com.figma'].modes.Dark, '{color.primitive.green.500}');
eq('tokens keep id by default', typeof T.buildTokens(catalog).color.bg.primary.bold.$extensions['com.figma'].id, 'string');
eq('dropIds removes token id', T.buildTokens(catalog, 'all', true).color.bg.primary.bold.$extensions['com.figma'].id, undefined);

// --- alias resolution -------------------------------------------------------
const varById = Object.fromEntries(catalog.variables.map((v) => [v.id, v]));
const collById = Object.fromEntries(catalog.collections.map((c) => [c.id, c]));
eq('resolve alias chain -> literal', T.resolveToLiteral({ kind: 'ALIAS', id: 'V_bgPrimaryBold' }, 's1', varById, collById), '#1CCB5C');
// cycle guard: make a self-referential pair
const cyclic = { ...varById, A: { id: 'A', name: 'a', type: 'COLOR', collectionId: 'C1', scopes: [], valuesByMode: { p0: { kind: 'ALIAS', id: 'B' } } }, B: { id: 'B', name: 'b', type: 'COLOR', collectionId: 'C1', scopes: [], valuesByMode: { p0: { kind: 'ALIAS', id: 'A' } } } };
eq('cycle guard returns null', T.resolveToLiteral({ kind: 'ALIAS', id: 'A' }, 'p0', cyclic, collById), null);

// --- DTCG tokens ------------------------------------------------------------
const tokens = T.buildTokens(catalog);
const bgTok = tokens.color.bg.primary.bold;
eq('token nests by name path', typeof bgTok, 'object');
eq('token $type color', bgTok.$type, 'color');
eq('token default $value is literal', bgTok.$value, '#11AC4A');
eq('token Dark mode -> reference', bgTok.$extensions['com.figma'].modes.Dark, '{color.primitive.green.500}');
eq('token carries collection', bgTok.$extensions['com.figma'].collection, 'Semantic');
const radTok = tokens.radius.md;
eq('FLOAT under dimension hint -> dimension', radTok.$type, 'dimension');
eq('dimension $value has px', radTok.$value, '12px');
// a primitive aliased by another resolves; semantic default literal resolves to itself
eq('bg default resolved literal', bgTok.$extensions['com.figma'].resolved, '#11AC4A');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
