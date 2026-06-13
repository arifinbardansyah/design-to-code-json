# Design Extractor (Figma plugin)

Exports the selected frame(s) as a single structured **JSON** document — the
node tree, the file's full **variable catalog**, and a standards-friendly
**design-tokens** view — with complete bound-variable information. No design
system assumptions; useful for any codegen, token pipeline, or LLM workflow.

## Output

```jsonc
{
  "schemaVersion": "1.0",

  // 1) The selected tree. Colours and text styles are emitted as *references*
  //    (names) that resolve into the catalogs below; raw values appear only
  //    when a property isn't bound to a variable/style. e.g.
  //    { "type":"TEXT", "characters":"Section title",
  //      "textStyle":"M3/headline/small", "color":"#1D1B20" }
  //    { "type":"FRAME", "fill":"Schemes/Surface", ... }
  "nodes": [ /* ...recursive node objects... */ ],

  // 2) Typography catalog: text-style name -> font definition.
  "textStyles": { "M3/headline/small": { "family":"Roboto", "size":24, "lineHeight":32 } },

  // 3) Variables, keyed by mode name. Aliases kept as
  //    { type:"VARIABLE_ALIAS", name }. Modes limited per the Modes option.
  "variables": { "collections": [ /* ... */ ] },

  // 4) Same catalog as W3C/DTCG tokens: $type/$value nested by name.
  //    Aliases -> "{group.path}" references; extra modes + resolved literal
  //    under $extensions["com.figma"].
  "tokens": { "Schemes": { "Surface": { /* ... */ } } }
}
```

The output is **compacted for codegen**: default/zero values are omitted,
spacing collapses to a bare number (or `{value, variable}` when bound), and
**colours / text styles are references**, defined once in the catalogs.

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

- **Expand instances** (default off) — atoms vs full internals.
- **Drop ids** (default on) — omit node ids and variable-id hashes; keep names.
- **Modes** (default Light + Dark) — limit the variable/token dump to
  `Light + Dark`, `Default only`, or `All` modes.

### Variables vs tokens

Same data, two shapes. `variables` mirrors Figma's structure keyed by mode
**name**, aliases kept as `{type:"VARIABLE_ALIAS", name}`. `tokens` is the
**interoperable** DTCG view (imports into Style Dictionary / Tokens Studio); an
aliasing token's `$value` is a `{reference}`, with the flattened literal under
`$extensions["com.figma"].resolved`.

## Build & verify

```bash
npm install
npm run check    # unit tests + bundle
# individually:
npm run test     # 18 assertions: colour, alias resolution + cycle guard,
                 # Figma-shaped lossless, DTCG token tree
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
