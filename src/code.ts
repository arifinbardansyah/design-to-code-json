// Figma plugin main thread. Walks the current selection into a structured
// `nodes` tree (layout, style, colour, effects, text, component identity, and
// inline bound-variable refs), then emits the file's full variable catalog in
// two shapes: lossless `variables` (Figma-shaped) and `tokens` (W3C/DTCG).
// Output is a single JSON document posted to the UI. No design-system coupling.

import {
  rgbaToHex,
  buildFigmaShaped,
  buildTokens,
  type RawCatalog,
  type RawCollection,
  type RawValue,
  type RawVariable,
  type VarType,
} from './transform';

// --- variable reading -------------------------------------------------------

const varCache = new Map<string, Variable | null>();
const collCache = new Map<string, VariableCollection | null>();

async function getVar(id: string): Promise<Variable | null> {
  if (varCache.has(id)) return varCache.get(id)!;
  let v: Variable | null = null;
  try {
    v = await figma.variables.getVariableByIdAsync(id);
  } catch {
    v = null;
  }
  varCache.set(id, v);
  return v;
}

async function getColl(id: string): Promise<VariableCollection | null> {
  if (collCache.has(id)) return collCache.get(id)!;
  let c: VariableCollection | null = null;
  try {
    c = await figma.variables.getVariableCollectionByIdAsync(id);
  } catch {
    c = null;
  }
  collCache.set(id, c);
  return c;
}

function isAlias(v: unknown): v is VariableAlias {
  return !!v && typeof v === 'object' && (v as any).type === 'VARIABLE_ALIAS';
}

function lowerValue(val: VariableValue, type: VarType): RawValue {
  if (isAlias(val)) return { kind: 'ALIAS', id: val.id };
  if (type === 'COLOR') {
    const c = val as RGBA | RGB;
    return { kind: 'COLOR', rgba: { r: c.r, g: c.g, b: c.b, a: 'a' in c ? c.a : 1 } };
  }
  if (type === 'FLOAT') return { kind: 'FLOAT', value: val as number };
  if (type === 'BOOLEAN') return { kind: 'BOOLEAN', value: val as boolean };
  return { kind: 'STRING', value: String(val) };
}

function lowerVariable(v: Variable): RawVariable {
  const valuesByMode: Record<string, RawValue> = {};
  for (const [mode, val] of Object.entries(v.valuesByMode)) {
    valuesByMode[mode] = lowerValue(val, v.resolvedType as VarType);
  }
  return {
    id: v.id,
    name: v.name,
    type: v.resolvedType as VarType,
    collectionId: v.variableCollectionId,
    scopes: v.scopes,
    valuesByMode,
  };
}

interface CatalogMaps {
  variables: Map<string, RawVariable>;
  collections: Map<string, RawCollection>;
}

/** BFS-resolve `seed` ids (and their alias targets) into the given maps. */
async function resolveInto(maps: CatalogMaps, seed: Iterable<string>): Promise<void> {
  const queue = [...seed];
  while (queue.length) {
    const id = queue.shift()!;
    if (maps.variables.has(id)) continue;
    const v = await getVar(id);
    if (!v) continue;
    const lowered = lowerVariable(v);
    maps.variables.set(id, lowered);
    if (!maps.collections.has(v.variableCollectionId)) {
      const c = await getColl(v.variableCollectionId);
      if (c) {
        maps.collections.set(c.id, {
          id: c.id,
          name: c.name,
          modes: c.modes.map((m) => ({ id: m.modeId, name: m.name })),
          defaultModeId: c.defaultModeId,
        });
      }
    }
    for (const val of Object.values(lowered.valuesByMode)) {
      if (val.kind === 'ALIAS' && !maps.variables.has(val.id)) queue.push(val.id);
    }
  }
}

// The local catalog is selection-independent and expensive (one async call per
// variable), so cache it across selectionchange events. `Re-read` clears it.
let localCatalogCache: CatalogMaps | null = null;

async function getLocalCatalog(): Promise<CatalogMaps> {
  if (localCatalogCache) return localCatalogCache;
  const maps: CatalogMaps = { variables: new Map(), collections: new Map() };
  const seed: string[] = [];
  for (const coll of await figma.variables.getLocalVariableCollectionsAsync()) {
    maps.collections.set(coll.id, {
      id: coll.id,
      name: coll.name,
      modes: coll.modes.map((m) => ({ id: m.modeId, name: m.name })),
      defaultModeId: coll.defaultModeId,
    });
    seed.push(...coll.variableIds);
  }
  await resolveInto(maps, seed);
  localCatalogCache = maps;
  return maps;
}

/**
 * Catalog = cached local enumeration + any variables the selection references
 * (incl. remote/library ones and alias targets). RawVariable objects are
 * immutable, so reusing the cached map values is safe.
 */
async function buildCatalog(referenced: Set<string>): Promise<RawCatalog> {
  const local = await getLocalCatalog();
  const maps: CatalogMaps = {
    variables: new Map(local.variables),
    collections: new Map(local.collections),
  };
  await resolveInto(maps, referenced);
  return { collections: [...maps.collections.values()], variables: [...maps.variables.values()] };
}

// --- bound-variable helpers (record id + resolve name) ---------------------

async function boundRef(
  alias: VariableAlias | undefined,
  ref: Set<string>,
): Promise<{ id: string; name: string | null } | undefined> {
  if (!alias?.id) return undefined;
  ref.add(alias.id);
  const v = await getVar(alias.id);
  return { id: alias.id, name: v?.name ?? null };
}

function scalarBound(node: any, field: string): VariableAlias | undefined {
  const b = node.boundVariables?.[field];
  return isAlias(b) ? b : undefined;
}

function paintBound(node: any, field: 'fills' | 'strokes', index: number): VariableAlias | undefined {
  const arr = node.boundVariables?.[field];
  return Array.isArray(arr) && isAlias(arr[index]) ? arr[index] : undefined;
}

// --- paint / effect serialisation ------------------------------------------

async function serializePaints(node: any, field: 'fills' | 'strokes', ref: Set<string>): Promise<unknown[] | undefined> {
  const paints = node[field];
  if (!paints || paints === figma.mixed || !Array.isArray(paints) || paints.length === 0) return undefined;
  const out: unknown[] = [];
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      out.push({
        type: 'SOLID',
        color: rgbaToHex({ r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity ?? 1 }),
        boundVariable: await boundRef(paintBound(node, field, i), ref),
      });
    } else if (p.type.startsWith('GRADIENT')) {
      out.push({
        type: p.type,
        stops: p.gradientStops?.map((s: any) => ({
          position: s.position,
          color: rgbaToHex(s.color),
        })),
      });
    } else if (p.type === 'IMAGE') {
      out.push({ type: 'IMAGE', scaleMode: p.scaleMode });
    }
  }
  return out.length ? out : undefined;
}

function serializeEffects(node: any): unknown[] | undefined {
  const fx = node.effects;
  if (!fx || !Array.isArray(fx) || fx.length === 0) return undefined;
  const out = fx
    .filter((e: any) => e.visible !== false)
    .map((e: any) => {
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        return {
          type: e.type,
          color: rgbaToHex(e.color),
          offset: { x: e.offset.x, y: e.offset.y },
          radius: e.radius,
          spread: e.spread ?? 0,
        };
      }
      return { type: e.type, radius: e.radius }; // LAYER_BLUR / BACKGROUND_BLUR
    });
  return out.length ? out : undefined;
}

async function serializeRadius(node: any, ref: Set<string>): Promise<unknown | undefined> {
  const r = node.cornerRadius;
  if (typeof r === 'number') {
    if (r === 0 && !node.boundVariables?.topLeftRadius) return undefined;
    return { value: r, boundVariable: await boundRef(scalarBound(node, 'topLeftRadius'), ref) };
  }
  // mixed corners
  const corners = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];
  if (corners.some((c) => node[c] > 0)) {
    const obj: Record<string, unknown> = {};
    for (const c of corners) {
      obj[c] = { value: node[c] ?? 0, boundVariable: await boundRef(scalarBound(node, c), ref) };
    }
    return obj;
  }
  return undefined;
}

async function serializeLayout(node: any, ref: Set<string>): Promise<unknown | undefined> {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return undefined;
  const padField = async (f: string) => ({ value: node[f] ?? 0, boundVariable: await boundRef(scalarBound(node, f), ref) });
  return {
    mode: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
    wrap: node.layoutWrap === 'WRAP' ? true : undefined,
    gap: { value: node.itemSpacing ?? 0, boundVariable: await boundRef(scalarBound(node, 'itemSpacing'), ref) },
    padding: {
      top: await padField('paddingTop'),
      right: await padField('paddingRight'),
      bottom: await padField('paddingBottom'),
      left: await padField('paddingLeft'),
    },
    primaryAxisAlign: node.primaryAxisAlignItems,
    counterAxisAlign: node.counterAxisAlignItems,
    sizing: { horizontal: node.layoutSizingHorizontal, vertical: node.layoutSizingVertical },
  };
}

function serializeConstraints(node: any): unknown | undefined {
  const c = node.constraints;
  if (!c) return undefined;
  const out: Record<string, unknown> = { horizontal: c.horizontal, vertical: c.vertical };
  for (const k of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
    if (node[k] != null) out[k] = node[k];
  }
  return out;
}

// --- text -------------------------------------------------------------------

async function serializeText(node: TextNode, ref: Set<string>): Promise<unknown> {
  const fields = [
    'fontName', 'fontSize', 'fills', 'textStyleId',
    'textDecoration', 'letterSpacing', 'lineHeight', 'boundVariables',
  ] as const;
  const segments: unknown[] = [];
  for (const seg of node.getStyledTextSegments(fields as any)) {
    const s = seg as any;
    const fillBound = s.boundVariables?.fills?.[0];
    const fill = Array.isArray(s.fills) && s.fills[0]?.type === 'SOLID'
      ? rgbaToHex({ r: s.fills[0].color.r, g: s.fills[0].color.g, b: s.fills[0].color.b, a: s.fills[0].opacity ?? 1 })
      : undefined;
    segments.push({
      characters: s.characters,
      fontFamily: s.fontName?.family,
      fontStyle: s.fontName?.style,
      fontSize: s.fontSize,
      letterSpacing: typeof s.letterSpacing === 'object' ? s.letterSpacing.value : s.letterSpacing,
      lineHeight: s.lineHeight?.unit === 'AUTO' ? 'AUTO' : s.lineHeight?.value,
      color: fill,
      colorVariable: await boundRef(isAlias(fillBound) ? fillBound : undefined, ref),
    });
  }
  const styleName = await styleNameOf((node as any).textStyleId);
  return {
    characters: node.characters,
    textAlign: { horizontal: (node as any).textAlignHorizontal, vertical: (node as any).textAlignVertical },
    textStyle: styleName ? { name: styleName } : undefined,
    segments,
  };
}

async function styleNameOf(id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  try {
    const s = await figma.getStyleByIdAsync(id);
    return s?.name ?? null;
  } catch {
    return null;
  }
}

// --- component identity -----------------------------------------------------

async function serializeComponent(node: InstanceNode): Promise<unknown> {
  const main = await node.getMainComponentAsync();
  const variants: Record<string, string> = {};
  const props = node.componentProperties ?? {};
  for (const [k, v] of Object.entries(props)) {
    if ((v as any).type === 'VARIANT') variants[k.split('#')[0]] = String((v as any).value);
  }
  return {
    name: main?.name ?? node.name,
    componentSet: main?.parent?.type === 'COMPONENT_SET' ? main.parent.name : undefined,
    variants: Object.keys(variants).length ? variants : undefined,
  };
}

// --- node walk --------------------------------------------------------------

function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

async function serializeNode(node: SceneNode, depth: number, ref: Set<string>): Promise<unknown> {
  const n = node as any;
  const out: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if (node.type === 'INSTANCE') out.component = await serializeComponent(node);

  if (node.type === 'TEXT') {
    out.text = await serializeText(node, ref);
  } else {
    if ('layoutMode' in n) out.layout = await serializeLayout(n, ref);
    if ('constraints' in n) out.constraints = serializeConstraints(n);
  }

  if ('fills' in n && node.type !== 'TEXT') out.fills = await serializePaints(n, 'fills', ref);
  if ('strokes' in n && n.strokes?.length) {
    out.strokes = await serializePaints(n, 'strokes', ref);
    out.strokeWeight = typeof n.strokeWeight === 'number' ? n.strokeWeight : undefined;
    out.strokeAlign = n.strokeAlign;
  }
  if ('cornerRadius' in n) out.cornerRadius = await serializeRadius(n, ref);
  if ('effects' in n) out.effects = serializeEffects(n);
  if ('opacity' in n && n.opacity !== 1) out.opacity = n.opacity;
  if (!('layoutMode' in n) || n.layoutMode === 'NONE') {
    if ('width' in n) out.size = { width: Math.round(n.width), height: Math.round(n.height) };
  }

  if ('children' in node && node.children.length && depth < 50) {
    const kids: unknown[] = [];
    for (const child of node.children) {
      if ('visible' in child && child.visible === false) continue;
      kids.push(await safeSerialize(child, depth + 1, ref));
    }
    out.children = kids;
  }
  return prune(out);
}

/** One throwing node (e.g. an odd text run) degrades to a stub, never sinks the export. */
async function safeSerialize(node: SceneNode, depth: number, ref: Set<string>): Promise<unknown> {
  try {
    return await serializeNode(node, depth, ref);
  } catch (e) {
    return { id: node.id, name: node.name, type: node.type, error: String(e) };
  }
}

// --- entry ------------------------------------------------------------------

let runSeq = 0;

async function run(forceCatalogRefresh = false): Promise<void> {
  const seq = ++runSeq;
  if (forceCatalogRefresh) localCatalogCache = null;

  const sel = figma.currentPage.selection;
  const referenced = new Set<string>();
  const nodes: unknown[] = [];
  for (const node of sel) nodes.push(await safeSerialize(node, 0, referenced));

  const catalog = await buildCatalog(referenced);
  if (seq !== runSeq) return; // a newer run superseded this one — drop stale result

  const doc = {
    schemaVersion: '1.0',
    source: { file: figma.root.name, selection: sel.map((n) => n.id) },
    nodes,
    variables: buildFigmaShaped(catalog),
    tokens: buildTokens(catalog),
  };

  figma.ui.postMessage({ type: 'result', json: JSON.stringify(doc, null, 2), empty: sel.length === 0 });
}

figma.showUI(__html__, { width: 480, height: 600, title: 'Design Extractor' });
figma.ui.onmessage = async (msg: { type: string }) => {
  if (msg.type === 'export') await run(true); // manual Re-read forces a fresh catalog
  if (msg.type === 'close') figma.closePlugin();
};
run();
figma.on('selectionchange', () => run());
