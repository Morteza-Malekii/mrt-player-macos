import { useEffect, useRef, useState } from 'react';
import { type Detail, type Download, type Item, type Platform } from '../core/models';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { bytes, retryText } from './format';
// Which catalogue item a file belongs to; the Mac reports the same key for each download it holds.
const sourceOf = (row: Item) => `${row.kind}:${row.id}`;
type Phase = 'idle' | 'starting' | 'queued' | 'active' | 'waiting' | 'done' | 'failed';
// The progress shown right under the button that started the transfer, so the viewer sees it begin
// without leaving the screen. `starting` covers the moment between the click and the first report.
function Status({ name, phase, row, onRetry }: { name: string; phase: Phase; row?: Download; onRetry(): void }) {
  if (phase === 'idle') return null;
  const percent = phase === 'done' ? 100 : row && row.total > 0 ? Math.min(100, row.received / row.total * 100) : 0;
  const unknown = phase === 'starting' || (phase === 'active' && !(row && row.total > 0));
  const text = phase === 'starting' ? 'İndirme başlatılıyor…'
    : phase === 'queued' ? 'Sırada: önceki indirme bitince başlayacak.'
    : phase === 'active' ? (row && row.total > 0 ? `%${Math.floor(percent)} · ${bytes(row.received)} / ${bytes(row.total)}` : `İndiriliyor… ${row ? bytes(row.received) : ''}`) + (row && row.speed > 0 ? ` · ${(row.speed / 1e6).toFixed(1)} MB/sn` : '')
    : phase === 'waiting' ? `Bağlantı kesildi. ${row?.retry ? retryText(row.retry) : 'Yeniden denenecek.'}`
    : phase === 'done' ? `İndirme tamamlandı · ${bytes(row?.total || 0)}. İndirilenler bölümünden oynatabilirsiniz.`
    : row?.error || 'İndirme tamamlanamadı.';
  return <div className="inline-download" role="group" aria-label={`${name} indirme durumu`}>
    {phase !== 'failed' && <div className={`download-bar ${unknown ? 'unknown' : ''}`} role="progressbar" aria-label={`${name} indirme ilerlemesi`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={unknown ? undefined : Math.round(percent)}><span style={unknown ? undefined : { width: `${percent}%` }} /></div>}
    <small role={phase === 'failed' ? 'alert' : 'status'} className={phase === 'failed' ? 'inline-download-error' : undefined}>{text}</small>
    {(phase === 'failed' || phase === 'waiting') && <button className="link-button" onClick={onRetry}>{phase === 'waiting' ? 'Şimdi dene' : 'Tekrar dene'}</button>}
  </div>;
}
export function Details({ item, platform, onClose, onPlay, onPlayOffline }: { item: Item; platform: Platform; onClose(): void; onPlay(item: Item): void; onPlayOffline(row: Download): void }) {
  const [detail, setDetail] = useState<Detail>(), [error, setError] = useState(''), [season, setSeason] = useState<number>(), [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setError(''); setDetail(undefined); platform.call<Detail>('detail', { kind: item.kind, id: item.id }).then(d => { if (active) { setDetail(d); setSeason(d.episodes[0]?.season); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [item, retry]);
  // Saving to disk is a Mac feature: it needs the Mac's file system and a place to write to.
  const mac = platform.type === 'mac', [saveError, setSaveError] = useState('');
  // `starting`: clicked, not yet acknowledged. `started`: item key -> download id. `rows`: latest report per id.
  const [starting, setStarting] = useState<Set<string>>(new Set()), [started, setStarted] = useState<Record<string, string>>({}), [rows, setRows] = useState<Record<string, Download>>({});
  // Size of each file in bytes, 0 when the server does not say. Asked one at a time and only for what
  // is on screen, so a season of episodes never opens many connections at once.
  const [sizes, setSizes] = useState<Record<string, number>>({}), sizesRef = useRef<Record<string, number>>({});
  const fileOf = (row: Item): Item => row.kind === 'vod' ? { ...row, extension: detail?.extension || row.extension } : row;
  useEffect(() => {
    if (!mac || !detail) return;
    let alive = true;
    const targets = item.kind === 'vod' ? [fileOf(item)] : detail.episodes.filter(e => e.season === season).slice(0, 40);
    (async () => {
      for (const row of targets) {
        const key = sourceOf(row);
        if (!alive) return;
        if (key in sizesRef.current) continue;
        let size = 0;
        try { size = await platform.call<number>('downloadSize', { kind: row.kind, id: row.id, extension: row.extension }); } catch { /* unknown size: the button just has no number */ }
        if (!alive) return;
        sizesRef.current = { ...sizesRef.current, [key]: size }; setSizes(sizesRef.current);
      }
    })();
    return () => { alive = false; };
  }, [detail, season]);
  // Anything already saved (or still coming) for this film or season shows as such from the start.
  useEffect(() => {
    if (!mac) return;
    let alive = true;
    platform.call<Download[]>('downloads').then(list => {
      if (!alive) return;
      const have = list.filter(d => d.source);
      setStarted(previous => ({ ...Object.fromEntries(have.map(d => [d.source!, d.id])), ...previous }));
      setRows(previous => ({ ...Object.fromEntries(have.map(d => [d.id, d])), ...previous }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const ids = Object.values(started), busy = ids.some(id => !rows[id] || rows[id].state === 'queued' || rows[id].state === 'active' || rows[id].state === 'waiting');
  useEffect(() => {
    if (!busy) return;
    let alive = true;
    const tick = () => platform.call<Download[]>('downloads').then(list => { if (alive) setRows(Object.fromEntries(list.map(d => [d.id, d]))); }).catch(() => {});
    tick(); const timer = setInterval(tick, 500);
    return () => { alive = false; clearInterval(timer); };
  }, [busy, started]);
  function download(row: Item, name: string) {
    const key = sourceOf(row);
    setSaveError(''); setStarting(previous => new Set(previous).add(key));
    platform.call<Download>('download', { kind: row.kind, id: row.id, extension: row.extension, name })
      .then(d => { setStarted(previous => ({ ...previous, [key]: d.id })); setRows(previous => ({ ...previous, [d.id]: d })); })
      .catch(e => setSaveError(e.message))
      .finally(() => setStarting(previous => { const next = new Set(previous); next.delete(key); return next; }));
  }
  function again(row: Item) {
    const id = started[sourceOf(row)]; if (!id) return;
    setSaveError(''); setRows(previous => ({ ...previous, [id]: { ...previous[id], state: 'queued', error: undefined } }));
    platform.call('retryDownload', { id }).catch(e => setSaveError(e.message));
  }
  function phase(row: Item): Phase {
    const key = sourceOf(row), id = started[key];
    if (!id) return starting.has(key) ? 'starting' : 'idle';
    const state = rows[id]?.state;
    return !state ? 'starting' : state === 'canceled' ? 'failed' : state;
  }
  const rowOf = (row: Item): Download | undefined => rows[started[sourceOf(row)]];
  const sizeText = (row: Item) => sizes[sourceOf(row)] > 0 ? bytes(sizes[sourceOf(row)]) : '';
  const seasons = detail ? Array.from(new Set(detail.episodes.map(e => e.season))) : [];
  return <Modal title={item.kind === 'series' ? 'DİZİ AYRINTILARI' : 'FİLM AYRINTILARI'} onClose={onClose}><div className="detail-hero"><div className="detail-monogram">{item.name.slice(0, 1)}</div><div><span className="pill">{item.kind === 'series' ? 'Dizi' : 'Film'}</span><h2>{detail?.title || item.name}</h2>{detail && <p className="muted">{[detail.year, detail.genre, detail.duration, detail.rating && `★ ${detail.rating}`].filter(Boolean).join(' · ')}</p>}</div></div>
    {!detail && !error && <div role="status" className="empty"><div className="spinner" />Ayrıntılar yükleniyor…</div>}
    {error && <div className="error" role="alert">{error}<button onClick={() => setRetry(v => v + 1)}>Tekrar dene</button></div>}
    {detail && <><p className="plot">{detail.plot || 'Bu içerik için açıklama sunulmamış.'}</p>{detail.director && <p className="credits"><strong>Yönetmen</strong> {detail.director}</p>}{detail.cast && <p className="credits"><strong>Oyuncular</strong> {detail.cast}</p>}
      {saveError && <div className="error" role="alert">{saveError}</div>}
      {item.kind === 'vod' ? <><div className="button-row detail-actions"><button className="primary" onClick={() => onPlay(fileOf(item))}><Icon name="play" /> Filmi oynat</button>{mac && (() => {
        const file = fileOf(item), state = phase(file), size = sizeText(file);
        return state === 'idle' ? <button onClick={() => download(file, detail.title || item.name)}><Icon name="download" /> İndir{size && ` (${size})`}</button>
          : state === 'failed' ? <button onClick={() => again(file)}><Icon name="refresh" /> Tekrar dene</button>
          : state === 'done' && rowOf(file) ? <button onClick={() => onPlayOffline(rowOf(file)!)}><Icon name="play" /> Çevrimdışı oynat</button>
          : <button disabled><Icon name="download" /> İndiriliyor…</button>;
      })()}</div>{mac && <Status name={detail.title || item.name} phase={phase(fileOf(item))} row={rowOf(fileOf(item))} onRetry={() => again(fileOf(item))} />}</> : <section className="episodes"><div className="section-title"><h3>Bölümler</h3>{seasons.length > 0 && <select aria-label="Sezon" value={season} onChange={e => setSeason(Number(e.target.value))}>{seasons.map(s => <option key={s} value={s}>{s}. sezon</option>)}</select>}</div>{detail.episodes.length === 0 && <div className="empty">Bu dizi için bölüm bulunamadı.</div>}{detail.episodes.filter(e => e.season === season).map(e => {
        const state = phase(e), size = sizeText(e), label = `${detail.title || item.name} S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')} ${e.name}`;
        return <div key={e.id}><div className="episode-row"><button className="episode" onClick={() => onPlay({ ...e, categoryId: item.categoryId })}><span className="episode-number">{String(e.episode).padStart(2, '0')}</span><span><strong>{e.name}</strong><small>{e.duration || `${e.season}. sezon`}</small></span><Icon name="play" /></button>{mac && (state === 'done' && rowOf(e) ? <button className="episode-download" aria-label={`${e.name} bölümünü çevrimdışı oynat`} onClick={() => onPlayOffline(rowOf(e)!)}><Icon name="play" /><span>Çevrimdışı</span></button> : <button className="episode-download" aria-label={state === 'failed' ? `${e.name} bölümünü tekrar indir` : `${e.name} bölümünü indir${size ? ` (${size})` : ''}`} disabled={state !== 'idle' && state !== 'failed'} onClick={() => state === 'failed' ? again(e) : download(e, label)}><Icon name={state === 'failed' ? 'refresh' : 'download'} />{state === 'idle' && size && <span>{size}</span>}</button>)}</div>{mac && <Status name={e.name} phase={state} row={rowOf(e)} onRetry={() => again(e)} />}</div>;
      })}</section>}
    </>}
  </Modal>;
}
