# Design to Code JSON (Figma plugin)

**▶ Install from Figma Community:** https://www.figma.com/community/plugin/1647834863384185949

Exports the selected frame(s) as a single **component-aware** JSON document — a
reusable `components` library (every Figma component as a `{ use, props }`
definition, repeated frames deduped in too) plus a compact node tree and flat
reference catalogs for the **colours** and **text styles** used, with
bound-variable names preserved. No design-system assumptions; built for codegen
(Jetpack Compose, Flutter, …) and LLM workflows. Runs in Design **and** Dev Mode.

## Output

```jsonc
{
  // 0) Reusable components: every Figma component (by identity) plus any
  //    repeated frames (deduped). Fields that differ across uses become props.
  //    { "ListItem": { "props": ["title_text"], "node": { ..."{{title_text}}"... } } }
  "components": { /* ... */ },

  // 1) The selected tree. Colours, text styles AND spacing/radius are emitted as
  //    *references* (names) that resolve into the catalogs below; raw values
  //    appear only when a property isn't bound to a variable/style. e.g.
  //    { "type":"TEXT", "characters":"Section title",
  //      "textStyle":"M3/headline/small", "color":"Schemes/OnSurface" }
  //    { "type":"FRAME", "fill":"Schemes/Surface",
  //      "layout":{ "gap":"spacing/md" }, "cornerRadius":"radius/lg" }
  "nodes": [ /* ...recursive node objects... */ ],

  // 2) Colour catalog the `fill`/`color` references resolve into (variables and
  //    colour styles, aliases resolved). A single mode collapses to a bare
  //    value; multiple modes stay keyed by mode.
  "colors": { "Schemes/Surface": { "Light": "#FEF7FF", "Dark": "#141218" },
              "brand/primary": "#6D12B5" },

  // 3) Typography catalog the `textStyle` references resolve into.
  "textStyles": { "M3/headline/small": { "family":"Roboto", "size":24, "lineHeight":32 } },

  // 4) Same idea for FLOAT (spacing/radius) variables the `gap`/`padding`/
  //    `cornerRadius` references resolve into. Single mode -> bare number.
  "dimensions": { "spacing/md": 16 }
}
```

The output is **compacted for codegen**: default/zero values are omitted,
**colours, text styles and spacing/radius are references** (variable or style
names) resolved once in flat catalogs (`colors`, `textStyles`, `dimensions`) —
limited to what the selection uses, across every mode each variable defines. A
catalog entry with a single mode collapses to a bare value (`"spacing/md": 16`),
not `{ mode: 16 }`; multi-mode variables stay keyed by mode (e.g. Light/Dark).

### What each node carries

- **Component identity** — container components become `{ use, variants, props }`
  references into the `components` library; leaf/icon instances stay compact
  **atoms** (`component` name + captured `icon`/`text`).
- **Layout** (auto-layout) — `mode` (row/column), `gap`, `padding`, axis
  alignment (only when non-default), `sizing` (HUG/FILL/FIXED). Spacing values
  are a `dimensions` **reference** (variable name) when bound, else a bare number.
- **Style** — `fill`/`stroke` as a colour reference (variable **or** colour-style
  name) or hex when unbound; multiple/gradient/image fills use a `fills`/`strokes`
  array. Plus `strokeWeight`, `cornerRadius` (also a `dimensions` reference when
  bound), `effects`, `opacity`.
- **Text** — `characters`, a `textStyle` reference (font defined once in
  `textStyles`), and `color` (a variable/colour-style reference or hex). Ad-hoc
  text with no bound style inlines a `font` object instead. Genuinely mixed text
  keeps a per-run `segments` array.
- **Constraints** — only when non-default (e.g. `SCALE` icons).

### Behaviour (fixed) + the one option

The output is opinionated; the only control is variant-splitting:

- **Component library** (always on) — uses Figma's own component model: each
  container component is emitted once into `components` (with `{{prop}}`
  placeholders where text is bound to a component text property), and **every
  instance** — even single-use ones — becomes a `{ use, variants, props }`
  reference. Leaf/icon instances stay compact atoms.
- **Dedupe components** (always on) — composes with the above: any remaining
  repeated *frames* (e.g. list items that aren't Figma components) are extracted
  into the same `components` map, with differing fields as props (see below).
- **Node ids** are always dropped (codegen never needs them); instances are
  never expanded inline (they resolve via `components`).
- **Variable modes** (fixed) — `colors` / `dimensions` emit **every** mode each
  variable defines (single mode collapses to a bare value; Light/Dark stays an
  object). No longer configurable.
- **Split variants** (default off) — for a component **set**, emit one definition
  per structurally-distinct variant that's used. Value-only variants
  (colour/size/state) still collapse to a single def; only variants that change
  the child tree (e.g. `expanded=yes` adding rows) split. A set with one
  structure stays flat (`components[name] = { node }`); a set with several nests
  (`components[name] = { variants: { "<combo>": { node } } }`) and each use-ref
  gains a `variant` pointer. Only variants actually placed are processed.
- **Variant value table** (default off; implies Split variants) — for a
  component set, read the **whole set** from the design and emit the default
  variant as the base `node` plus a per-axis `variantStyles` table of the
  styling each variant value changes (vs. base), so per-variant values come from
  the design rather than the consumer's code:

  ```jsonc
  "Icon button - standard": {
    "node": { /* default variant, base values */ },
    "variantStyles": {
      "Size":  { "Large": { "size": 64, "Content > Icon: size": 32 } },
      "State": { "Disabled": { "Content > State-layer: fill": "#E0E0E0" } }
    }
  }
  ```

  It serializes the base + one variant per axis-value (not the full combo
  product). A variant is a table row when it shares the base's tree **shape**
  (same node types and child counts, values aside); only a variant that changes
  the shape — adds or removes a child — becomes a full `variants` entry instead.
  So corner-radius / size / fill / opacity changes stay compact deltas. Heavier —
  best in the editor panel (not the 3s Dev Mode budget).

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
3. Select a frame → **Plugins → Development → Design to Code JSON**.
4. Output updates as you change selection. **Copy JSON**.

Runs entirely offline under your own Figma session. Reading variables is **not
plan-gated** — works on the free plan (you just need the file open in the
editor, i.e. edit access).

## Use in Dev Mode (no edit access needed)

The editor panel above needs **edit access**. If you only have **view access**
to a file (e.g. a shared work file), use **Dev Mode** instead:

1. Switch the file to **Dev Mode** (top toolbar toggle, or `&m=dev` in the URL).
2. Select a frame and open the **Inspect** panel.
3. In the code section, pick **Design to Code JSON** as the generator — the JSON
   appears inline. Adjust **modes / dedupe / expand instances / drop ids** via
   the generator's preferences (gear) menu.

Same output as the editor panel; it runs as a Dev Mode *codegen* plugin
(`capabilities: ["codegen"]`), which Figma allows for inspectors/viewers.

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
