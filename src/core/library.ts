import { DEFAULT_LIBRARY, type Item, type Library, itemKey } from './models';
import { object, text } from './errors';
export function cleanItem(input: unknown): Item | null {
  const v = object(input);
  if (!/^\d{1,20}$/.test(text(v.id)) || !['live', 'vod', 'series'].includes(v.kind)) return null;
  // Persist only metadata. No provider URLs (they may contain credentials).
  return { id: text(v.id), kind: v.kind, name: text(v.name, 250), categoryId: text(v.categoryId, 50), extension: /^[a-z0-9]{1,6}$/.test(v.extension) ? v.extension : undefined, isEpisode: v.isEpisode === true };
}
export function normalizeLibrary(input: unknown): Library {
  const v = object(input), p = object(v.preferences);
  const favorites = (Array.isArray(v.favorites) ? v.favorites : []).map(cleanItem).filter((x): x is Item => !!x).slice(0, 2000);
  const seen = new Set<string>();
  return {
    favorites: favorites.filter(x => { const key = itemKey(x); if (seen.has(key)) return false; seen.add(key); return true; }),
    recent: (Array.isArray(v.recent) ? v.recent : []).map(row => ({ item: cleanItem(object(row).item), at: Number(object(row).at) || 0, position: Math.max(0, Number(object(row).position) || 0) })).filter(row => row.item).slice(0, 50) as Library['recent'],
    preferences: { volume: typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : DEFAULT_LIBRARY.preferences.volume, muted: p.muted === true, resume: p.resume !== false }
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
