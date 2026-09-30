import { useEffect, useMemo, useState } from 'react';
import type { Category, Kind, Library, Platform, Visibility } from '../core/models';
import { categoryState } from '../core/lock';
import { matches } from '../core/library';
import { Icon } from './Icon';
const kinds: Array<{ id: Kind; label: string }> = [{ id: 'live', label: 'Canlı TV' }, { id: 'vod', label: 'Filmler' }, { id: 'series', label: 'Diziler' }];
const states: Array<{ id: Visibility; label: string }> = [{ id: 'shown', label: 'Görünür' }, { id: 'locked', label: 'Kilitli' }, { id: 'hidden', label: 'Gizli' }];
// Every category the provider offers, each one shown, locked behind the PIN, or hidden. Whether
// a change needs the PIN is decided by the caller; this only reports what was asked for.
export function CategoryManager({ platform, library, onChange }: { platform: Platform; library: Pick<Library, 'locks' | 'hidden'>; onChange(kind: Kind, category: Category, to: Visibility): void }) {
  const [kind, setKind] = useState<Kind>('live'), [lists, setLists] = useState<Partial<Record<Kind, Category[]>>>({}), [error, setError] = useState(''), [query, setQuery] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (lists[kind]) return; let active = true; setError('');
    platform.call<Category[]>('categories', { kind }).then(value => { if (active) setLists(current => ({ ...current, [kind]: value })); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [kind, retry]);
  const all = lists[kind] || [], rows = useMemo(() => all.filter(c => matches(c.name, query)), [all, query]);
  const count = (state: Visibility) => all.filter(c => categoryState(library, kind, c.id) === state).length;
  return <div className="manager">
    <div className="manager-tabs" role="tablist" aria-label="Liste türü">{kinds.map(k => <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'selected' : ''} onClick={() => { setKind(k.id); setQuery(''); }}>{k.label}</button>)}</div>
    <div className="manager-tools"><div className="category-search"><Icon name="search" size={16} /><input type="search" aria-label="Listelerde ara" placeholder="Liste ara…" value={query} onChange={e => setQuery(e.target.value)} /></div><span className="muted">{count('locked')} kilitli · {count('hidden')} gizli</span></div>
    {!lists[kind] && !error && <div role="status" className="muted">Listeler yükleniyor…</div>}
    {error && <div role="alert" className="error">{error}<button onClick={() => setRetry(v => v + 1)}>Tekrar dene</button></div>}
    <div className="manager-list">{rows.map(c => { const state = categoryState(library, kind, c.id); return <div key={c.id} role="group" aria-label={c.name} className={`manager-row ${state}`}><span className="manager-name">{c.name}</span><span className="segmented">{states.map(s => <button key={s.id} type="button" aria-pressed={state === s.id} onClick={() => onChange(kind, c, s.id)}>{s.label}</button>)}</span></div>; })}</div>
    {lists[kind] && rows.length === 0 && <div className="muted">Eşleşen liste yok.</div>}
  </div>;
}
