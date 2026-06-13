// Pure, Figma-API-free transforms: colour conversion, the lossless
// Figma-shaped variable catalog, and the W3C/DTCG design-tokens tree.
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

// --- name helpers ----------------------------------------------------------

/** Split a variable name on `/` into trimmed path segments. */
export function nameToPath(name: string): string[] {
  return name
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** DTCG alias reference, e.g. `color/primitive/green/500` -> `{color.primitive.green.500}`. */
export function pathToRef(name: string): string {
  return `{${nameToPath(name).join('.')}}`;
}

// --- index helpers ---------------------------------------------------------

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

// --- Figma-shaped (lossless) catalog ---------------------------------------

type FigmaShapedValue =
  | string
  | number
  | boolean
  | { type: 'VARIABLE_ALIAS'; id: string; name: string | null };

function serializeRaw(v: RawValue, varById: Record<string, RawVariable>): FigmaShapedValue {
  switch (v.kind) {
    case 'COLOR':
      return rgbaToHex(v.rgba);
    case 'FLOAT':
      return v.value;
    case 'STRING':
      return v.value;
    case 'BOOLEAN':
      return v.value;
    case 'ALIAS':
      return { type: 'VARIABLE_ALIAS', id: v.id, name: varById[v.id]?.name ?? null };
  }
}

/** Lossless mirror of Figma's structure; aliases kept (with resolved name). */
export function buildFigmaShaped(catalog: RawCatalog) {
  const varById = indexById(catalog.variables);
  return {
    collections: catalog.collections.map((coll) => ({
      id: coll.id,
      name: coll.name,
      modes: coll.modes,
      defaultModeId: coll.defaultModeId,
      variables: catalog.variables
        .filter((v) => v.collectionId === coll.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          type: v.type,
          scopes: v.scopes,
          valuesByMode: Object.fromEntries(
            Object.entries(v.valuesByMode).map(([mode, val]) => [
              mode,
              serializeRaw(val, varById),
            ]),
          ),
        })),
    })),
  };
}

// --- alias resolution (chain -> literal, cycle-guarded) --------------------

/** Follow an alias chain to its final literal value (or null). For convenience
 *  fields; the DTCG `$value` keeps the *reference* rather than resolving. */
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

// --- W3C / DTCG token tree -------------------------------------------------

const DIMENSION_HINTS = [
  'radius', 'space', 'spacing', 'gap', 'padding', 'inset',
  'size', 'width', 'height', 'dimension',
];

function dtcgType(v: RawVariable): string {
  switch (v.type) {
    case 'COLOR':
      return 'color';
    case 'STRING':
      return 'string';
    case 'BOOLEAN':
      return 'boolean';
    case 'FLOAT': {
      const lower = v.name.toLowerCase();
      return DIMENSION_HINTS.some((h) => lower.includes(h)) ? 'dimension' : 'number';
    }
  }
}

/** Render one mode's value as a DTCG `$value`: literal serialized per `$type`,
 *  alias as a `{ref}`. */
function dtcgValue(
  v: RawVariable,
  raw: RawValue | undefined,
  $type: string,
  varById: Record<string, RawVariable>,
): string | number | boolean | null {
  if (!raw) return null;
  if (raw.kind === 'ALIAS') {
    const target = varById[raw.id];
    return target ? pathToRef(target.name) : null;
  }
  if (raw.kind === 'COLOR') return rgbaToHex(raw.rgba);
  if (raw.kind === 'FLOAT') return $type === 'dimension' ? `${raw.value}px` : raw.value;
  if (raw.kind === 'STRING') return raw.value;
  return raw.value; // BOOLEAN
}

interface TokenNode {
  [key: string]: TokenNode | unknown;
}

/** Build a DTCG token tree from the catalog. Default mode -> `$value`;
 *  non-default modes + figma metadata -> `$extensions["com.figma"]`. */
export function buildTokens(catalog: RawCatalog): TokenNode {
  const varById = indexById(catalog.variables);
  const collById = indexById(catalog.collections);
  const root: TokenNode = {};

  for (const v of catalog.variables) {
    const coll = collById[v.collectionId];
    if (!coll) continue;
    const $type = dtcgType(v);

    // navigate/create the nested group for this name path
    const path = nameToPath(v.name);
    let node = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key] as TokenNode;
    }
    const leaf = path[path.length - 1];

    const defVal = dtcgValue(v, v.valuesByMode[coll.defaultModeId], $type, varById);

    const figmaExt: Record<string, unknown> = { id: v.id, collection: coll.name };
    // resolved literal of the default mode (handy when $value is a reference)
    const resolved = resolveToLiteral(v.valuesByMode[coll.defaultModeId], coll.defaultModeId, varById, collById);
    if (resolved !== null) figmaExt.resolved = resolved;
    // non-default modes
    const extraModes: Record<string, unknown> = {};
    for (const m of coll.modes) {
      if (m.id === coll.defaultModeId) continue;
      extraModes[m.name] = dtcgValue(v, v.valuesByMode[m.id], $type, varById);
    }
    if (Object.keys(extraModes).length) figmaExt.modes = extraModes;

    const token: TokenNode = {
      $type,
      $value: defVal,
      $extensions: { 'com.figma': figmaExt },
    };
    // merge onto any existing group node at this key (token + subgroup coexist)
    node[leaf] = Object.assign(typeof node[leaf] === 'object' && node[leaf] ? node[leaf] : {}, token);
  }

  return root;
}
