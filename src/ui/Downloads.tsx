import { useEffect, useState } from 'react';
import type { Action, Download, DownloadState, Platform } from '../core/models';
import { Icon } from './Icon';
import { bytes as size, retryText } from './format';
const labels: Record<DownloadState, string> = { queued: 'Sırada', active: 'İndiriliyor', waiting: 'Yeniden denenecek', done: 'Tamamlandı', failed: 'Başarısız', canceled: 'İptal edildi' };
export function Downloads({ platform, onPlay }: { platform: Platform; onPlay(row: Download): void }) {
  const [rows, setRows] = useState<Download[]>(), [error, setError] = useState('');
  const refresh = () => platform.call<Download[]>('downloads').then(value => { setRows(value); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { let alive = true; const tick = () => { if (alive) void refresh(); }; tick(); const timer = setInterval(tick, 1000); return () => { alive = false; clearInterval(timer); }; }, []);
  const act = (action: Action, id: string) => platform.call(action, { id }).then(refresh).catch(e => setError(e.message));
  if (!rows) return <div className="empty" role="status">{error ? <div className="error" role="alert">{error}</div> : <><div className="spinner" />Yükleniyor…</>}</div>;
  // Finished recordings are kept in this list too, but are shown (and managed) under Kayıtlar.
  const shown = rows.filter(row => !row.source?.startsWith('rec:'));
  return <section className="downloads" aria-label="İndirilenler">
    {error && <div className="error" role="alert">{error}</div>}
    {shown.length === 0 ? <div className="empty"><Icon name="download" size={36} /><h3>Henüz indirme yok</h3><p>Bir filmin veya dizi bölümünün ayrıntılarındaki İndir düğmesini kullanın. Dosyalar İndirilenler klasöründeki MRT-Player klasörüne kaydedilir; tamamlananlar uygulama kapanınca da listede kalır ve buradan oynatılabilir.</p></div> : shown.map(row => {
      const percent = row.total > 0 ? Math.min(100, row.received / row.total * 100) : 0;
      return <div className="download-row" key={row.id}>
        <div className="download-head"><strong title={row.name}>{row.name}</strong><span className="pill">{labels[row.state]}</span></div>
        {(row.state === 'active' || row.state === 'queued' || row.state === 'waiting' || row.state === 'failed') && <div className={`download-bar ${row.state === 'active' && !row.total ? 'unknown' : ''}`} role="progressbar" aria-label={row.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div>}
        <small>{row.state === 'done' ? size(row.total) : row.received > 0 ? `${size(row.received)}${row.total ? ` / ${size(row.total)}` : ''}${row.state === 'active' && row.speed > 0 ? ` · ${(row.speed / 1e6).toFixed(1)} MB/sn` : ''}` : ''}</small>
        {row.error && <div className="error" role="alert">{row.error}</div>}
        {row.state === 'waiting' && row.retry && <small role="status">{retryText(row.retry)}</small>}
        <div className="button-row">
          {row.state === 'waiting' && <button className="primary" onClick={() => void act('retryDownload', row.id)}>Şimdi dene</button>}
          {(row.state === 'active' || row.state === 'queued' || row.state === 'waiting') && <button onClick={() => void act('cancelDownload', row.id)}>İptal</button>}
          {(row.state === 'failed' || row.state === 'canceled') && <button onClick={() => void act('retryDownload', row.id)}>Tekrar dene</button>}
          {row.state === 'done' && <><button className="primary" onClick={() => onPlay(row)}><Icon name="play" /> Oynat</button><button onClick={() => void act('revealDownload', row.id)}>Finder’da göster</button><button className="danger-button" onClick={() => void act('trashDownload', row.id)}>Çöpe taşı</button></>}
          {row.state !== 'active' && row.state !== 'queued' && row.state !== 'waiting' && <button title={row.state === 'done' ? 'Dosya diskte kalır' : undefined} onClick={() => void act('removeDownload', row.id)}>Listeden kaldır</button>}
        </div>
      </div>;
    })}
  </section>;
}
