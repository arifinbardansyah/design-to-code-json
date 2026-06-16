# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/), versioning is [SemVer](https://semver.org/).

Note: GitHub/SemVer versions here are independent of Figma Community's own
release counter — each entry notes the matching Community release where useful.

## [Unreleased]

## [0.8.1] — 2026-06-16

### Fixed
- **Variant value table no longer emits redundant node trees.** Classification of
  a variant as value-change vs. structural now compares tree **shape** (node type
  + child arity, ignoring values) instead of the dedupe `signature` — which baked
  styling values (corner radius, layout, sizing) into its key and so misclassified
  almost every variant as structural. Value-only variants (Type=corner radius,
  Size=dimensions, State=fill/opacity) now collapse into compact `variantStyles`
  deltas; only variants that genuinely change the child tree (e.g. a State that
  adds a ripple child) remain full `variants` entries. New pure `sameShape` gate,
  unit-tested in `tool/test_components.mjs`.

## [0.8.0] — 2026-06-16

### Added
- **Variant value table** option (default off) — for a component set, reads the
  whole set from the design and emits the default variant as the base `node`
  plus a per-axis `variantStyles` table of the styling each variant value
  changes vs. base (`{ Size: { Large: { size: 64, … } } }`). Per-variant values
  now come from the design instead of being left to the consumer's code.
  Serializes the base + one variant per axis-value (not the combo product);
  values that change *structure* become `variants` entries. Diff is the pure,
  unit-tested `valueDelta`; heavier, so editor-panel oriented.

## [0.7.1] — 2026-06-16

### Fixed
- Component use-refs now keep the instance's rendered `size` when it's fixed, so
  per-instance dimensions (e.g. a `Size` variant of an icon button) are no longer
  lost when the instance collapses to `{ use, … }`.

## [0.7.0] — 2026-06-16

### Changed
- **Removed the Variable modes option.** `colors` / `dimensions` now always emit
  every mode a variable defines (single mode still collapses to a bare value;
  Light/Dark stays keyed by mode). Drops the editor dropdown and codegen
  preference — **Split variants** is now the only option.

## [0.6.0] — 2026-06-16

### Added
- **Split variants** option (default off) — for a component set, emit one
  definition per *structurally-distinct* variant actually used. Value-only
  variants (Hierarchy/Size/State) still share one def; only variants that change
  the child tree (e.g. `.Coin expiry info` `expanded`) split. One structure stays
  flat; multiple nest under `components[name].variants` with a `variant` pointer
  on each use-ref. Structure detection reuses the dedupe `signature()`; only
  placed variants are processed (no combinatorial blow-up). Per-variant values
  aren't captured (the consumer component owns variant styling).

## [0.5.0] — 2026-06-16

### Changed
- **Spacing/radius are now references.** `gap`, `padding`, and `cornerRadius`
  bound to a variable emit the variable *name* (resolved in `dimensions`),
  matching how colours/text styles work — instead of `{ value, variable }`.
- **Single-mode catalog entries collapse to a bare value** — `"spacing/md": 16`
  and `"brand/primary": "#6D12B5"` instead of `{ "Mode 1": 16 }`. Multi-mode
  entries (e.g. Light + Dark) still keep the per-mode object.
- **Component definition names are clean** — a component def is named after the
  component/set (e.g. `Link`), not the raw `Hierarchy=Primary, Size=md…` string.

### Added
- **Colour styles resolve to tokens.** `fill` / `stroke` / text `color` bound to
  a Figma *colour style* (not just a variable) now emit the style name and join
  the `colors` catalog. Raw, unbound colours still fall back to hex.

### Changed
- **Simplified to one option.** Dedupe components, Component library, and Drop
  ids are now always on, and Expand instances is gone (instances always resolve
  via `components`). The only remaining control is **Variable modes**. Removes
  the matching checkboxes (editor panel) and codegen preferences.

## [0.3.1] — 2026-06-16

### Fixed
- **Component library** now **composes** with **Dedupe components** instead of
  replacing it. With both on, real Figma components are extracted by identity
  *and* repeated non-component frames (e.g. list items) are still deduped into
  the same `components` map. Previously, enabling Component library suppressed
  dedupe, leaving repeated frames inline.

## [0.3.0] — 2026-06-16

### Added
- **Component library** option — emit each Figma component once into
  `components` (with `{{prop}}` placeholders for text bound to component text
  properties), and turn every instance into a `{ use, variants, props }`
  reference, even single-use ones. Uses Figma's component identity rather than
  repeated-subtree detection, so a single instance no longer collapses to a
  "too simple" atom. Leaf/icon instances stay atoms. Available in the editor
  panel and as a Dev Mode codegen preference; overrides Dedupe components.

## [0.2.2] — 2026-06-16

### Changed
- Codegen output now self-reports: the Code section title shows the running
  build (`Design to Code JSON (vX.Y.Z)`), and a thrown error renders as visible
  text instead of a blank panel — so one look identifies build vs error vs
  timeout. Version is injected at build time from `package.json`.

### Fixed
- Reduced codegen timeout risk on instance-heavy frames: nested instances'
  main components are now resolved in parallel instead of sequentially.

## [0.2.1] — 2026-06-16

### Fixed
- **Dev Mode codegen rendered blank** on larger files. The `generate` callback
  has a hard 3-second timeout, and the catalog step enumerated every variable in
  the file first. Codegen now resolves only the variables the inspected node
  references, and the node tree still emits if variable reads fail.

## [0.2.0] — 2026-06-16

### Added
- **Dev Mode codegen** — the plugin now runs in Dev Mode's Inspect panel and
  emits the same JSON, so it works for **viewers without edit access** (the
  editor plugin flow needs editor access). Options (modes, dedupe, expand
  instances, drop ids) are exposed as native codegen preferences.

## [0.1.0] — 2026-06-14

First public release — live on
[Figma Community](https://www.figma.com/community/plugin/1647834863384185949).

### Added
- Export a Figma selection as compact, codegen-ready JSON.
- **nodes** — compact tree: auto-layout (mode/gap/padding/sizing), corner
  radius, effects, opacity, text. Component instances collapse to atoms with
  captured `icon`/`text` overrides.
- **colors / textStyles / dimensions** — flat catalogs of the variables and
  text styles the selection uses (`name → value per mode`, aliases resolved).
  Node `fill`/`color`/`textStyle` are references into them; raw values appear
  only when a property isn't bound.
- **components** — optional dedupe: repeated subtrees extracted into reusable
  definitions; fields that differ across uses become props (path-based names).
- Options: Dedupe components (default on), Expand instances, Drop ids,
  Modes (Light + Dark / Default only / All).
- Runs entirely offline (`networkAccess: none`); reads variables, so it works
  on any Figma plan with editor access.

[Unreleased]: https://github.com/arifinbardansyah/design-to-code-json/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.8.1
[0.8.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.8.0
[0.7.1]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.7.1
[0.7.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.7.0
[0.6.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.6.0
[0.5.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.5.0
[0.4.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.4.0
[0.3.1]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.3.1
[0.3.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.3.0
[0.2.2]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.2.2
[0.2.1]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.2.1
[0.2.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.2.0
[0.1.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.1.0
