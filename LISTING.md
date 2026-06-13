# Community listing copy

Paste these into the Figma **Publish** modal. Assets are in `assets/`.

## Name
Design Extractor

## Tagline (≤ ~60 chars)
Export any selection to JSON — nodes, variables & tokens

## Description
Design Extractor turns a Figma selection into one clean JSON document you can
feed to codegen, a token pipeline, or an LLM.

It captures:

• **nodes** — a compact layer tree: auto-layout (direction, gap, padding,
  sizing), corner radius, effects, opacity, text, and component name + variants.
  Component instances collapse to atoms with captured icon/text overrides.

• **colors / textStyles / dimensions** — flat catalogs of the variables and text
  styles the selection uses, name → value per mode (Light/Dark). A node's
  `fill` / `color` / `textStyle` is just a reference into them; raw values appear
  only when a property isn't bound to a variable/style.

• **components** (optional) — turn on "Dedupe components" to extract repeated
  subtrees into reusable definitions, with the differing fields lifted to props.

The result maps almost 1:1 onto Jetpack Compose / Flutter. Runs entirely
offline — nothing leaves your file. Works on any plan.

How to use: select one or more frames, open the plugin, and copy the JSON.
Output updates as you change your selection.

## Tags
design tokens, variables, json, export, developer, design systems, code,
handoff, dtcg, tokens studio

## Category
Development

## Support contact
arifinbardansyah@gmail.com

## Assets
- Icon:  assets/icon.png  (256×256; Figma resizes to 128)
- Cover: assets/cover.png (1920×960)
