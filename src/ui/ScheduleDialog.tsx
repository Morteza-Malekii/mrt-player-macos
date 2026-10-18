import { useState } from 'react';
import type { Item, Platform, Recording } from '../core/models';
import { Modal } from './Modal';
import { fromLocalInput, toLocalInput } from './format';
export interface ScheduleRequest { item: Item; title?: string; start: number; end: number; padded?: boolean }
// Plans a recording of a channel for a stretch of time. Opened for a programme (its times are filled in,
// widened a little on both sides because broadcasts rarely start and end exactly on time) or by hand.
export function ScheduleDialog({ platform, request, onClose }: { platform: Platform; request: ScheduleRequest; onClose(): void }) {
  const [start, setStart] = useState(toLocalInput(request.start)), [end, setEnd] = useState(toLocalInput(request.end)), [error, setError] = useState(''), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  function submit() {
    const from = fromLocalInput(start), to = fromLocalInput(end);
    if (!Number.isFinite(from) || !Number.isFinite(to)) { setError('Başlangıç ve bitiş zamanını girin.'); return; }
    if (to <= from) { setError('Bitiş zamanı başlangıçtan sonra olmalı.'); return; }
    if (to <= Date.now()) { setError('Bitiş zamanı gelecekte olmalı.'); return; }
    setError(''); setBusy(true);
    platform.call<Recording>('recordSchedule', { id: request.item.id, name: request.item.name, start: from, end: to }).then(() => setDone(true)).catch(e => setError(e.message)).finally(() => setBusy(false));
  }
  return <Modal title="KAYIT PLANLA" onClose={onClose}>
    {done ? <><h2>Kayıt planlandı</h2><p className="muted">{request.item.name}: Kayıtlar bölümünden görebilir veya iptal edebilirsiniz. Kaydın alınabilmesi için uygulama açık ve Mac uyanık olmalıdır.</p><div className="button-row"><button className="primary" onClick={onClose}>Tamam</button></div></>
      : <><h2>{request.item.name}</h2>{request.title && <p className="muted">{request.title}</p>}
        <div className="schedule-fields"><label>Başlangıç<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label>Bitiş<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
        {request.padded && <p className="muted">Yayınlar tam saatinde başlamayıp bitmeyebileceği için başlangıçtan 1 dakika önce, bitişten 3 dakika sonra eklendi. İsterseniz değiştirin.</p>}
        <p className="muted">Kayıt en fazla 12 saat olabilir. Uygulama açık ve Mac uyanık değilse kayıt alınamaz.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="button-row"><button className="primary" disabled={busy} onClick={submit}>Planla</button><button onClick={onClose}>Vazgeç</button></div></>}
  </Modal>;
}
