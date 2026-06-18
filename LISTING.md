# Community listing copy

Paste these into the Figma **Publish** modal. Assets are in `assets/`.

## Name
Design to Code JSON

## Tagline (≤ ~60 chars)
Component-aware JSON + real tokens for AI codegen

## Description
Design to Code JSON turns a Figma selection into one clean, **component-aware**
JSON document you can hand to any AI coding tool — Claude Code, Cursor, Copilot,
ChatGPT, Gemini — so it generates UI that actually matches your design.

Why it beats a screenshot or a generic "design to code" exporter: those can't see
your **components**, and they can't read your **design tokens** — so the AI
guesses at colour, spacing, and type, and the code comes out almost-but-not-quite
right. This plugin reads the real thing:

• **components** — every Figma component is emitted **once** as a reusable
  definition, with text bound to component properties lifted to `{{props}}`.
  Each instance — even single-use ones — becomes a compact `{ use, props }`
  reference. Repeated frames that aren't components (e.g. list items) are
  auto-deduped into the same library. The structure lines up with how you'd build
  Jetpack Compose / Flutter widgets — atomic, reusable components instead of one
  giant flattened tree, so the AI builds good components instead of inventing them.

• **nodes** — a compact layer tree: auto-layout (direction, gap, padding,
  sizing), corner radius, effects, opacity, and text. Components appear as
  `{ use, props }`; icons stay compact atoms.

• **colors / textStyles / dimensions** — flat catalogs of the real variables and
  text styles the selection uses, name → value per mode (Light/Dark). A node's
  `fill` / `color` / `textStyle` is just a reference into them; raw values appear
  only when a property isn't bound to a variable/style. The AI gets your actual
  token names, not eyeballed hex.

A lightweight alternative when Figma's Dev Mode MCP server isn't an option: it
runs in **Design mode** and in **Dev Mode** (Inspect → Code section) — so it works
even on files you can only view — reads variables on any plan in Design mode, and
is entirely offline (nothing leaves your file). Dev Mode availability follows your
Figma Dev Mode access.

How to use: in Design mode, select one or more frames, open the plugin, and copy
the JSON. In Dev Mode, select a frame and pick "Design to Code JSON" as the code
generator. Output updates as you change your selection.

——
Code version 0.10.1 · changelog:
github.com/arifinbardansyah/design-to-code-json/blob/main/CHANGELOG.md
(Figma's own version counter differs; the Dev Mode code section also prints the
running build as "Design to Code JSON (v0.10.1)".)

## Release notes (this version — code v0.10.1)
Listing refresh: clearer about what this is for — handing an AI coding tool the
**components and real design tokens** a screenshot can't capture, so codegen comes
out right. Same plugin, same JSON output as before; no behaviour change.

## Tags (max 5)
ai, codegen, components, design to code, dev mode

## Category
Development

## Support contact
arifinbardansyah@gmail.com

## Assets
- Icon:  assets/icon.png  (256×256; Figma resizes to 128)
- Cover: assets/cover.png (1920×960)
