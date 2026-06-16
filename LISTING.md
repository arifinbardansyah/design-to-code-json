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
Works on any plan.

How to use: in Design mode, select one or more frames, open the plugin, and copy
the JSON. In Dev Mode, select a frame and pick "Design to Code JSON" as the code
generator. Output updates as you change your selection.

## Tags (max 5)
codegen, components, flutter, compose, dev mode

## Category
Development

## Support contact
arifinbardansyah@gmail.com

## Assets
- Icon:  assets/icon.png  (256×256; Figma resizes to 128)
- Cover: assets/cover.png (1920×960)
