// Pure post-process: deduplicate repeated subtrees into reusable components.
//
// Two container subtrees are "the same component" when their *structure* matches
// (type, layout, textStyle role, child shape, and which value-fields are
// present) regardless of the concrete values. For each such group, any
// value-field that *differs* across occurrences becomes a prop (slot); fields
// that are identical everywhere are baked into the template. Each usage is
// rewritten to `{ use, props }`. Operates on the serialized node JSON, so it is
// Figma-API-free and unit-testable.

type Node = Record<string, any>;

/** Value fields that may vary between occurrences (i.e. become props). */
const SLOT_FIELDS = [
  'characters', 'color', 'fill', 'fills', 'stroke', 'strokes',
  'image', 'icon', 'components', 'text', 'size', 'variants', 'opacity',
];

const MIN_DESCENDANTS = 2; // don't componentize trivially small containers

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Stable JSON for comparison: object keys sorted recursively, so a mere
 *  key-order difference between occurrences doesn't read as a value difference
 *  (Figma emits prop objects in variant-dependent key order). */
function canon(x: unknown): string {
  const norm = (v: any): any => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(norm(x));
}

function snake(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

function pascal(s: string | undefined): string {
  const parts = (s ?? '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') || 'Component';
}

/** Normalised name: drop a trailing index so "List item 01/02/03" collapse. */
function normName(name?: string): string {
  return (name ?? '').toLowerCase().replace(/[\s_-]*\d+$/, '').replace(/[\s_-]+/g, ' ').trim();
}

/** Structural signature — excludes the concrete values of SLOT_FIELDS but keeps
 *  which of them are present, so structure matches while values may vary.
 *  `ignoreName` drops the node name from the key so structurally-identical
 *  siblings with distinct labels (e.g. day cells `Senin`/`Selasa`/…) still
 *  group; the variant-split path in code.ts relies on the name-sensitive
 *  default, so this stays opt-in. */
export function signature(node: Node, opts?: { ignoreName?: boolean }): string {
  const sig = {
    type: node.type,
    name: opts?.ignoreName ? '' : normName(node.name),
    layout: node.layout,
    constraints: node.constraints,
    cornerRadius: node.cornerRadius,
    effects: node.effects,
    strokeWeight: node.strokeWeight,
    textStyle: node.textStyle,
    align: node.align,
    component: node.component,
    has: SLOT_FIELDS.filter((f) => node[f] !== undefined).sort(),
    children: (node.children ?? []).map((c: Node) => signature(c, opts)),
  };
  return JSON.stringify(sig);
}

function descendantCount(n: Node): number {
  return (n.children ?? []).reduce((a: number, c: Node) => a + 1 + descendantCount(c), 0);
}

function countContainers(nodes: Node[], counts: Map<string, number>, opts?: { ignoreName?: boolean }): void {
  for (const n of nodes) {
    if (n.children?.length) {
      const s = signature(n, opts);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    if (n.children) countContainers(n.children, counts, opts);
  }
}

interface Slot { path: number[]; field: string; propName: string; }

/** A use-ref's per-instance identity fields. When they vary across occurrences
 *  they become props named `<component>_<field>` (the field's *literal* name, so
 *  `variants` and `variant` stay distinct), with object values served whole. */
const USE_FIELDS = ['variants', 'props', 'variant', 'size'];

function dedupeName(base: string, used: Set<string>): string {
  let final = base;
  let k = 2;
  while (used.has(final)) final = `${base}_${k++}`;
  used.add(final);
  return final;
}

function makePropName(ancestors: string[], leaf: string | undefined, field: string, used: Set<string>): string {
  const suffix = field; // prop suffix is the field's literal name (no aliasing)
  const leafSnake = snake(leaf);
  let base = leafSnake === suffix ? suffix : `${leafSnake}_${suffix}`;
  const anc = [...ancestors].reverse();
  let i = 0;
  while (used.has(base) && i < anc.length) {
    base = `${snake(anc[i])}_${base}`;
    i++;
  }
  return dedupeName(base, used);
}

/** Diff a group of structurally-identical occurrences: build a template with
 *  `{{prop}}` placeholders for fields that vary, listing the slots. */
function diffSlots(group: Node[]): { template: Node; slots: Slot[] } {
  const template = clone(group[0]);
  const slots: Slot[] = [];
  const used = new Set<string>();

  function recur(occ: Node[], tmpl: Node, path: number[], namePath: string[]): void {
    // Use-ref child: each identity field that varies becomes a whole-field prop
    // named after the component. Use-refs have no name/children, so skip the
    // normal SLOT_FIELDS pass for them.
    if (typeof tmpl.use === 'string') {
      for (const field of USE_FIELDS) {
        if (tmpl[field] === undefined) continue;
        const values = occ.map((n) => canon(n[field]));
        if (!values.every((v) => v === values[0])) {
          const propName = dedupeName(`${snake(tmpl.use)}_${field}`, used);
          slots.push({ path: [...path], field, propName });
          tmpl[field] = `{{${propName}}}`;
        }
      }
      return;
    }
    for (const field of SLOT_FIELDS) {
      if (tmpl[field] === undefined) continue;
      const values = occ.map((n) => canon(n[field]));
      if (!values.every((v) => v === values[0])) {
        const propName = makePropName(namePath, tmpl.name, field, used);
        slots.push({ path: [...path], field, propName });
        tmpl[field] = `{{${propName}}}`;
      }
    }
    const kids: Node[] = tmpl.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      recur(occ.map((n) => n.children[i]), kids[i], [...path, i], [...namePath, tmpl.name]);
    }
  }

  recur(group, template, [], []);
  return { template, slots };
}

function extractProps(inst: Node, slots: Slot[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of slots) {
    let node = inst;
    for (const i of s.path) node = node.children[i];
    out[s.propName] = node[s.field];
  }
  return out;
}

export interface Component {
  props?: string[];
  node?: Node;
  variants?: Record<string, Component>;
  /** Variant-table mode: per axis, per value, the styling fields that differ from base. */
  variantStyles?: Record<string, Record<string, Record<string, unknown>>>;
}

/** Same node *shape* — type + child arity, recursively — ignoring all styling
 *  values and names. Unlike `signature` (which bakes layout/cornerRadius/etc.
 *  into the key), this is true iff two trees differ only in values, so it's the
 *  right gate for "this variant is a value change, not a structural one". */
export function sameShape(a: Node, b: Node): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  const ac: Node[] = a.children ?? [];
  const bc: Node[] = b.children ?? [];
  if (ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) if (!sameShape(ac[i], bc[i])) return false;
  return true;
}

// Fields that are structure/identity, not styling — never part of a value delta.
const NON_VALUE_FIELDS = new Set([
  'name', 'type', 'children', 'component', 'use', 'variant', 'variants', 'props', '__sig',
]);

/**
 * Diff two **structurally-identical** serialized trees (a component set's base
 * variant vs. one variant) into a flat map of changed styling fields keyed by a
 * readable node path, e.g. `{ "Content > State-layer: fill": "#E0E0E0" }`. The
 * caller must ensure the trees share a `signature` (children align by index).
 */
export function valueDelta(base: Node, variant: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (b: Node, v: Node, path: string): void => {
    if (!b || !v) return;
    for (const key of new Set([...Object.keys(b), ...Object.keys(v)])) {
      if (NON_VALUE_FIELDS.has(key)) continue;
      if (JSON.stringify(b[key]) !== JSON.stringify(v[key])) {
        out[path ? `${path}: ${key}` : key] = v[key];
      }
    }
    const bc: Node[] = b.children ?? [];
    const vc: Node[] = v.children ?? [];
    for (let i = 0; i < Math.min(bc.length, vc.length); i++) {
      const childName = vc[i]?.name ?? bc[i]?.name ?? `[${i}]`;
      walk(bc[i], vc[i], path ? `${path} > ${childName}` : childName);
    }
  };
  walk(base, variant, '');
  return out;
}

// --- Figma component variants (built by code.ts, finalized here) -------------

/** One structurally-distinct variant of a component set actually used in the
 *  selection. `repCombo` is the variant string of its first occurrence. */
export interface VariantStruct { sig: string; repCombo: string; node: Node; props?: string[]; }

/**
 * Fold collected variant structures into `components` and resolve the temporary
 * `__sig` markers on use-refs. A set with one structure stays flat
 * (`{ node, props }`, no `variant` on its use-refs); a set with several nests
 * (`{ variants: { repCombo: { node, props } } }`) and each use-ref gains a
 * `variant: repCombo` pointer. Pure: mutates `components` and the trees in place.
 */
export function finalizeVariants(
  roots: Node[],
  components: Record<string, Component>,
  structures: Map<string, VariantStruct[]>,
): void {
  // `${set}\n${sig}` -> repCombo (multi-structure) or null (single -> no pointer)
  const pointer = new Map<string, string | null>();
  for (const [setName, structs] of structures) {
    if (structs.length === 1) {
      const s = structs[0];
      components[setName] = s.props ? { node: s.node, props: s.props } : { node: s.node };
      pointer.set(`${setName}\n${s.sig}`, null);
    } else {
      const variants: Record<string, Component> = {};
      for (const s of structs) {
        // Distinct structures can share a combo (e.g. a boolean-driven layout);
        // disambiguate so one never silently overwrites another.
        let key = s.repCombo;
        for (let k = 2; key in variants; k++) key = `${s.repCombo} #${k}`;
        variants[key] = s.props ? { node: s.node, props: s.props } : { node: s.node };
        pointer.set(`${setName}\n${s.sig}`, key);
      }
      components[setName] = { variants };
    }
  }

  const rewrite = (node: Node): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.use === 'string' && node.__sig !== undefined) {
      const ptr = pointer.get(`${node.use}\n${node.__sig}`);
      if (ptr) node.variant = ptr;
      delete node.__sig;
    }
    if (Array.isArray(node.children)) node.children.forEach(rewrite);
  };
  roots.forEach(rewrite);
  for (const def of Object.values(components)) {
    if (def.node) rewrite(def.node);
    if (def.variants) for (const v of Object.values(def.variants)) if (v.node) rewrite(v.node);
  }
}

/** Extract repeated container subtrees into `components`, rewriting each usage
 *  to `{ use, props }`. Returns the rewritten tree + the component library.
 *  `defBodies` are existing component-def node trees (from code.ts): repeated
 *  frames *inside* them are extracted too, but the bodies themselves are never
 *  candidates (descend-only) and are rewritten in place. `reservedNames` seeds
 *  the name pool so a generated name never collides with an existing def (which
 *  would be silently dropped on merge). */
export function synthesizeComponents(
  roots: Node[],
  defBodies: Node[] = [],
  reservedNames: Iterable<string> = [],
): { nodes: Node[]; components: Record<string, Component> } {
  // Name-insensitive matching: structurally-identical siblings with distinct
  // labels (e.g. day cells) group, while values that differ become props.
  const sigOpts = { ignoreName: true };
  const counts = new Map<string, number>();
  countContainers(roots, counts, sigOpts);
  countContainers(defBodies, counts, sigOpts);

  // Gather top-level extraction occurrences per signature (stop descending once
  // a node is marked, so nested same-signature nodes aren't double-extracted).
  const occ = new Map<string, Node[]>();
  function collect(nodes: Node[]): void {
    for (const n of nodes) {
      if (n.children?.length) {
        const s = signature(n, sigOpts);
        if ((counts.get(s) ?? 0) >= 2 && descendantCount(n) >= MIN_DESCENDANTS) {
          (occ.get(s) ?? occ.set(s, []).get(s)!).push(n);
          continue; // extracted — don't descend into its internals
        }
      }
      if (n.children) collect(n.children);
    }
  }
  collect(roots);
  // Descend-only into def bodies: a def body is never extracted as a whole
  // (that would replace a component with a use-ref to a dedupe component).
  for (const d of defBodies) if (d.children) collect(d.children);

  const components: Record<string, Component> = {};
  const replacement = new Map<Node, Node>();
  const usedNames = new Set<string>(reservedNames);

  for (const group of occ.values()) {
    if (group.length < 2) continue;
    let name = pascal(normName(group[0].name));
    let n = 2;
    while (usedNames.has(name)) name = `${pascal(normName(group[0].name))}${n++}`;
    usedNames.add(name);

    const { template, slots } = diffSlots(group);
    const def: Component = { node: template };
    if (slots.length) def.props = slots.map((s) => s.propName);
    components[name] = def;

    for (const inst of group) {
      const use: Node = { use: name };
      if (slots.length) use.props = extractProps(inst, slots);
      replacement.set(inst, use);
    }
  }

  function rewrite(nodes: Node[]): Node[] {
    return nodes.map((n) => {
      const rep = replacement.get(n);
      if (rep) return rep;
      if (n.children) n.children = rewrite(n.children);
      return n;
    });
  }

  const out = rewrite(roots);
  // Def bodies are rewritten in place (callers hold the same node reference in
  // their components map), and never replaced since they're descend-only above.
  for (const d of defBodies) if (d.children) d.children = rewrite(d.children);
  return { nodes: out, components };
}
