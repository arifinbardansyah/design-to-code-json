// Unit tests for src/components.ts (synthesizeComponents). Bundles to a temp
// ESM file and asserts on synthetic node trees.
import esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), `fde_components_${Date.now()}.mjs`);
await esbuild.build({
  entryPoints: ['src/components.ts'],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  target: 'es2020',
  logLevel: 'error',
});
const C = await import(pathToFileURL(tmp).href);
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

// A "List item" container: title + description text.
const listItem = (n, title, desc) => ({
  name: `List item 0${n}`, type: 'FRAME',
  layout: { mode: 'column', gap: 4 },
  children: [
    { name: 'Title', type: 'TEXT', characters: title, textStyle: 'M3/title/large', color: '#1D1B20' },
    { name: 'Secondary Text', type: 'TEXT', characters: desc, textStyle: 'M3/body/medium', color: '#49454F' },
  ],
});

// --- identical repeats -> dedupe, no props --------------------------------
{
  const tree = [{
    name: 'column', type: 'FRAME', layout: { mode: 'column', gap: 16 },
    children: [listItem(1, 'Title', 'Desc'), listItem(2, 'Title', 'Desc'), listItem(3, 'Title', 'Desc')],
  }];
  const { nodes, components } = C.synthesizeComponents(tree);
  const names = Object.keys(components);
  eq('one component extracted', names.length, 1);
  eq('component named ListItem', names[0], 'ListItem');
  eq('identical repeats -> no props', components.ListItem.props, undefined);
  const kids = nodes[0].children;
  eq('all three usages rewritten', kids.map((k) => k.use), ['ListItem', 'ListItem', 'ListItem']);
  eq('identical usage carries no props', kids[0].props, undefined);
  truthy('template keeps baked title', JSON.stringify(components.ListItem.node).includes('"Title"'));
}

// --- differing content -> slots (props) -----------------------------------
{
  const tree = [{
    name: 'column', type: 'FRAME', layout: { mode: 'column', gap: 16 },
    children: [listItem(1, 'Apple', 'Red fruit'), listItem(2, 'Banana', 'Yellow fruit')],
  }];
  const { nodes, components } = C.synthesizeComponents(tree);
  const comp = components.ListItem;
  eq('two text slots inferred', comp.props.sort(), ['secondary_text_text', 'title_text']);
  truthy('template uses placeholder for title', JSON.stringify(comp.node).includes('{{title_text}}'));
  truthy('color baked (identical)', JSON.stringify(comp.node).includes('#1D1B20'));
  const kids = nodes[0].children;
  eq('usage 1 props', kids[0].props, { title_text: 'Apple', secondary_text_text: 'Red fruit' });
  eq('usage 2 props', kids[1].props, { title_text: 'Banana', secondary_text_text: 'Yellow fruit' });
}

// --- single occurrence -> not extracted -----------------------------------
{
  const tree = [{
    name: 'column', type: 'FRAME', layout: { mode: 'column' },
    children: [listItem(1, 'Solo', 'Only one')],
  }];
  const { nodes, components } = C.synthesizeComponents(tree);
  eq('no component for single occurrence', Object.keys(components).length, 0);
  eq('node left inline', nodes[0].children[0].name, 'List item 01');
}

// --- different structure -> not grouped -----------------------------------
{
  const a = listItem(1, 'A', 'a');
  const b = { name: 'List item 02', type: 'FRAME', layout: { mode: 'column', gap: 4 },
    children: [{ name: 'Title', type: 'TEXT', characters: 'B', textStyle: 'M3/title/large', color: '#1D1B20' }] }; // only 1 child
  const { components } = C.synthesizeComponents([{ name: 'col', type: 'FRAME', layout: {}, children: [a, b] }]);
  eq('different child shape -> no grouping', Object.keys(components).length, 0);
}

// --- name collision on slots -> ancestor-prefixed --------------------------
{
  const row = (icon) => ({
    name: 'Row', type: 'FRAME', layout: { mode: 'row' },
    children: [
      { name: 'Leading', type: 'FRAME', layout: { mode: 'row' },
        children: [{ name: 'Icon', type: 'INSTANCE', component: 'x', icon }] },
      { name: 'Trailing', type: 'FRAME', layout: { mode: 'row' },
        children: [{ name: 'Icon', type: 'INSTANCE', component: 'x', icon }] },
    ],
  });
  // two rows where the two icons differ between occurrences
  const tree = [{ name: 'list', type: 'FRAME', layout: {}, children: [
    { ...row('a') }, { ...row('b') },
  ] }];
  // make the two Icons within a row differ across occurrences distinctly
  tree[0].children[0].children[0].children[0].icon = 'a1';
  tree[0].children[0].children[1].children[0].icon = 'a2';
  tree[0].children[1].children[0].children[0].icon = 'b1';
  tree[0].children[1].children[1].children[0].icon = 'b2';
  const { components } = C.synthesizeComponents(tree);
  const props = components.Row?.props ?? [];
  eq('two unique icon slot names', new Set(props).size, 2);
  truthy('collision disambiguated by ancestor prefix', props.some((p) => /^(leading|trailing)_/.test(p)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
