# Design Extractor (Figma plugin)

Exports the selected frame(s) as a single structured **JSON** document — the
node tree, the file's full **variable catalog**, and a standards-friendly
**design-tokens** view — with complete bound-variable information. No design
system assumptions; useful for any codegen, token pipeline, or LLM workflow.

## Output

```jsonc
{
  "schemaVersion": "1.0",
  "source": { "file": "...", "selection": ["1:5"] },

  // 1) The selected tree. Layout / style / colour / effects / text, and every
  //    variable-bound property carries an inline { id, name } reference.
  "nodes": [ /* ...recursive node objects... */ ],

  // 2) Lossless mirror of Figma's variables: collections -> modes ->
  //    valuesByMode. Aliases kept as { type:"VARIABLE_ALIAS", id, name }.
  "variables": { "collections": [ /* ... */ ] },

  // 3) Same catalog as W3C/DTCG tokens: $type/$value nested by name.
  //    Aliases -> "{group.path}" references; extra modes + figma metadata
  //    under $extensions["com.figma"].
  "tokens": { "color": { "bg": { /* ... */ } } }
}
```

See the plan/`tool/test_transform.mjs` for a worked example.

### What each node carries

- **Component identity** — instance `name`, `componentSet`, `variants`.
- **Layout** (auto-layout) — `mode` (row/column), `gap`, `padding`, axis
  alignment, `sizing` (HUG/FILL/FIXED); each spacing value carries its bound
  variable when set.
- **Constraints** — pin/resize behaviour, min/max width-height.
- **Style** — `fills`/`strokes` (solid → hex, gradients summarised), `strokeWeight`,
  `cornerRadius` (uniform or per-corner), `effects` (shadows/blur), `opacity`.
- **Colour** — every solid fill/stroke/text colour as hex **and** its
  `boundVariable` (id + name) when bound.
- **Text** — `characters` plus per-run `segments` (font, size, colour, bound
  colour variable) via `getStyledTextSegments`, and the applied text style name.

### Variables vs tokens

Same data, two shapes. `variables` is the **lossless** Figma structure (keeps
aliases and all modes verbatim). `tokens` is the **interoperable** DTCG view
(imports into Style Dictionary / Tokens Studio); an aliasing token's `$value`
is a `{reference}`, with the flattened literal under
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
