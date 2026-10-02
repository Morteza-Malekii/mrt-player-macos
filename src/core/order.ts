// A viewer-arranged order for a list whose contents come from the provider. Only the part the
// viewer actually arranged is kept (`saved`, ids in order); everything else follows it in the
// provider's own order, so a list of five thousand channels does not cost five thousand ids,
// and channels the provider adds later simply appear after the arranged ones.
export type Move = 'up' | 'down' | 'top';
export const MAX_SAVED_ITEMS = 1000, MAX_SAVED_CATEGORIES = 2000;
export function applyOrder<T>(rows: T[], idOf: (row: T) => string, saved: string[] | undefined): T[] {
  if (!saved || saved.length === 0) return rows;
  const byId = new Map(rows.map(row => [idOf(row), row] as const)), listed = new Set(saved);
  return [...saved.filter(id => byId.has(id)).map(id => byId.get(id)!), ...rows.filter(row => !listed.has(idOf(row)))];
}
// The saved order after moving `id` inside `current`, the order the viewer sees right now.
export function moveSaved(saved: string[] | undefined, current: string[], id: string, move: Move, limit = MAX_SAVED_ITEMS): string[] {
  const before = saved ?? [], at = current.indexOf(id);
  if (at < 0) return before;
  if (move === 'top') return at === 0 && before[0] === id ? before : [id, ...before.filter(other => other !== id && current.includes(other))].slice(0, limit);
  const to = move === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= current.length) return before;
  const next = current.slice(); [next[at], next[to]] = [next[to], next[at]];
  // The prefix has to reach the furthest place touched, or the swap could not be told apart from the provider's order.
  return next.slice(0, Math.min(limit, Math.max(Math.max(at, to) + 1, before.length)));
}
// The same three moves on a plain array whose order is itself the data (favourites), where some
// entries may be out of sight: a move swaps with the neighbour the viewer can see.
export function moveInList<T>(list: T[], idOf: (row: T) => string, visible: (row: T) => boolean, id: string, move: Move): T[] {
  const shown = list.map((row, index) => visible(row) ? index : -1).filter(index => index >= 0);
  const at = shown.findIndex(index => idOf(list[index]) === id);
  if (at < 0) return list;
  const next = list.slice();
  if (move === 'top') { if (at === 0) return list; const [row] = next.splice(shown[at], 1); next.splice(shown[0], 0, row); return next; }
  const to = move === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= shown.length) return list;
  [next[shown[at]], next[shown[to]]] = [next[shown[to]], next[shown[at]]];
  return next;
}
