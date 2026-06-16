# Community listing copy

Paste these into the Figma **Publish** modal. Assets are in `assets/`.

## Name
Design to Code JSON

## Tagline (≤ ~60 chars)
Component-aware JSON for codegen — Compose, Flutter, LLMs

## Description
Design to Code JSON turns a Figma selection into one clean, **component-aware**
JSON document you can feed to codegen, a design-token pipeline, or an LLM.

It's built around your components:

• **components** — every Figma component is emitted **once** as a reusable
  definition, with text bound to component properties lifted to `{{props}}`.
  Each instance — even single-use ones — becomes a compact `{ use, props }`
  reference. Repeated frames that aren't components (e.g. list items) are
  auto-deduped into the same library. The result maps almost 1:1 onto Jetpack
  Compose / Flutter widgets — atomic, reusable components instead of one giant
  flattened tree.

• **nodes** — a compact layer tree: auto-layout (direction, gap, padding,
  sizing), corner radius, effects, opacity, and text. Components appear as
  `{ use, props }`; icons stay compact atoms.

• **colors / textStyles / dimensions** — flat catalogs of the variables and text
  styles the selection uses, name → value per mode (Light/Dark). A node's
  `fill` / `color` / `textStyle` is just a reference into them; raw values appear
  only when a property isn't bound to a variable/style.

Runs in **Design mode** and in **Dev Mode** (Inspect → Code section), so it works
even on files you can only view. Entirely offline — nothing leaves your file.
Reads variables on any plan in Design mode; Dev Mode availability follows your
Figma Dev Mode access.

How to use: in Design mode, select one or more frames, open the plugin, and copy
the JSON. In Dev Mode, select a frame and pick "Design to Code JSON" as the code
generator. Output updates as you change your selection.

——
Code version 0.8.1 · changelog:
github.com/arifinbardansyah/design-to-code-json/blob/main/CHANGELOG.md
(Figma's own version counter differs; the Dev Mode code section also prints the
running build as "Design to Code JSON (v0.8.1)".)

## Release notes (this version — code v0.8.1)
Variant value table: fixed redundant output. Variants that only change values
(corner radius, size, fill/opacity) now collapse into a compact per-axis
`variantStyles` table instead of duplicate node trees; only variants that change
the layer structure (e.g. a state that adds a child) stay as full `variants`
entries. Update the line above to match each release so this maps to Figma's
version counter.

## Tags (max 5)
codegen, components, design to code, dev mode, llm

## Category
Development

## Support contact
arifinbardansyah@gmail.com

## Assets
- Icon:  assets/icon.png  (256×256; Figma resizes to 128)
- Cover: assets/cover.png (1920×960)
