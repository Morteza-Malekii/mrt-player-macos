import { useEffect, useState } from 'react';
import type { Item, Platform, Programme } from '../core/models';
import { Icon } from './Icon';
export function Guide({ platform, item }: { platform: Platform; item: Item }) {
  const [rows, setRows] = useState<Programme[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0), [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setRows([]);
    const fetchGuide = () => platform.call<Programme[]>('epg', { id: item.id }).then(value => { if (active) { setRows(value); setError(''); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    void fetchGuide(); const t = setInterval(fetchGuide, 300000); return () => { active = false; clearInterval(t); };
  }, [item.id, reload]);
  const upcoming = rows.filter(row => row.end > now);
  const clock = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return <section className="guide"><div className="section-title"><h2>Program rehberi</h2><button className="icon-button" aria-label="Program rehberini yenile" onClick={() => setReload(v => v + 1)}><Icon name="refresh" size={16} /></button></div>{loading ? <p role="status" className="muted">Programlar yükleniyor…</p> : error ? <p role="alert" className="muted">{error}</p> : upcoming.length === 0 ? <p className="muted">Bu kanal için program bilgisi sunulmamış.</p> : <div className="programmes" tabIndex={0} aria-label="Program listesi">{upcoming.map(row => <article key={`${row.id}-${row.start}`} className={`programme ${row.start <= now ? 'current' : ''}`}><div className="programme-time">{clock(row.start)}<small>{clock(row.end)}</small></div><div><span className="eyebrow">{row.start <= now ? 'ŞİMDİ' : new Date(row.start).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span><h3>{row.title}</h3>{row.description && <p>{row.description}</p>}{row.start <= now && <div className="programme-progress"><span style={{ width: `${Math.min(100, (now - row.start) / (row.end - row.start) * 100)}%` }} /></div>}</div></article>)}</div>}</section>;
}
