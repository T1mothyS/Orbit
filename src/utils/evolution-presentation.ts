import type { EvolutionData, EvolutionNode, EvolutionSnapshot } from '../types/project-evolution';
import { architectureChanges } from '../types/project-evolution';

/** Presentation references only: all labels, facts and relations stay in historical snapshots. */
export function storySnapshots(data: EvolutionData): EvolutionSnapshot[] {
  const ids = new Set(['foundation', 'productivity', 'reports', 'retrieval', data.snapshots.at(-1)?.id]);
  return data.snapshots.filter(snapshot => ids.has(snapshot.id));
}
export function evolutionSequence(data: EvolutionData, mode: 'story' | 'history') {
  return mode === 'history' ? data.milestones : storySnapshots(data).map(snapshot => data.milestones.find(item => item.id === snapshot.milestone)!);
}
export function relationChange(counts: Record<'added' | 'changed' | 'removed' | 'unchanged', number>) {
  return counts.added ? 'added' : counts.changed ? 'changed' : counts.removed ? 'removed' : 'unchanged';
}
export const compactNode = { width: 164, height: 62, gap: 14, groupGap: 30 };
/** Display-only lanes: historical coordinates, order, node IDs and relations remain untouched. */
export function compactArchitecture<T extends EvolutionNode>(nodes: T[], availableWidth: number) {
  const ids = ['client', 'server', 'data', 'external'] as const;
  const lanes = ids.map(id => ({ id, nodes: nodes.filter(node => node.group === id), columns: 1 }));
  const budget = Math.max(6, Math.floor((availableWidth / .9 - 48 - compactNode.groupGap * 3 + compactNode.gap * 4) / (compactNode.width + compactNode.gap)));
  for (let count = 4; count < budget; count++) {
    const lane = [...lanes].sort((a, b) => Math.ceil(b.nodes.length / b.columns) - Math.ceil(a.nodes.length / a.columns))[0];
    if (lane.columns >= lane.nodes.length) break;
    lane.columns++;
  }
  let left = 24;
  const projected: T[] = [], labels: Array<{ id: typeof ids[number]; left: number; width: number }> = [];
  for (const lane of lanes) {
    const width = lane.columns * (compactNode.width + compactNode.gap) - compactNode.gap;
    labels.push({ id: lane.id, left, width });
    lane.nodes.forEach((node, index) => projected.push({ ...node, x: left + index % lane.columns * (compactNode.width + compactNode.gap), y: 48 + Math.floor(index / lane.columns) * (compactNode.height + compactNode.gap) }));
    left += width + compactNode.groupGap;
  }
  return { nodes: projected, labels, width: left - compactNode.groupGap + 24, height: Math.max(160, ...projected.map(node => node.y + compactNode.height + 24)) };
}
export type OverviewBounds = { x: number; y: number; left: number; right: number; top: number; bottom: number };
/** Separate the two diagonal routes so counts and change colors remain readable. */
export function overviewRelationPath(first: OverviewBounds, second: OverviewBounds) {
  const [a, b] = first.y <= second.y ? [first, second] : [second, first];
  if (Math.abs(a.y - b.y) < 5) {
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    return { path: `M${left.right},${left.y} H${right.left}`, x: (left.right + right.left) / 2, y: left.y - 10 };
  }
  if (Math.abs(a.x - b.x) < 5) return { path: `M${a.x},${a.bottom} V${b.top}`, x: a.x + 14, y: (a.bottom + b.top) / 2 + 5 };
  const forward = a.x < b.x, start = forward ? a.right - 24 : a.left + 24, end = forward ? b.left + 24 : b.right - 24;
  const lane = (a.bottom + b.top) / 2 + (forward ? -7 : 7);
  return { path: `M${start},${a.bottom} V${lane} H${end} V${b.top}`, x: (start + end) / 2 + (forward ? -28 : 28), y: lane + 5 };
}
export function architectureFocus(diff: ReturnType<typeof architectureChanges>, selected?: string) {
  const edges = diff.edges.filter(edge => edge.source === selected || edge.target === selected);
  return { edges, nodes: new Set([selected, ...edges.flatMap(edge => [edge.source, edge.target])].filter((id): id is string => !!id)) };
}
export function architectureGroups(diff: ReturnType<typeof architectureChanges>, selected?: string) {
  const focus = architectureFocus(diff, selected);
  const groups = ['client', 'server', 'data', 'external'] as const;
  const nodes = new Map(diff.nodes.map(node => [node.id, node]));
  const relations = new Map<string, { id: string; source: typeof groups[number]; target: typeof groups[number]; count: number; focused: number; changes: Record<'added' | 'changed' | 'removed' | 'unchanged', number> }>();
  for (const edge of diff.edges) {
    const source = nodes.get(edge.source)?.group, target = nodes.get(edge.target)?.group;
    if (!source || !target) continue;
    const id = [source, target].sort().join(':'), relation = relations.get(id) ?? { id, source, target, count: 0, focused: 0, changes: { added: 0, changed: 0, removed: 0, unchanged: 0 } };
    relation.count++; relation.changes[edge.change as keyof typeof relation.changes]++; if (focus.edges.some(item => item.id === edge.id)) relation.focused++;
    relations.set(id, relation);
  }
  return { groups: groups.map(id => ({ id, nodes: diff.nodes.filter(node => node.group === id), related: !selected || diff.nodes.some(node => node.group === id && focus.nodes.has(node.id)) })), relations: [...relations.values()] };
}
