import type { EvolutionData, EvolutionSnapshot } from '../types/project-evolution';
import { architectureChanges } from '../types/project-evolution';

/** Presentation references only: all labels, facts and relations stay in historical snapshots. */
export function storySnapshots(data: EvolutionData): EvolutionSnapshot[] {
  const ids = new Set(['foundation', 'productivity', 'reports', 'retrieval', data.snapshots.at(-1)?.id]);
  return data.snapshots.filter(snapshot => ids.has(snapshot.id));
}
export function architectureFocus(diff: ReturnType<typeof architectureChanges>, selected?: string) {
  const edges = diff.edges.filter(edge => edge.source === selected || edge.target === selected);
  return { edges, nodes: new Set([selected, ...edges.flatMap(edge => [edge.source, edge.target])].filter((id): id is string => !!id)) };
}
export function architectureGroups(diff: ReturnType<typeof architectureChanges>, selected?: string) {
  const focus = architectureFocus(diff, selected);
  const groups = ['client', 'server', 'data', 'external'] as const;
  const nodes = new Map(diff.nodes.map(node => [node.id, node]));
  const relations = new Map<string, { id: string; source: typeof groups[number]; target: typeof groups[number]; count: number; focused: number }>();
  for (const edge of diff.edges) {
    const source = nodes.get(edge.source)?.group, target = nodes.get(edge.target)?.group;
    if (!source || !target) continue;
    const id = `${source}:${target}`, relation = relations.get(id) ?? { id, source, target, count: 0, focused: 0 };
    relation.count++; if (focus.edges.some(item => item.id === edge.id)) relation.focused++;
    relations.set(id, relation);
  }
  return { groups: groups.map(id => ({ id, nodes: diff.nodes.filter(node => node.group === id), related: !selected || diff.nodes.some(node => node.group === id && focus.nodes.has(node.id)) })), relations: [...relations.values()] };
}
