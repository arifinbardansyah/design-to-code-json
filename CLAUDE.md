# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Figma plugin that exports the selected frame(s) as a single compact, codegen-ready
JSON document: a recursive `nodes` tree plus flat reference catalogs (`colors`,
`textStyles`, `dimensions`) and, optionally, a `components` library of deduplicated
subtrees. Colours and text styles in `nodes` are emitted as *references* (variable/
style names) that resolve into the catalogs; raw values appear only when unbound.
No design-system assumptions. See `README.md` for the full output schema and options.

## Commands

```bash
npm install
npm run check    # tests + bundle — run this before importing into Figma
npm run test     # both unit suites (test_transform.mjs && test_components.mjs)
npm run build    # esbuild bundle: src/code.ts -> dist/code.js
npm run assets   # render assets/*.svg -> *.png (icon/cover) via resvg

# Run a single unit suite directly (there is no test-filter flag):
node tool/test_transform.mjs    # colour, alias resolution + cycle guard, flat catalog
node tool/test_components.mjs   # component dedupe / prop synthesis
```

There is no separate typecheck script; `tsconfig.json` is `noEmit` and type errors
surface through the editor / esbuild. Tests are plain Node scripts using `assert`
(no test runner).

## Architecture

Two execution contexts, as in every Figma plugin:
- **`src/code.ts`** — the plugin "main" thread. Runs in Figma's sandbox, has the
  Figma API. Walks `figma.currentPage.selection`, reads bound variables / text
  styles, and lowers everything to plain JSON. Bundled to `dist/code.js`.
- **`src/ui.html`** — the panel (iframe). Holds the options UI + output textarea,
  communicates with `code.ts` only via `postMessage`. Referenced directly by
  `manifest.json` (not bundled).

The code is deliberately split into Figma-coupled vs. pure modules so the hard
logic is unit-testable in plain Node:
- **`src/transform.ts`** — PURE, no Figma API. Colour conversion, alias-chain
  resolution (cycle-guarded), mode selection, and `buildFlatCatalog` (the
  `colors`/`dimensions` maps). Operates on the `RawCatalog` IR that `code.ts`
  produces. Fully unit-tested.
- **`src/components.ts`** — PURE, no Figma API. `synthesizeComponents`: a
  post-process over the serialized node JSON that extracts repeated subtrees into
  reusable components, turning fields that vary across occurrences into props.
  Structural `signature()` (excludes slot values, keeps which slots are present)
  is the matching key. Fully unit-tested.
- **`src/code.ts`** — everything that needs the live document: the selection
  walk, variable/style reading + caching, override capture for un-expanded
  instances. Verified by loading the plugin in Figma, not by unit tests.

Core serialization is shared by `buildDocument(sel)` in `code.ts`: walk roots ->
`nodes` + a `Ctx` of referenced variable/text-style ids -> optional
`synthesizeComponents` -> resolve referenced ids into a `RawCatalog` ->
`buildFlatCatalog` -> one JSON string. Output keys: `components?`, `nodes`,
`colors?`, `textStyles?`, `dimensions?`.

**Component handling** is option-driven in `serializeNode`'s INSTANCE branch:
atom (default), full inline (`expandInstances`), or — with `componentLibrary` —
each container component serialized once into `ctx.components` with `{{prop}}`
placeholders (from Figma component text-property refs) and instances emitted as
`{ use, props }`. That path is Figma-coupled (reads `getMainComponentAsync`,
`componentProperties`, `componentPropertyReferences`), so it's verified in Figma,
not unit tests; structural dedupe (`synthesizeComponents`, pure + tested) is the
separate `dedupe` path and is skipped when `componentLibrary` is on.

**Two entry points**, branched on `figma.mode` at the bottom of `code.ts`:
- **Editor (Figma/FigJam)** — `figma.showUI` + `run()` on the live selection,
  posting to `src/ui.html` on every `selectionchange`. Needs editor access.
- **Dev Mode codegen** (`figma.mode === 'codegen'`) — `figma.codegen.on('generate')`
  serializes the inspected `event.node` and returns the JSON to the Inspect
  panel. Runs for viewers without edit access. Enabled by `capabilities:
  ["codegen"]` in `manifest.json`; the panel options are mirrored as
  `codegenPreferences` and read back via `figma.codegen.preferences.customSettings`
  in `optionsFromCodegen()`.

## Conventions / gotchas

- **The published Community plugin is a manual, separate upload** — it does NOT
  track this repo. If Dev Mode / behaviour differs in the wild, suspect a stale
  published build and re-publish from the Figma desktop app after `npm run check`.
- **Keep `transform.ts` and `components.ts` free of the Figma API.** That purity
  is what makes them testable; anything needing `figma.*` belongs in `code.ts`.
  Add assertions to the matching `tool/test_*.mjs` when changing them.
- **Output is aggressively compacted**: `prune()` drops `undefined` keys, and
  serializers omit default/zero values (e.g. `MIN` alignment, zero spacing,
  opacity 1). When adding a field, only emit it when it carries information.
- **Runs are sequenced** (`runSeq`) so a stale async run is dropped when selection
  changes again; the local variable catalog is cached across runs and only
  refreshed on manual Re-read (`run(true)`).
- `manifest.json` declares `networkAccess: none` and `documentAccess:
  dynamic-page` — the plugin is fully offline and must use the async variable/
  style getters (`getVariableByIdAsync`, `getStyleByIdAsync`, etc.).
- `dist/` is gitignored (build artifact, not committed). `dist/code.js` is the
  plugin entry point, so rebuild with `npm run build` / `npm run check` after
  changing `src/` and before importing into Figma or publishing.

## Manual verification in Figma

`npm run check`, then in Figma desktop: Plugins -> Development -> Import plugin
from manifest -> pick `manifest.json`. Select a frame -> run "Design to Code
JSON". Output updates on selection change; use Re-read to force a fresh variable
catalog pull.
