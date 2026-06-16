// Figma plugin main thread. Walks the selection into a compact, codegen-friendly
// `nodes` tree and emits reference catalogs: `colors` / `dimensions` (variables,
// resolved per mode) and `textStyles` (typography). Colours and text styles in
// `nodes` are emitted as *references* (names) that resolve into those catalogs;
// raw values appear only when unbound. Output is one JSON document — posted to
// the UI in the Figma editor, or returned to the Inspect panel in Dev Mode
// (codegen). No design-system coupling.

import {
  rgbaToHex,
  buildFlatCatalog,
  type FlatCatalog,
  type ModeOption,
  type RawCatalog,
  type RawCollection,
  type RawValue,
  type RawVariable,
  type VarType,
} from './transform';
import { synthesizeComponents, type Component } from './components';

// Injected at build time from package.json (see tool/build.mjs).
declare const __VERSION__: string;

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
 * Catalog = the variables the selection references (incl. remote/library ones
 * and alias targets), optionally seeded with the cached full local enumeration.
 * RawVariable objects are immutable, so reusing the cached map values is safe.
 *
 * `includeLocal` is off for Dev Mode codegen: the flat catalog only emits
 * referenced variables anyway, and enumerating every variable in a large file
 * blows past codegen's 3-second `generate` timeout. Resolving just the
 * referenced ids (and their alias targets) is bounded by what the node uses.
 */
async function buildCatalog(referenced: Set<string>, includeLocal = true): Promise<RawCatalog> {
  const maps: CatalogMaps = { variables: new Map(), collections: new Map() };
  if (includeLocal) {
    const local = await getLocalCatalog();
    for (const [k, v] of local.variables) maps.variables.set(k, v);
    for (const [k, v] of local.collections) maps.collections.set(k, v);
  }
  await resolveInto(maps, referenced);
  return { collections: [...maps.collections.values()], variables: [...maps.variables.values()] };
}

// --- options & per-run context ---------------------------------------------

interface Options {
  expandInstances: boolean;
  modes: ModeOption;
  dropIds: boolean;
  dedupe: boolean;
  componentLibrary: boolean;
}
let options: Options = {
  expandInstances: false,
  modes: 'lightDark',
  dropIds: true,
  dedupe: true,
  componentLibrary: false,
};

/** Per-run accumulators (kept off module scope so concurrent runs don't race). */
interface Ctx {
  vars: Set<string>; // bound variable ids referenced by the selection
  textStyles: Set<string>; // text style ids referenced by the selection
  // Component-library mode: each Figma component serialized once into `components`
  // (instances become `{ use, props }`). `building` guards cycles; `propSink`
  // collects the prop names of the component currently being defined.
  components: Record<string, Component>;
  building: Set<string>;
  propSink: Set<string> | null;
}

/** Drop keys whose value is `undefined`. */
function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// --- bound-variable helpers (record id for the catalog, return the name) ----

async function boundVarName(alias: VariableAlias | undefined, ctx: Ctx): Promise<string | undefined> {
  if (!alias?.id) return undefined;
  ctx.vars.add(alias.id);
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
async function dim(px: number, alias: VariableAlias | undefined, ctx: Ctx): Promise<unknown> {
  const variable = await boundVarName(alias, ctx);
  if (variable) return { value: px, variable };
  return px ? px : undefined;
}

// --- colour: a variable-name reference when bound, else a hex literal -------

async function colorOf(paint: any, alias: VariableAlias | undefined, ctx: Ctx): Promise<string | undefined> {
  const name = await boundVarName(alias, ctx);
  if (name) return name;
  if (paint?.type === 'SOLID') {
    return rgbaToHex({ r: paint.color.r, g: paint.color.g, b: paint.color.b, a: paint.opacity ?? 1 });
  }
  return undefined;
}

/** Returns `{ one }` for a single solid paint (-> scalar `fill`/`stroke`), or
 *  `{ many }` for multiple / non-solid paints (-> `fills`/`strokes` array). */
async function serializePaints(node: any, field: 'fills' | 'strokes', ctx: Ctx): Promise<{ one?: string; many?: unknown[] }> {
  const paints = node[field];
  if (!paints || paints === figma.mixed || !Array.isArray(paints) || !paints.length) return {};
  const entries: unknown[] = [];
  let solo: string | undefined;
  let onlySolid = true;
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      const c = await colorOf(p, paintBound(node, field, i), ctx);
      entries.push({ color: c });
      solo = c;
    } else if (p.type.startsWith('GRADIENT')) {
      onlySolid = false;
      entries.push({ gradient: p.type, stops: p.gradientStops?.map((s: any) => ({ position: s.position, color: rgbaToHex(s.color) })) });
    } else if (p.type === 'IMAGE') {
      onlySolid = false;
      entries.push({ image: p.scaleMode });
    }
  }
  if (!entries.length) return {};
  if (entries.length === 1 && onlySolid && solo !== undefined) return { one: solo };
  return { many: entries };
}

// --- effects / radius / layout / constraints --------------------------------

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

async function compactRadius(node: any, ctx: Ctx): Promise<unknown | undefined> {
  const r = node.cornerRadius;
  if (typeof r === 'number') return dim(r, scalarBound(node, 'topLeftRadius'), ctx);
  const corners = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'] as const;
  if (corners.some((c) => node[c] > 0)) {
    const obj: Record<string, unknown> = {};
    for (const c of corners) obj[c] = await dim(node[c] ?? 0, scalarBound(node, c), ctx);
    return prune(obj);
  }
  return undefined;
}

async function compactLayout(node: any, ctx: Ctx): Promise<unknown | undefined> {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return undefined;
  const padding = prune({
    top: await dim(node.paddingTop ?? 0, scalarBound(node, 'paddingTop'), ctx),
    right: await dim(node.paddingRight ?? 0, scalarBound(node, 'paddingRight'), ctx),
    bottom: await dim(node.paddingBottom ?? 0, scalarBound(node, 'paddingBottom'), ctx),
    left: await dim(node.paddingLeft ?? 0, scalarBound(node, 'paddingLeft'), ctx),
  });
  const bothHug = node.layoutSizingHorizontal === 'HUG' && node.layoutSizingVertical === 'HUG';
  // Under SPACE_BETWEEN itemSpacing is Figma's auto-computed leftover — meaningless.
  const gap = node.primaryAxisAlignItems === 'SPACE_BETWEEN'
    ? undefined
    : await dim(node.itemSpacing ?? 0, scalarBound(node, 'itemSpacing'), ctx);
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

// --- typography -------------------------------------------------------------

async function styleNameOf(id: unknown): Promise<string | undefined> {
  if (typeof id !== 'string' || !id) return undefined;
  try {
    const s = await figma.getStyleByIdAsync(id);
    return s?.name ?? undefined;
  } catch {
    return undefined;
  }
}

/** Build a font definition from a styled segment or a TextStyle (same fields). */
function buildFont(src: any): Record<string, unknown> {
  const lh = src.lineHeight;
  const ls = typeof src.letterSpacing === 'object' ? src.letterSpacing.value : src.letterSpacing;
  return prune({
    family: src.fontName?.family,
    style: src.fontName?.style && src.fontName.style !== 'Regular' ? src.fontName.style : undefined,
    size: src.fontSize,
    lineHeight: !lh || lh.unit === 'AUTO' ? undefined : lh.value,
    letterSpacing: ls ? Math.round(ls * 1000) / 1000 : undefined,
    decoration: src.textDecoration && src.textDecoration !== 'NONE' ? src.textDecoration : undefined,
  });
}

async function compactText(node: TextNode, ctx: Ctx): Promise<Record<string, unknown>> {
  const styleId = (node as any).textStyleId;
  const styleName = await styleNameOf(styleId);
  if (styleName && typeof styleId === 'string') ctx.textStyles.add(styleId);

  const segs = node.getStyledTextSegments([
    'fontName', 'fontSize', 'fills', 'textStyleId',
    'textDecoration', 'letterSpacing', 'lineHeight', 'boundVariables',
  ] as any);

  const align = (node.textAlignHorizontal !== 'LEFT' || node.textAlignVertical !== 'TOP')
    ? prune({
        horizontal: node.textAlignHorizontal !== 'LEFT' ? node.textAlignHorizontal : undefined,
        vertical: node.textAlignVertical !== 'TOP' ? node.textAlignVertical : undefined,
      })
    : undefined;

  const segColor = (s: any) =>
    colorOf(Array.isArray(s.fills) ? s.fills[0] : undefined, isAlias(s.boundVariables?.fills?.[0]) ? s.boundVariables.fills[0] : undefined, ctx);

  // In component-library mode, when this text is bound to a component TEXT
  // property, emit a `{{prop}}` placeholder in the definition and record the prop.
  let characters: string = node.characters;
  if (options.componentLibrary && ctx.propSink) {
    const ref = (node as any).componentPropertyReferences?.characters;
    if (typeof ref === 'string') {
      const pn = cleanProp(ref);
      ctx.propSink.add(pn);
      characters = `{{${pn}}}`;
    }
  }

  const base: Record<string, unknown> = { characters, textStyle: styleName, align };
  if (segs.length <= 1) {
    const s = segs[0];
    if (s) {
      base.color = await segColor(s);
      if (!styleName) base.font = buildFont(s); // inline only when no shared style
    }
  } else {
    base.segments = await Promise.all(
      segs.map(async (s: any) => prune({ characters: s.characters, font: buildFont(s), color: await segColor(s) })),
    );
  }
  return prune(base);
}

/** Resolve referenced text style ids to a name -> font-definition catalog. */
async function buildTextStyles(ids: Set<string>): Promise<Record<string, unknown> | undefined> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    try {
      const st = await figma.getStyleByIdAsync(id);
      if (st && st.type === 'TEXT') out[st.name] = buildFont(st as TextStyle);
    } catch {
      // ignore unreadable style
    }
  }
  return Object.keys(out).length ? out : undefined;
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

// --- component-library mode -------------------------------------------------

/** A Figma property key ("Title#12:3") -> a stable snake_case prop name. */
function cleanProp(key: string): string {
  return key.split('#')[0].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'prop';
}

/** A "container" component has composed content (text or nested instances) and
 *  is worth a definition; bare icon/vector components stay as compact atoms. */
function isContainerComponent(main: any): boolean {
  let found = false;
  const walk = (n: any): void => {
    for (const c of n.children ?? []) {
      if (found) return;
      if (c.type === 'TEXT' || c.type === 'INSTANCE') {
        found = true;
        return;
      }
      walk(c);
    }
  };
  walk(main);
  return found;
}

/** Instance overrides exposed as component properties (TEXT/BOOLEAN) -> props.
 *  Variants are handled separately; instance-swaps surface as child use-refs. */
function instanceProps(node: InstanceNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(node.componentProperties ?? {})) {
    const t = (p as any).type;
    if (t === 'TEXT' || t === 'BOOLEAN') out[cleanProp(key)] = (p as any).value;
  }
  return out;
}

/** Serialize a main component once into `ctx.components[name]` (cycle-guarded). */
async function ensureComponentDef(name: string, main: ComponentNode, depth: number, ctx: Ctx): Promise<void> {
  if (ctx.components[name] || ctx.building.has(name)) return;
  ctx.building.add(name);
  const prevSink = ctx.propSink;
  const sink = new Set<string>();
  ctx.propSink = sink;
  const node = (await serializeNode(main as unknown as SceneNode, depth, ctx)) as Record<string, unknown>;
  ctx.propSink = prevSink;
  ctx.building.delete(name);
  const def: Component = { node: node as any };
  if (sink.size) def.props = [...sink];
  ctx.components[name] = def;
}

async function componentName(node: InstanceNode): Promise<string> {
  const main = await node.getMainComponentAsync();
  if (main?.parent?.type === 'COMPONENT_SET') return main.parent.name;
  return main?.name ?? node.name;
}

/** Scan an instance's subtree for the content worth keeping when we don't
 *  expand it: nested component (icon) names and visible text. */
async function scanOverrides(node: SceneNode): Promise<Record<string, unknown>> {
  const instances: InstanceNode[] = [];
  const texts: string[] = [];
  // Sync walk to collect work, then resolve main components in parallel — the
  // sequential await-per-instance version could blow codegen's 3s timeout on
  // instance-heavy subtrees.
  function walk(n: any): void {
    for (const c of n.children ?? []) {
      if (c.visible === false) continue;
      if (c.type === 'INSTANCE') {
        instances.push(c);
        walk(c);
      } else if (c.type === 'TEXT') {
        if (c.characters?.trim()) texts.push(c.characters);
      } else {
        walk(c);
      }
    }
  }
  walk(node);
  const components = await Promise.all(instances.map(componentName));
  const uniq = [...new Set(components)];
  return prune({
    icon: uniq.length === 1 ? uniq[0] : undefined,
    components: uniq.length > 1 ? uniq : undefined,
    text: texts.length ? texts.join(' ') : undefined,
  });
}

// --- node walk --------------------------------------------------------------

async function serializeNode(node: SceneNode, depth: number, ctx: Ctx): Promise<unknown> {
  const n = node as any;
  const out: Record<string, unknown> = {};
  if (!options.dropIds) out.id = node.id;
  out.name = node.name;
  out.type = node.type;

  if (node.type === 'INSTANCE') {
    const name = await componentName(node);

    // Component-library mode: container components become `{ use, props }`
    // references resolving into the `components` definitions; leaf/icon
    // instances stay atoms (below).
    if (options.componentLibrary) {
      const main = await node.getMainComponentAsync();
      if (main && 'children' in main && isContainerComponent(main)) {
        await ensureComponentDef(name, main as ComponentNode, depth, ctx);
        const props = instanceProps(node);
        return prune({ use: name, variants: variantsOf(node), props: Object.keys(props).length ? props : undefined });
      }
    }

    // Instance as an atom: identity + captured overrides, no internals.
    if (options.componentLibrary || !options.expandInstances) {
      out.component = name;
      out.variants = variantsOf(node);
      Object.assign(out, await scanOverrides(node));
      const fixed = n.layoutSizingHorizontal === 'FIXED' || !('layoutMode' in n) || n.layoutMode === 'NONE';
      if (fixed && 'width' in n) out.size = { width: Math.round(n.width), height: Math.round(n.height) };
      return prune(out);
    }
    // Expand instances: full internals, with identity retained.
    out.component = name;
    out.variants = variantsOf(node);
  }

  if (node.type === 'TEXT') {
    Object.assign(out, await compactText(node, ctx));
  } else {
    if ('layoutMode' in n) out.layout = await compactLayout(n, ctx);
    out.constraints = compactConstraints(n);
    if ('fills' in n) {
      const f = await serializePaints(n, 'fills', ctx);
      if (f.one !== undefined) out.fill = f.one;
      else if (f.many) out.fills = f.many;
    }
    if ('strokes' in n && n.strokes?.length) {
      const s = await serializePaints(n, 'strokes', ctx);
      if (s.one !== undefined) out.stroke = s.one;
      else if (s.many) out.strokes = s.many;
      out.strokeWeight = typeof n.strokeWeight === 'number' && n.strokeWeight ? n.strokeWeight : undefined;
    }
    if ('cornerRadius' in n) out.cornerRadius = await compactRadius(n, ctx);
    if ('effects' in n) out.effects = compactEffects(n);
    if ('opacity' in n && n.opacity !== 1) out.opacity = n.opacity;
    const hasChildren = 'children' in node && node.children.length > 0;
    if (!hasChildren && 'width' in n) out.size = { width: Math.round(n.width), height: Math.round(n.height) };
  }

  if ('children' in node && node.children.length && depth < 50) {
    const kids: unknown[] = [];
    for (const child of node.children) {
      if ('visible' in child && child.visible === false) continue;
      kids.push(await safeSerialize(child, depth + 1, ctx));
    }
    if (kids.length) out.children = kids;
  }
  return prune(out);
}

/** One throwing node degrades to a stub, never sinks the whole export. */
async function safeSerialize(node: SceneNode, depth: number, ctx: Ctx): Promise<unknown> {
  try {
    return await serializeNode(node, depth, ctx);
  } catch (e) {
    return { name: node.name, type: node.type, error: String(e) };
  }
}

// --- entry ------------------------------------------------------------------

/** Serialize a set of root nodes into the output JSON document (pretty string).
 *  `lean` (Dev Mode codegen) skips the full local-variable enumeration to stay
 *  within codegen's 3s timeout. */
async function buildDocument(sel: readonly SceneNode[], lean = false): Promise<string> {
  const ctx: Ctx = {
    vars: new Set(),
    textStyles: new Set(),
    components: {},
    building: new Set(),
    propSink: null,
  };
  let nodes: unknown[] = [];
  for (const node of sel) nodes.push(await safeSerialize(node, 0, ctx));

  let components: Record<string, unknown> | undefined;
  if (options.componentLibrary) {
    // Definitions are built inline during serialization (instances are emitted
    // as `{ use, props }`), so just surface what was collected.
    if (Object.keys(ctx.components).length) components = ctx.components as Record<string, unknown>;
  } else if (options.dedupe) {
    const synth = synthesizeComponents(nodes as any[]);
    nodes = synth.nodes;
    if (Object.keys(synth.components).length) components = synth.components;
  }

  // The catalogs are best-effort: if variable/style reads fail (e.g. limited
  // access in Dev Mode), still emit the node tree rather than nothing.
  let colors: FlatCatalog['colors'];
  let dimensions: FlatCatalog['dimensions'];
  let textStyles: Record<string, unknown> | undefined;
  try {
    const catalog = await buildCatalog(ctx.vars, !lean);
    const flat = buildFlatCatalog(catalog, ctx.vars, options.modes);
    colors = flat.colors;
    dimensions = flat.dimensions;
    textStyles = await buildTextStyles(ctx.textStyles);
  } catch {
    // catalog unavailable — node tree (with inline hex/fonts) still emits
  }

  const doc = prune({ components, nodes, colors, textStyles, dimensions });
  return JSON.stringify(doc, null, 2);
}

let runSeq = 0;

/** Editor (Figma/FigJam) flow: serialize the live selection and post to the UI. */
async function run(forceCatalogRefresh = false): Promise<void> {
  const seq = ++runSeq;
  if (forceCatalogRefresh) localCatalogCache = null;
  const sel = figma.currentPage.selection;
  const json = await buildDocument(sel);
  if (seq !== runSeq) return; // a newer run superseded this one — drop stale result
  figma.ui.postMessage({ type: 'result', json, empty: sel.length === 0 });
}

/** Map the manifest-declared codegen preferences onto our Options. */
function optionsFromCodegen(): Options {
  const s = figma.codegen.preferences.customSettings;
  const on = (key: string, dflt: boolean) => (s[key] === undefined ? dflt : s[key] === 'on');
  const modes = s.modes as ModeOption;
  return {
    expandInstances: on('expandInstances', false),
    modes: modes === 'all' || modes === 'default' || modes === 'lightDark' ? modes : 'lightDark',
    dropIds: on('dropIds', true),
    dedupe: on('dedupe', true),
    componentLibrary: on('componentLibrary', false),
  };
}

if (figma.mode === 'codegen') {
  // Dev Mode: emit the JSON into the Inspect panel's code section. Runs for
  // viewers (no edit access needed), unlike the editor plugin flow.
  figma.codegen.on('generate', async (event) => {
    // Version in the title makes the live build identifiable; the try/catch turns
    // a thrown error into visible text instead of a blank panel. (A 3s-timeout
    // failure still renders blank — Figma kills the promise before we return.)
    const title = `Design to Code JSON (v${__VERSION__})`;
    try {
      options = optionsFromCodegen();
      const code = await buildDocument([event.node], true); // lean: stay within 3s
      return [{ title, code, language: 'JSON' }];
    } catch (e) {
      return [{ title: `${title} — error`, code: String((e as any)?.stack ?? e), language: 'JSON' }];
    }
  });
} else {
  // Figma/FigJam editor (or Dev Mode run-as-plugin): interactive UI panel.
  figma.showUI(__html__, { width: 480, height: 620, title: 'Design to Code JSON' });
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
}
