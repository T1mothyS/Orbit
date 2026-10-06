/** Draft cards show existing targets, rather than everything read as AI context. */
export function scheduleItemsForPlan<T extends { id: string }>(
  items: readonly T[],
  operations: readonly { type: string; scheduleId?: string }[] = [],
): T[] {
  const targets = new Set(operations.filter(op => op.type === 'update' || op.type === 'delete').map(op => op.scheduleId));
  return items.filter(item => targets.has(item.id));
}
