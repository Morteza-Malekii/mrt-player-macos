import { useEffect, useState } from 'react';
import type { Action, Platform, Recording, RecordingState } from '../core/models';
import { Icon } from './Icon';
import { bytes, clock } from './format';
const labels: Record<RecordingState, string> = { scheduled: 'Planlandı', recording: 'Kayıtta', converting: 'MP4’e dönüştürülüyor', done: 'Tamamlandı', failed: 'Başarısız', missed: 'Kaçırıldı' };
const order: Record<RecordingState, number> = { recording: 0, converting: 1, scheduled: 2, failed: 3, missed: 4, done: 5 };
const hm = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' });
export function Recordings({ platform, onPlay }: { platform: Platform; onPlay(row: { id: string; name: string }): void }) {
  const [rows, setRows] = useState<Recording[]>(), [error, setError] = useState(''), [now, setNow] = useState(Date.now());
  const refresh = () => platform.call<Recording[]>('recordings').then(value => { setRows(value); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { let alive = true; const tick = () => { if (alive) { void refresh(); setNow(Date.now()); } }; tick(); const timer = setInterval(tick, 1000); return () => { alive = false; clearInterval(timer); }; }, []);
  const act = (action: Action, id: string) => platform.call(action, { id }).then(refresh).catch(e => setError(e.message));
  if (!rows) return <div className="empty" role="status">{error ? <div className="error" role="alert">{error}</div> : <><div className="spinner" />Yükleniyor…</>}</div>;
  const sorted = [...rows].sort((a, b) => order[a.state] - order[b.state] || (a.state === 'scheduled' ? (a.start || 0) - (b.start || 0) : b.name.localeCompare(a.name)));
  return <section className="downloads" aria-label="Kayıtlar">
    {error && <div className="error" role="alert">{error}</div>}
    <p className="muted">Planlı kayıtların alınabilmesi için uygulama açık ve Mac uyanık olmalıdır. Canlı bir kanalı izlerken altındaki Kaydet veya Zamanla düğmelerini kullanın.</p>
    {sorted.length === 0 ? <div className="empty"><Icon name="record" size={36} /><h3>Henüz kayıt yok</h3><p>Bir kanalı açıp Kaydet’e basın ya da program rehberinden bir yayını kaydetmek için planlayın. Biten kayıtlar MP4 olarak İndirilenler klasöründeki MRT-Player klasörüne kaydedilir.</p></div> : sorted.map(row => <div className="download-row" key={`${row.state}-${row.id}`}>
      <div className="download-head"><strong title={row.name}>{row.name}</strong><span className="pill">{labels[row.state]}</span></div>
      <small>{row.state === 'scheduled' && row.start && row.end ? `${day(row.start)} · ${hm(row.start)}–${hm(row.end)} · ${row.channel}`
        : row.state === 'recording' ? `${clock(now - (row.startedAt || now))} · ${bytes(row.bytes)}${row.end ? ` · bitiş ${hm(row.end)}` : ''} · ${row.channel}`
        : row.state === 'converting' ? `${bytes(row.bytes)} ham kayıt işleniyor…`
        : row.state === 'done' ? bytes(row.bytes) : row.channel}</small>
      {row.state === 'recording' && <div className="download-bar unknown" role="progressbar" aria-label={`${row.name} kaydı sürüyor`}><span /></div>}
      {row.state === 'converting' && <div className="download-bar unknown" role="progressbar" aria-label={`${row.name} dönüştürülüyor`}><span /></div>}
      {row.error && (row.state === 'failed' || row.state === 'missed' ? <div className="error" role="alert">{row.error}</div> : <small className="muted" role="status">{row.error}</small>)}
      <div className="button-row">
        {row.state === 'recording' && <button className="danger-button" onClick={() => void act('stopRecording', row.id)}><Icon name="stop" size={16} /> Durdur</button>}
        {row.state === 'scheduled' && <button onClick={() => void act('removeRecording', row.id)}>İptal</button>}
        {row.state === 'failed' && row.hasFile && <><button className="primary" onClick={() => void act('retryRecording', row.id)}>Tekrar dene</button><button onClick={() => void act('revealRecording', row.id)}>Ham dosyayı göster</button></>}
        {(row.state === 'failed' || row.state === 'missed') && <button onClick={() => void act('removeRecording', row.id)}>Listeden kaldır</button>}
        {row.state === 'done' && row.fileId && <><button className="primary" onClick={() => onPlay({ id: row.fileId!, name: row.name })}><Icon name="play" /> Oynat</button><button onClick={() => void act('revealDownload', row.fileId!)}>Finder’da göster</button><button className="danger-button" onClick={() => void act('trashDownload', row.fileId!)}>Çöpe taşı</button><button title="Dosya diskte kalır" onClick={() => void act('removeDownload', row.fileId!)}>Listeden kaldır</button></>}
      </div>
    </div>)}
  </section>;
}
