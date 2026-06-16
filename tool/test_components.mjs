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

// --- finalizeVariants -------------------------------------------------------

// (a) one structure -> flat def, use-refs keep no `variant`.
{
  const roots = [
    { use: 'Button', __sig: 's1', variants: { Hierarchy: 'Primary' }, props: { label_text: 'Save' } },
    { use: 'Button', __sig: 's1', variants: { Hierarchy: 'Secondary' } },
  ];
  const components = {};
  const structures = new Map([
    ['Button', [{ sig: 's1', repCombo: 'Hierarchy=Primary', node: { name: 'Button', type: 'COMPONENT', children: [] }, props: ['label_text'] }]],
  ]);
  C.finalizeVariants(roots, components, structures);
  eq('one structure -> flat def', components.Button, { node: { name: 'Button', type: 'COMPONENT', children: [] }, props: ['label_text'] });
  truthy('single structure -> no variant pointer', roots[0].variant === undefined && roots[0].__sig === undefined);
}

// (b) two structures -> nested variants map + `variant` pointers.
{
  const roots = [
    { use: 'Coin', __sig: 'a', variants: { expanded: 'no' } },
    { use: 'Coin', __sig: 'b', variants: { expanded: 'yes' } },
  ];
  const components = {};
  const structures = new Map([
    ['Coin', [
      { sig: 'a', repCombo: 'expanded=no', node: { name: 'Coin', type: 'COMPONENT', children: ['A'] } },
      { sig: 'b', repCombo: 'expanded=yes', node: { name: 'Coin', type: 'COMPONENT', children: ['A', 'B'] } },
    ]],
  ]);
  C.finalizeVariants(roots, components, structures);
  truthy('two structures -> nested variants map', components.Coin.variants && components.Coin.node === undefined);
  truthy('variant keys are repCombos', !!components.Coin.variants['expanded=no'] && !!components.Coin.variants['expanded=yes']);
  eq('use-ref gets variant pointer (no)', roots[0].variant, 'expanded=no');
  eq('use-ref gets variant pointer (yes)', roots[1].variant, 'expanded=yes');
  truthy('__sig stripped', roots[0].__sig === undefined && roots[1].__sig === undefined);
}

// (c) two distinct structures sharing a repCombo -> disambiguated, neither lost.
{
  const roots = [
    { use: 'Card', __sig: 'x', variants: {} },
    { use: 'Card', __sig: 'y', variants: {} },
  ];
  const components = {};
  const structures = new Map([
    ['Card', [
      { sig: 'x', repCombo: 'Card', node: { name: 'Card', type: 'COMPONENT', children: ['h'] } },
      { sig: 'y', repCombo: 'Card', node: { name: 'Card', type: 'COMPONENT', children: ['h', 'f'] } },
    ]],
  ]);
  C.finalizeVariants(roots, components, structures);
  eq('collision -> two distinct variant keys', Object.keys(components.Card.variants), ['Card', 'Card #2']);
  eq('first use-ref -> Card', roots[0].variant, 'Card');
  eq('second use-ref -> Card #2', roots[1].variant, 'Card #2');
}

// --- valueDelta (variant value table) ---------------------------------------
{
  const base = {
    name: 'Btn', type: 'COMPONENT', size: { width: 48, height: 48 },
    children: [{ name: 'Content', type: 'FRAME', cornerRadius: 100,
      children: [{ name: 'Icon', type: 'INSTANCE', component: 'x', size: { width: 24, height: 24 } }] }],
  };
  const variant = {
    name: 'Btn', type: 'COMPONENT', size: { width: 64, height: 64 },
    children: [{ name: 'Content', type: 'FRAME', cornerRadius: 100,
      children: [{ name: 'Icon', type: 'INSTANCE', component: 'x', size: { width: 32, height: 32 } }] }],
  };
  const d = C.valueDelta(base, variant);
  eq('valueDelta: root field keyed by name', d['size'], { width: 64, height: 64 });
  eq('valueDelta: nested field keyed by path', d['Content > Icon: size'], { width: 32, height: 32 });
  truthy('valueDelta: unchanged field omitted', d['Content: cornerRadius'] === undefined);
  eq('valueDelta: identical -> empty', C.valueDelta(base, JSON.parse(JSON.stringify(base))), {});
}

// --- sameShape (variant value-vs-structural gate) ---------------------------
{
  const base = {
    name: 'Btn', type: 'COMPONENT', cornerRadius: 100, size: { width: 48, height: 48 },
    children: [{ name: 'Content', type: 'FRAME', fill: '#fff',
      children: [{ name: 'Icon', type: 'INSTANCE', size: { width: 24, height: 24 } }] }],
  };
  // Same type + arity, only values differ -> value change.
  const valueOnly = {
    name: 'Btn', type: 'COMPONENT', cornerRadius: 12, size: { width: 64, height: 64 },
    children: [{ name: 'Content', type: 'FRAME', fill: '#000',
      children: [{ name: 'Icon', type: 'INSTANCE', size: { width: 40, height: 40 } }] }],
  };
  truthy('sameShape: value-only variant -> true', C.sameShape(base, valueOnly));
  // Extra child (the Ripple case) -> structural.
  const structural = JSON.parse(JSON.stringify(base));
  structural.children[0].children.unshift({ name: 'Ripple', type: 'VECTOR' });
  truthy('sameShape: added child -> false', C.sameShape(base, structural) === false);
  // Same arity but a child's type differs -> structural.
  const retyped = JSON.parse(JSON.stringify(base));
  retyped.children[0].children[0].type = 'FRAME';
  truthy('sameShape: differing child type -> false', C.sameShape(base, retyped) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
