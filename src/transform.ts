// Pure, Figma-API-free transforms: colour conversion and the flat reference
// catalog (variable name -> resolved value per mode) that the `colors` /
// `dimensions` sections of the output are built from.
//
// `code.ts` reads the live document and lowers it to the plain `RawCatalog`
// intermediate below; everything here operates on that, so it can be unit
// tested in Node without a Figma sandbox.

// --- intermediate representation (produced by code.ts) ---------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type RawValue =
  | { kind: 'COLOR'; rgba: Rgba }
  | { kind: 'FLOAT'; value: number }
  | { kind: 'STRING'; value: string }
  | { kind: 'BOOLEAN'; value: boolean }
  | { kind: 'ALIAS'; id: string };

export type VarType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface RawVariable {
  id: string;
  name: string;
  type: VarType;
  collectionId: string;
  scopes: string[];
  valuesByMode: Record<string, RawValue>; // modeId -> value
}

export interface RawCollection {
  id: string;
  name: string;
  modes: { id: string; name: string }[];
  defaultModeId: string;
}

export interface RawCatalog {
  collections: RawCollection[];
  variables: RawVariable[];
}

// --- colour ----------------------------------------------------------------

const hex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** `{r,g,b,a}` (0..1) -> `#RRGGBB`, or `#RRGGBBAA` when not fully opaque. */
export function rgbaToHex(c: Rgba): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a >= 1 ? base : `${base}${hex2(c.a)}`;
}

// --- mode selection ---------------------------------------------------------

export type ModeOption = 'all' | 'lightDark' | 'default';

/** Mode ids to keep for a collection: all, default-only, or default + a Dark mode. */
export function selectModeIds(coll: RawCollection, opt: ModeOption): string[] {
  if (opt === 'all') return coll.modes.map((m) => m.id);
  const ids = [coll.defaultModeId];
  if (opt === 'lightDark') {
    const dark = coll.modes.find((m) => m.id !== coll.defaultModeId && /dark/i.test(m.name));
    if (dark) ids.push(dark.id);
  }
  return ids;
}

// --- index + alias resolution ----------------------------------------------

function indexById<T extends { id: string }>(rows: T[]): Record<string, T> {
  const m: Record<string, T> = {};
  for (const r of rows) m[r.id] = r;
  return m;
}

/** Value of `variable` in `modeId`, falling back to its collection default, then any. */
function pickModeValue(
  variable: RawVariable,
  modeId: string,
  collById: Record<string, RawCollection>,
): RawValue | undefined {
  const byMode = variable.valuesByMode;
  if (byMode[modeId]) return byMode[modeId];
  const def = collById[variable.collectionId]?.defaultModeId;
  if (def && byMode[def]) return byMode[def];
  const first = Object.keys(byMode)[0];
  return first ? byMode[first] : undefined;
}

/** Follow an alias chain to its final literal value (hex / number / string /
 *  boolean), or null. Cycle-guarded. */
export function resolveToLiteral(
  value: RawValue | undefined,
  modeId: string,
  varById: Record<string, RawVariable>,
  collById: Record<string, RawCollection>,
  seen: Set<string> = new Set(),
): string | number | boolean | null {
  if (!value) return null;
  if (value.kind === 'COLOR') return rgbaToHex(value.rgba);
  if (value.kind === 'FLOAT') return value.value;
  if (value.kind === 'STRING') return value.value;
  if (value.kind === 'BOOLEAN') return value.value;
  // ALIAS
  if (seen.has(value.id)) return null; // cycle
  seen.add(value.id);
  const target = varById[value.id];
  if (!target) return null;
  return resolveToLiteral(pickModeValue(target, modeId, collById), modeId, varById, collById, seen);
}

// --- flat reference catalog -------------------------------------------------

export interface FlatCatalog {
  colors?: Record<string, Record<string, string>>;
  dimensions?: Record<string, Record<string, number>>;
}

/**
 * Flat, codegen-friendly catalog of the variables the selection actually
 * references: `name -> { mode: resolved value }`. COLOR variables go to
 * `colors` (hex), FLOAT to `dimensions` (number); aliases are resolved to their
 * final literal. Limited to `referenced` ids and the selected `modes`.
 */
export function buildFlatCatalog(
  catalog: RawCatalog,
  referenced: Set<string>,
  modes: ModeOption = 'all',
): FlatCatalog {
  const varById = indexById(catalog.variables);
  const collById = indexById(catalog.collections);
  const colors: Record<string, Record<string, string>> = {};
  const dimensions: Record<string, Record<string, number>> = {};

  for (const v of catalog.variables) {
    if (!referenced.has(v.id)) continue;
    const coll = collById[v.collectionId];
    if (!coll) continue;
    const modeName: Record<string, string> = {};
    for (const m of coll.modes) modeName[m.id] = m.name;

    const perMode: Record<string, string | number> = {};
    for (const modeId of selectModeIds(coll, modes)) {
      const lit = resolveToLiteral(v.valuesByMode[modeId], modeId, varById, collById);
      if (lit !== null && typeof lit !== 'boolean') perMode[modeName[modeId] ?? modeId] = lit;
    }
    if (!Object.keys(perMode).length) continue;

    if (v.type === 'COLOR') colors[v.name] = perMode as Record<string, string>;
    else if (v.type === 'FLOAT') dimensions[v.name] = perMode as Record<string, number>;
  }

  const out: FlatCatalog = {};
  if (Object.keys(colors).length) out.colors = colors;
  if (Object.keys(dimensions).length) out.dimensions = dimensions;
  return out;
}
