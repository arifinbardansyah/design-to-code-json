# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/), versioning is [SemVer](https://semver.org/).

Note: GitHub/SemVer versions here are independent of Figma Community's own
release counter — each entry notes the matching Community release where useful.

## [Unreleased]

## [0.4.0] — 2026-06-16

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

[Unreleased]: https://github.com/arifinbardansyah/design-to-code-json/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.4.0
[0.3.1]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.3.1
[0.3.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.3.0
[0.2.2]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.2.2
[0.2.1]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.2.1
[0.2.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.2.0
[0.1.0]: https://github.com/arifinbardansyah/design-to-code-json/releases/tag/v0.1.0
