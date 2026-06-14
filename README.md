# Design Extractor (Figma plugin)

Exports the selected frame(s) as a single structured **JSON** document — a
compact node tree plus flat reference catalogs for the **colours** and **text
styles** it uses, with bound-variable names preserved. No design-system
assumptions; built for codegen (Jetpack Compose, Flutter, …) and LLM workflows.

## Output

```jsonc
{
  // 0) Only with "Dedupe components" on: repeated subtrees extracted into
  //    reusable definitions; fields that differ across uses become props.
  //    { "ListItem": { "props": ["title_text"], "node": { ..."{{title_text}}"... } } }
  "components": { /* ... */ },

  // 1) The selected tree. Colours and text styles are emitted as *references*
  //    (names) that resolve into the catalogs below; raw values appear only
  //    when a property isn't bound to a variable/style. e.g.
  //    { "type":"TEXT", "characters":"Section title",
  //      "textStyle":"M3/headline/small", "color":"#1D1B20" }
  //    { "type":"FRAME", "fill":"Schemes/Surface", ... }
  "nodes": [ /* ...recursive node objects... */ ],

  // 2) Colour catalog the `fill`/`color` references resolve into: the
  //    referenced variables only, name -> { mode: value } (aliases resolved).
  "colors": { "Schemes/Surface": { "Light": "#FEF7FF", "Dark": "#141218" } },

  // 3) Typography catalog the `textStyle` references resolve into.
  "textStyles": { "M3/headline/small": { "family":"Roboto", "size":24, "lineHeight":32 } },

  // 4) Same shape as `colors`, for FLOAT (spacing/radius) variables, when any
  //    dimension is bound to a variable.
  "dimensions": { "spacing/md": { "Light": 16 } }
}
```

The output is **compacted for codegen**: default/zero values are omitted,
spacing collapses to a bare number (or `{value, variable}` when bound), and
**colours / text styles are references** resolved once in flat catalogs
(`colors`, `textStyles`, `dimensions`) — limited to what the selection uses,
in the modes you pick.

### What each node carries

- **Component identity** — `component` name + `variants`. Instances are emitted
  as **atoms**: their internals aren't expanded; instead the captured `icon`
  (or `components`) and `text` overrides are surfaced. Turn on **Expand
  instances** to walk inside them.
- **Layout** (auto-layout) — `mode` (row/column), `gap`, `padding`, axis
  alignment (only when non-default), `sizing` (HUG/FILL/FIXED); each spacing
  value carries its bound `variable` when set.
- **Style** — `fill`/`stroke` as a colour reference (variable name) or hex when
  unbound; multiple/gradient/image fills use a `fills`/`strokes` array.
  Plus `strokeWeight`, `cornerRadius`, `effects`, `opacity`.
- **Text** — `characters`, a `textStyle` reference (font defined once in
  `textStyles`), and `color` (a variable reference or hex). Ad-hoc text with no
  bound style inlines a `font` object instead. Genuinely mixed text keeps a
  per-run `segments` array.
- **Constraints** — only when non-default (e.g. `SCALE` icons).

### Options (in the plugin panel)

- **Dedupe components** (default on) — extract repeated subtrees into a
  `components` library and rewrite each usage to `{ use, props }` (see below).
- **Expand instances** (default off) — emit a component instance's full
  internals instead of collapsing it to a `component` reference + captured
  icon/text. Turn on only when the component isn't in your codebase.
- **Drop ids** (default on) — omit node ids; keep names.
- **Modes** (default Light + Dark) — emit `Light + Dark`, `Default only`, or
  `All` variable modes in `colors` / `dimensions`.

### Deduplicate components

A pure post-process over the serialized tree. Two container subtrees are "the
same component" when their **structure** matches (type, layout, text-style role,
child shape, and which value-fields are present) regardless of concrete values.
For each group of ≥2 occurrences:

- a field that **differs** across occurrences becomes a **prop** (slot), named
  from the tree path (`title_text`, `secondary_text_text`; deepened to
  `parent_child_field` on collisions);
- a field that's **identical** everywhere is baked into the template;
- each usage is rewritten to `{ "use": "ListItem", "props": { ... } }`.

If occurrences are identical, the component simply has no props. Components are
extracted outermost-first (internals stay inside the template).

### Reference catalogs

`colors` and `dimensions` are flat maps of the variables the selection
references: `name -> { mode: value }`, with aliases (semantic → primitive)
resolved to their final literal. `textStyles` is the same idea for typography.
A node's `fill` / `color` / `textStyle` is a key into these maps (or a raw hex
when the property isn't bound to a variable). Switch **Modes** to `Light + Dark`
to emit both theme values for each colour.

## Build & verify

```bash
npm install
npm run check    # unit tests + bundle
# individually:
npm run test     # transform (colour, alias resolution + cycle guard, flat
                 # catalog) + component synthesis assertions
npm run build    # bundle src/code.ts -> dist/code.js
```

`src/transform.ts` (colour, alias resolution, both catalog shapes) is pure and
fully unit-tested. `src/code.ts` (the Figma document walk) is verified by
loading the plugin in Figma.

## Install in Figma

1. `npm run check` (produces `dist/code.js`).
2. Figma desktop → **Plugins → Development → Import plugin from manifest…** →
   pick `manifest.json`.
3. Select a frame → **Plugins → Development → Design Extractor**.
4. Output updates as you change selection. **Copy JSON**.

Runs entirely offline under your own Figma session. Reading variables is **not
plan-gated** — works on the free plan (you just need the file open in the
editor, i.e. edit access).

## Layout

```
manifest.json            plugin manifest (dynamic-page, offline)
src/code.ts              plugin main: walk selection + collect variables -> JSON
src/transform.ts         PURE + unit-tested: colour, alias resolution, catalogs
src/ui.html              panel (output textarea + copy)
tool/build.mjs           esbuild bundler
tool/test_transform.mjs  resolver/transform unit tests
```

## Not included (yet)

- Image / vector **asset export** (PNG / SVG).
- Writing **into** Figma (code → design).
