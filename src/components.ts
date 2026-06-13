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

const FIELD_SUFFIX: Record<string, string> = {
  characters: 'text', color: 'color', fill: 'fill', fills: 'fills',
  stroke: 'stroke', strokes: 'strokes', image: 'image', icon: 'icon',
  components: 'components', text: 'text', size: 'size', variants: 'variant', opacity: 'opacity',
};

const MIN_DESCENDANTS = 2; // don't componentize trivially small containers

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

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
 *  which of them are present, so structure matches while values may vary. */
function signature(node: Node): string {
  const sig = {
    type: node.type,
    name: normName(node.name),
    layout: node.layout,
    constraints: node.constraints,
    cornerRadius: node.cornerRadius,
    effects: node.effects,
    strokeWeight: node.strokeWeight,
    textStyle: node.textStyle,
    align: node.align,
    component: node.component,
    has: SLOT_FIELDS.filter((f) => node[f] !== undefined).sort(),
    children: (node.children ?? []).map(signature),
  };
  return JSON.stringify(sig);
}

function descendantCount(n: Node): number {
  return (n.children ?? []).reduce((a: number, c: Node) => a + 1 + descendantCount(c), 0);
}

function countContainers(nodes: Node[], counts: Map<string, number>): void {
  for (const n of nodes) {
    if (n.children?.length) {
      const s = signature(n);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    if (n.children) countContainers(n.children, counts);
  }
}

interface Slot { path: number[]; field: string; propName: string; }

function makePropName(ancestors: string[], leaf: string | undefined, field: string, used: Set<string>): string {
  const suffix = FIELD_SUFFIX[field] ?? field;
  const leafSnake = snake(leaf);
  let base = leafSnake === suffix ? suffix : `${leafSnake}_${suffix}`;
  const anc = [...ancestors].reverse();
  let i = 0;
  while (used.has(base) && i < anc.length) {
    base = `${snake(anc[i])}_${base}`;
    i++;
  }
  let final = base;
  let k = 2;
  while (used.has(final)) final = `${base}_${k++}`;
  used.add(final);
  return final;
}

/** Diff a group of structurally-identical occurrences: build a template with
 *  `{{prop}}` placeholders for fields that vary, listing the slots. */
function diffSlots(group: Node[]): { template: Node; slots: Slot[] } {
  const template = clone(group[0]);
  const slots: Slot[] = [];
  const used = new Set<string>();

  function recur(occ: Node[], tmpl: Node, path: number[], namePath: string[]): void {
    for (const field of SLOT_FIELDS) {
      if (tmpl[field] === undefined) continue;
      const values = occ.map((n) => JSON.stringify(n[field]));
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

export interface Component { props?: string[]; node: Node; }

/** Extract repeated container subtrees into `components`, rewriting each usage
 *  to `{ use, props }`. Returns the rewritten tree + the component library. */
export function synthesizeComponents(
  roots: Node[],
): { nodes: Node[]; components: Record<string, Component> } {
  const counts = new Map<string, number>();
  countContainers(roots, counts);

  // Gather top-level extraction occurrences per signature (stop descending once
  // a node is marked, so nested same-signature nodes aren't double-extracted).
  const occ = new Map<string, Node[]>();
  function collect(nodes: Node[]): void {
    for (const n of nodes) {
      if (n.children?.length) {
        const s = signature(n);
        if ((counts.get(s) ?? 0) >= 2 && descendantCount(n) >= MIN_DESCENDANTS) {
          (occ.get(s) ?? occ.set(s, []).get(s)!).push(n);
          continue; // extracted — don't descend into its internals
        }
      }
      if (n.children) collect(n.children);
    }
  }
  collect(roots);

  const components: Record<string, Component> = {};
  const replacement = new Map<Node, Node>();
  const usedNames = new Set<string>();

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

  return { nodes: rewrite(roots), components };
}
