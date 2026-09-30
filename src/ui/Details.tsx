import { useEffect, useState } from 'react';
import type { Detail, Item, Platform } from '../core/models';
import { Modal } from './Modal';
import { Icon } from './Icon';
export function Details({ item, platform, onClose, onPlay }: { item: Item; platform: Platform; onClose(): void; onPlay(item: Item): void }) {
  const [detail, setDetail] = useState<Detail>(), [error, setError] = useState(''), [season, setSeason] = useState<number>(), [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setError(''); setDetail(undefined); platform.call<Detail>('detail', { kind: item.kind, id: item.id }).then(d => { if (active) { setDetail(d); setSeason(d.episodes[0]?.season); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [item, retry]);
  const seasons = detail ? Array.from(new Set(detail.episodes.map(e => e.season))) : [];
  return <Modal title={item.kind === 'series' ? 'DİZİ AYRINTILARI' : 'FİLM AYRINTILARI'} onClose={onClose}><div className="detail-hero"><div className="detail-monogram">{item.name.slice(0, 1)}</div><div><span className="pill">{item.kind === 'series' ? 'Dizi' : 'Film'}</span><h2>{detail?.title || item.name}</h2>{detail && <p className="muted">{[detail.year, detail.genre, detail.duration, detail.rating && `★ ${detail.rating}`].filter(Boolean).join(' · ')}</p>}</div></div>
    {!detail && !error && <div role="status" className="empty"><div className="spinner" />Ayrıntılar yükleniyor…</div>}
    {error && <div className="error" role="alert">{error}<button onClick={() => setRetry(v => v + 1)}>Tekrar dene</button></div>}
    {detail && <><p className="plot">{detail.plot || 'Bu içerik için açıklama sunulmamış.'}</p>{detail.director && <p className="credits"><strong>Yönetmen</strong> {detail.director}</p>}{detail.cast && <p className="credits"><strong>Oyuncular</strong> {detail.cast}</p>}
      {item.kind === 'vod' ? <button className="primary" onClick={() => onPlay({ ...item, extension: detail.extension || item.extension })}><Icon name="play" /> Filmi oynat</button> : <section className="episodes"><div className="section-title"><h3>Bölümler</h3>{seasons.length > 0 && <select aria-label="Sezon" value={season} onChange={e => setSeason(Number(e.target.value))}>{seasons.map(s => <option key={s} value={s}>{s}. sezon</option>)}</select>}</div>{detail.episodes.length === 0 && <div className="empty">Bu dizi için bölüm bulunamadı.</div>}{detail.episodes.filter(e => e.season === season).map(e => <button className="episode" key={e.id} onClick={() => onPlay({ ...e, categoryId: item.categoryId })}><span className="episode-number">{String(e.episode).padStart(2, '0')}</span><span><strong>{e.name}</strong><small>{e.duration || `${e.season}. sezon`}</small></span><Icon name="play" /></button>)}</section>}
    </>}
  </Modal>;
}
