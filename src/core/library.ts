import { DEFAULT_LIBRARY, type Item, type Library, type Locks, type Order, type PinRecord, itemKey } from './models';
import { MAX_SAVED_CATEGORIES, MAX_SAVED_ITEMS } from './order';
import { object, text } from './errors';
export function cleanItem(input: unknown): Item | null {
  const v = object(input);
  if (!/^\d{1,20}$/.test(text(v.id)) || !['live', 'vod', 'series'].includes(v.kind)) return null;
  // Persist only metadata. No provider URLs (they may contain credentials).
  return { id: text(v.id), kind: v.kind, name: text(v.name, 250), categoryId: text(v.categoryId, 50), extension: /^[a-z0-9]{1,6}$/.test(v.extension) ? v.extension : undefined, isEpisode: v.isEpisode === true };
}
// Exactly what makePin writes: 16 random bytes and a 32 byte hash, both base64.
const cleanPin = (input: unknown): PinRecord | undefined => { const r = object(input); return typeof r.salt === 'string' && typeof r.hash === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(r.salt) && /^[A-Za-z0-9+/]{43}=$/.test(r.hash) ? { salt: r.salt, hash: r.hash } : undefined; };
// A lock with no PIN could never be opened again, so locks only exist alongside a PIN.
function cleanLocks(input: unknown): Locks {
  const l = object(input), pin = cleanPin(l.pin);
  const categories = pin && Array.isArray(l.categories) ? Array.from(new Set(l.categories.filter((k): k is string => typeof k === 'string' && /^(live|vod|series):\d{1,20}$/.test(k)))).slice(0, 500) : [];
  return pin ? { pin, categories } : { categories };
}
const categoryKeys = (input: unknown): string[] => Array.isArray(input) ? Array.from(new Set(input.filter((k): k is string => typeof k === 'string' && /^(live|vod|series):\d{1,20}$/.test(k)))).slice(0, 2000) : [];
const idList = (input: unknown, max: number): string[] => Array.isArray(input) ? Array.from(new Set(input.filter((x): x is string => typeof x === 'string' && /^\d{1,20}$/.test(x)))).slice(0, max) : [];
function cleanOrder(input: unknown): Order {
  const o = object(input), categories: Order['categories'] = {}, items: Order['items'] = {};
  for (const kind of ['live', 'vod', 'series'] as const) { const ids = idList(object(o.categories)[kind], MAX_SAVED_CATEGORIES); if (ids.length) categories[kind] = ids; }
  for (const [key, list] of Object.entries(object(o.items)).filter(([key]) => /^(live|vod|series):\d{1,20}$/.test(key)).slice(0, 300)) { const ids = idList(list, MAX_SAVED_ITEMS); if (ids.length) items[key] = ids; }
  return { categories, items };
}
export function normalizeLibrary(input: unknown): Library {
  const v = object(input), p = object(v.preferences);
  const hidden = categoryKeys(v.hidden), locks = cleanLocks(v.locks);
  const favorites = (Array.isArray(v.favorites) ? v.favorites : []).map(cleanItem).filter((x): x is Item => !!x).slice(0, 2000);
  const seen = new Set<string>();
  return {
    favorites: favorites.filter(x => { const key = itemKey(x); if (seen.has(key)) return false; seen.add(key); return true; }),
    recent: (Array.isArray(v.recent) ? v.recent : []).map(row => ({ item: cleanItem(object(row).item), at: Number(object(row).at) || 0, position: Math.max(0, Number(object(row).position) || 0) })).filter(row => row.item).slice(0, 50) as Library['recent'],
    preferences: { volume: typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : DEFAULT_LIBRARY.preferences.volume, muted: p.muted === true, resume: p.resume !== false, posters: p.posters === true, autoRetry: p.autoRetry === true, ...(typeof p.audio === 'string' && /^[a-z]{2,3}$/.test(p.audio) ? { audio: p.audio } : {}) },
    locks: { ...locks, categories: locks.categories.filter(key => !hidden.includes(key)) },
    hidden,
    order: cleanOrder(v.order)
  };
}
export function toggleFavorite(library: Library, item: Item): Library {
  const exists = library.favorites.some(x => itemKey(x) === itemKey(item));
  return normalizeLibrary({ ...library, favorites: exists ? library.favorites.filter(x => itemKey(x) !== itemKey(item)) : [item, ...library.favorites] });
}
export function remember(library: Library, item: Item, position = 0): Library {
  return normalizeLibrary({ ...library, recent: [{ item, at: Date.now(), position }, ...library.recent.filter(x => itemKey(x.item) !== itemKey(item))] });
}
export const matches = (name: string, query: string) => name.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR'));
