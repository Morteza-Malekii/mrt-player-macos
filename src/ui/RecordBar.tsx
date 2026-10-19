import { useEffect, useState } from 'react';
import type { Item, Platform, Recording } from '../core/models';
import { Icon } from './Icon';
import { bytes, clock } from './format';
const lengths: { label: string; minutes: number }[] = [{ label: 'Süre: sınırsız', minutes: 0 }, { label: '15 dakika', minutes: 15 }, { label: '30 dakika', minutes: 30 }, { label: '1 saat', minutes: 60 }, { label: '2 saat', minutes: 120 }, { label: '3 saat', minutes: 180 }, { label: '4 saat', minutes: 240 }];
// Under the player of a live channel: start a recording of it right now (optionally for a set time),
// or plan one. A recording runs on its own connection, so changing channel does not stop it.
export function RecordBar({ platform, item, onSchedule }: { platform: Platform; item: Item; onSchedule(): void }) {
  const [rows, setRows] = useState<Recording[]>([]), [minutes, setMinutes] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now());
  const refresh = () => platform.call<Recording[]>('recordings').then(setRows).catch(() => {});
  useEffect(() => { let alive = true; const tick = () => { if (alive) { void refresh(); setNow(Date.now()); } }; tick(); const timer = setInterval(tick, 1000); return () => { alive = false; clearInterval(timer); }; }, []);
  const mine = rows.find(row => row.state === 'recording' && row.streamId === item.id);
  const begin = () => { setError(''); setBusy(true); platform.call<Recording>('record', { id: item.id, name: item.name, minutes }).then(() => refresh()).catch(e => setError(e.message)).finally(() => setBusy(false)); };
  const stop = () => { if (mine) platform.call('stopRecording', { id: mine.id }).then(() => refresh()).catch(e => setError(e.message)); };
  return <section className="record-bar" aria-label="Kanal kaydı">
    {mine ? <div className="record-live" role="status"><span className="rec-dot" aria-hidden="true" /><strong>Kayıtta</strong><span>{clock(now - (mine.startedAt || now))}</span><span>{bytes(mine.bytes)}</span>{mine.end && <span>Bitiş {new Date(mine.end).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>}<button className="danger-button" onClick={stop}><Icon name="stop" size={16} /> Durdur</button></div>
      : <div className="record-idle"><button className="record-button" disabled={busy} onClick={begin}><Icon name="record" size={18} /> Kaydet</button><select aria-label="Kayıt süresi" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{lengths.map(l => <option key={l.minutes} value={l.minutes}>{l.label}</option>)}</select><button onClick={onSchedule}><Icon name="calendar" size={16} /> Zamanla…</button></div>}
    {error && <div className="error" role="alert">{error}</div>}
    <small className="muted">Kayıt önce .ts olarak alınır, bitince MP4’e dönüştürülür ve Kayıtlar bölümüne eklenir.</small>
  </section>;
}
