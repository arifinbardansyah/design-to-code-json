# Community listing copy

Paste these into the Figma **Publish** modal. Assets are in `assets/`.

## Name
Design Extractor

## Tagline (≤ ~60 chars)
Export any selection to JSON — nodes, variables & tokens

## Description
Design Extractor turns a Figma selection into one clean JSON document you can
feed to codegen, a token pipeline, or an LLM.

It captures three things:

• **nodes** — the layer tree with auto-layout (direction, gap, padding, sizing),
  constraints, fills/strokes/effects, corner radius, opacity, full text with
  per-run styling, and component name + variants. Every property that is bound
  to a Figma variable carries an inline reference to it.

• **variables** — a lossless mirror of the file's variable collections: modes,
  per-mode values, and aliases kept exactly as authored.

• **tokens** — the same catalog as standard W3C/DTCG design tokens
  ($type/$value, nested by name). Aliases become {references}; extra modes and
  the resolved value are kept under $extensions.

Runs entirely offline — nothing leaves your file. Works on any plan.

How to use: select one or more frames, open the plugin, and copy the JSON.
Output updates as you change your selection; “Re-read” forces a fresh pull of
the variable catalog.

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
