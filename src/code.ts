// Figma plugin main thread. Walks the current selection into a compact,
// codegen-friendly `nodes` tree and emits the file's variable catalog in two
// shapes: `variables` (Figma-shaped, name-keyed) and `tokens` (W3C/DTCG).
// Output is one JSON document posted to the UI. No design-system coupling.
//
// Compaction: default/zero values are omitted, single-style text is hoisted,
// component instances are treated as atoms (component + variants + captured
// icon/text overrides) unless "expand instances" is on, and Figma ids are
// dropped. All toggled from the UI.

import {
  rgbaToHex,
  buildFigmaShaped,
  buildTokens,
  type ModeOption,
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

// --- options ----------------------------------------------------------------

interface Options {
  expandInstances: boolean;
  modes: ModeOption;
  dropIds: boolean;
}
let options: Options = { expandInstances: false, modes: 'lightDark', dropIds: true };

/** Drop keys whose value is `undefined` (JSON already omits them, but this
 *  keeps intermediate objects clean and lets callers test emptiness). */
function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// --- bound-variable helpers (record id for the catalog, return the name) ----

async function boundVarName(alias: VariableAlias | undefined, ref: Set<string>): Promise<string | undefined> {
  if (!alias?.id) return undefined;
  ref.add(alias.id);
  const v = await getVar(alias.id);
  return v?.name ?? undefined;
}

function scalarBound(node: any, field: string): VariableAlias | undefined {
  const b = node.boundVariables?.[field];
  return isAlias(b) ? b : undefined;
}

function paintBound(node: any, field: 'fills' | 'strokes', index: number): VariableAlias | undefined {
  const arr = node.boundVariables?.[field];
  return Array.isArray(arr) && isAlias(arr[index]) ? arr[index] : undefined;
}

/** A dimension: a bare number, `{value, variable}` when bound, or undefined
 *  when zero and unbound. */
async function dim(px: number, alias: VariableAlias | undefined, ref: Set<string>): Promise<unknown> {
  const variable = await boundVarName(alias, ref);
  if (variable) return { value: px, variable };
  return px ? px : undefined;
}

// --- paint / effect / radius / layout / constraints -------------------------

async function compactPaints(node: any, field: 'fills' | 'strokes', ref: Set<string>): Promise<unknown[] | undefined> {
  const paints = node[field];
  if (!paints || paints === figma.mixed || !Array.isArray(paints) || !paints.length) return undefined;
  const out: unknown[] = [];
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      const variable = await boundVarName(paintBound(node, field, i), ref);
      out.push(prune({
        color: rgbaToHex({ r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity ?? 1 }),
        variable,
      }));
    } else if (p.type.startsWith('GRADIENT')) {
      out.push({
        gradient: p.type,
        stops: p.gradientStops?.map((s: any) => ({ position: s.position, color: rgbaToHex(s.color) })),
      });
    } else if (p.type === 'IMAGE') {
      out.push({ image: p.scaleMode });
    }
  }
  return out.length ? out : undefined;
}

function compactEffects(node: any): unknown[] | undefined {
  const fx = node.effects;
  if (!fx || !Array.isArray(fx) || !fx.length) return undefined;
  const out = fx
    .filter((e: any) => e.visible !== false)
    .map((e: any) => {
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        return prune({
          type: e.type,
          color: rgbaToHex(e.color),
          offset: { x: e.offset.x, y: e.offset.y },
          radius: e.radius,
          spread: e.spread || undefined,
        });
      }
      return { type: e.type, radius: e.radius };
    });
  return out.length ? out : undefined;
}

async function compactRadius(node: any, ref: Set<string>): Promise<unknown | undefined> {
  const r = node.cornerRadius;
  if (typeof r === 'number') return dim(r, scalarBound(node, 'topLeftRadius'), ref);
  const corners = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'] as const;
  if (corners.some((c) => node[c] > 0)) {
    const obj: Record<string, unknown> = {};
    for (const c of corners) obj[c] = await dim(node[c] ?? 0, scalarBound(node, c), ref);
    return prune(obj);
  }
  return undefined;
}

async function compactLayout(node: any, ref: Set<string>): Promise<unknown | undefined> {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return undefined;
  const padding = prune({
    top: await dim(node.paddingTop ?? 0, scalarBound(node, 'paddingTop'), ref),
    right: await dim(node.paddingRight ?? 0, scalarBound(node, 'paddingRight'), ref),
    bottom: await dim(node.paddingBottom ?? 0, scalarBound(node, 'paddingBottom'), ref),
    left: await dim(node.paddingLeft ?? 0, scalarBound(node, 'paddingLeft'), ref),
  });
  const bothHug = node.layoutSizingHorizontal === 'HUG' && node.layoutSizingVertical === 'HUG';
  // Under SPACE_BETWEEN itemSpacing is Figma's auto-computed leftover — meaningless.
  const gap = node.primaryAxisAlignItems === 'SPACE_BETWEEN'
    ? undefined
    : await dim(node.itemSpacing ?? 0, scalarBound(node, 'itemSpacing'), ref);
  return prune({
    mode: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
    wrap: node.layoutWrap === 'WRAP' ? true : undefined,
    gap,
    padding: Object.keys(padding).length ? padding : undefined,
    primaryAxisAlign: node.primaryAxisAlignItems !== 'MIN' ? node.primaryAxisAlignItems : undefined,
    counterAxisAlign: node.counterAxisAlignItems !== 'MIN' ? node.counterAxisAlignItems : undefined,
    sizing: bothHug ? undefined : { horizontal: node.layoutSizingHorizontal, vertical: node.layoutSizingVertical },
  });
}

function compactConstraints(node: any): unknown | undefined {
  const c = node.constraints;
  if (!c || (c.horizontal === 'MIN' && c.vertical === 'MIN')) return undefined;
  return { horizontal: c.horizontal, vertical: c.vertical };
}

// --- text -------------------------------------------------------------------

async function styleNameOf(id: unknown): Promise<string | undefined> {
  if (typeof id !== 'string' || !id) return undefined;
  try {
    const s = await figma.getStyleByIdAsync(id);
    return s?.name ?? undefined;
  } catch {
    return undefined;
  }
}

async function compactText(node: TextNode, ref: Set<string>): Promise<Record<string, unknown>> {
  const fields = [
    'fontName', 'fontSize', 'fills', 'textStyleId',
    'textDecoration', 'letterSpacing', 'lineHeight', 'boundVariables',
  ] as const;
  const segs = node.getStyledTextSegments(fields as any);

  const segOut = async (s: any) => {
    const fillBound = s.boundVariables?.fills?.[0];
    const color = Array.isArray(s.fills) && s.fills[0]?.type === 'SOLID'
      ? rgbaToHex({ r: s.fills[0].color.r, g: s.fills[0].color.g, b: s.fills[0].color.b, a: s.fills[0].opacity ?? 1 })
      : undefined;
    const lsRaw = typeof s.letterSpacing === 'object' ? s.letterSpacing.value : s.letterSpacing;
    const ls = lsRaw ? Math.round(lsRaw * 1000) / 1000 : undefined; // strip float noise
    return prune({
      characters: s.characters,
      font: prune({
        family: s.fontName?.family,
        style: s.fontName?.style && s.fontName.style !== 'Regular' ? s.fontName.style : undefined,
        size: s.fontSize,
        lineHeight: s.lineHeight?.unit === 'AUTO' ? undefined : s.lineHeight?.value,
        letterSpacing: ls,
      }),
      color,
      colorVariable: await boundVarName(isAlias(fillBound) ? fillBound : undefined, ref),
    });
  };

  const align = (node.textAlignHorizontal !== 'LEFT' || node.textAlignVertical !== 'TOP')
    ? prune({
        horizontal: node.textAlignHorizontal !== 'LEFT' ? node.textAlignHorizontal : undefined,
        vertical: node.textAlignVertical !== 'TOP' ? node.textAlignVertical : undefined,
      })
    : undefined;
  const base: Record<string, unknown> = {
    characters: node.characters,
    textStyle: await styleNameOf((node as any).textStyleId),
    align,
  };

  if (segs.length <= 1) {
    if (segs.length) {
      const one = await segOut(segs[0]);
      base.font = one.font;
      base.color = one.color;
      base.colorVariable = one.colorVariable;
    }
  } else {
    base.segments = await Promise.all(segs.map(segOut));
  }
  return prune(base);
}

// --- component identity + override capture ---------------------------------

function variantsOf(node: InstanceNode): Record<string, string> | undefined {
  const variants: Record<string, string> = {};
  const props = node.componentProperties ?? {};
  for (const [k, v] of Object.entries(props)) {
    if ((v as any).type === 'VARIANT') variants[k.split('#')[0]] = String((v as any).value);
  }
  return Object.keys(variants).length ? variants : undefined;
}

async function componentName(node: InstanceNode): Promise<string> {
  const main = await node.getMainComponentAsync();
  if (main?.parent?.type === 'COMPONENT_SET') return main.parent.name;
  return main?.name ?? node.name;
}

/** Scan an instance's subtree for the content worth keeping when we don't
 *  expand it: nested component (icon) names and visible text. */
async function scanOverrides(node: SceneNode): Promise<Record<string, unknown>> {
  const components: string[] = [];
  const texts: string[] = [];
  async function walk(n: any): Promise<void> {
    for (const c of n.children ?? []) {
      if (c.visible === false) continue;
      if (c.type === 'INSTANCE') {
        components.push(await componentName(c));
        await walk(c);
      } else if (c.type === 'TEXT') {
        if (c.characters?.trim()) texts.push(c.characters);
      } else {
        await walk(c);
      }
    }
  }
  await walk(node);
  const uniq = [...new Set(components)];
  return prune({
    icon: uniq.length === 1 ? uniq[0] : undefined,
    components: uniq.length > 1 ? uniq : undefined,
    text: texts.length ? texts.join(' ') : undefined,
  });
}

// --- node walk --------------------------------------------------------------

async function serializeNode(node: SceneNode, depth: number, ref: Set<string>): Promise<unknown> {
  const n = node as any;
  const out: Record<string, unknown> = {};
  if (!options.dropIds) out.id = node.id;
  out.name = node.name;
  out.type = node.type;

  // Instance as an atom: identity + captured overrides, no internals.
  if (node.type === 'INSTANCE' && !options.expandInstances) {
    out.component = await componentName(node);
    out.variants = variantsOf(node);
    Object.assign(out, await scanOverrides(node));
    const fixed = n.layoutSizingHorizontal === 'FIXED' || !('layoutMode' in n) || n.layoutMode === 'NONE';
    if (fixed && 'width' in n) out.size = { width: Math.round(n.width), height: Math.round(n.height) };
    return prune(out);
  }
  if (node.type === 'INSTANCE') {
    out.component = await componentName(node);
    out.variants = variantsOf(node);
  }

  if (node.type === 'TEXT') {
    Object.assign(out, await compactText(node, ref));
  } else {
    if ('layoutMode' in n) out.layout = await compactLayout(n, ref);
    out.constraints = compactConstraints(n);
    if ('fills' in n) out.fills = await compactPaints(n, 'fills', ref);
    if ('strokes' in n && n.strokes?.length) {
      out.strokes = await compactPaints(n, 'strokes', ref);
      out.strokeWeight = typeof n.strokeWeight === 'number' && n.strokeWeight ? n.strokeWeight : undefined;
    }
    if ('cornerRadius' in n) out.cornerRadius = await compactRadius(n, ref);
    if ('effects' in n) out.effects = compactEffects(n);
    if ('opacity' in n && n.opacity !== 1) out.opacity = n.opacity;
    const hasChildren = 'children' in node && node.children.length > 0;
    if (!hasChildren && 'width' in n) out.size = { width: Math.round(n.width), height: Math.round(n.height) };
  }

  if ('children' in node && node.children.length && depth < 50) {
    const kids: unknown[] = [];
    for (const child of node.children) {
      if ('visible' in child && child.visible === false) continue;
      kids.push(await safeSerialize(child, depth + 1, ref));
    }
    if (kids.length) out.children = kids;
  }
  return prune(out);
}

/** One throwing node degrades to a stub, never sinks the whole export. */
async function safeSerialize(node: SceneNode, depth: number, ref: Set<string>): Promise<unknown> {
  try {
    return await serializeNode(node, depth, ref);
  } catch (e) {
    return { name: node.name, type: node.type, error: String(e) };
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
    source: { file: figma.root.name },
    nodes,
    variables: buildFigmaShaped(catalog, options.modes),
    tokens: buildTokens(catalog, options.modes, options.dropIds),
  };

  figma.ui.postMessage({ type: 'result', json: JSON.stringify(doc, null, 2), empty: sel.length === 0 });
}

figma.showUI(__html__, { width: 480, height: 620, title: 'Design Extractor' });
figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'options') {
    options = { ...options, ...msg.options };
    await run();
  } else if (msg.type === 'export') {
    await run(true); // manual Re-read forces a fresh catalog pull
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};
run();
figma.on('selectionchange', () => run());
