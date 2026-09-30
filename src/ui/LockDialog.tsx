import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PinRecord } from '../core/models';
import { checkPin, makePin, validPin } from '../core/lock';
import { Modal } from './Modal';
// What the dialog is asked to do. `verify` checks a PIN, `create` sets a new one, `change`
// checks the old one and then sets a new one. `done` runs only after the PIN step succeeded.
export interface LockRequest { mode: 'verify' | 'create' | 'change'; title: string; heading: string; text: string; action: string; done(record?: PinRecord): void }
// Wrong guesses are counted for the whole window, not per dialog, so closing and reopening
// the dialog does not reset the count.
const guard = { fails: 0, until: 0 };
const MAX_FAILS = 5, PAUSE_MS = 30000;
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 8);
export function LockDialog({ request, record, onClose }: { request: LockRequest; record?: PinRecord; onClose(): void }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [again, setAgain] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  // The modal focuses its own close button after mount; take the focus back for the PIN field.
  useEffect(() => { const timer = setTimeout(() => first.current?.focus(), 0); return () => clearTimeout(timer); }, []);
  const asksOld = request.mode !== 'create', asksNew = request.mode !== 'verify';
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setError('');
    const wait = Math.ceil((guard.until - Date.now()) / 1000);
    if (wait > 0) { setError(`Çok fazla hatalı deneme. ${wait} saniye sonra tekrar deneyin.`); return; }
    if (asksNew && !validPin(next)) { setError('PIN 4 ile 8 rakamdan oluşmalı.'); return; }
    if (asksNew && next !== again) { setError('PIN’ler aynı değil.'); return; }
    setBusy(true);
    try {
      if (asksOld) {
        if (!record || !(await checkPin(current, record))) {
          if (++guard.fails >= MAX_FAILS) { guard.fails = 0; guard.until = Date.now() + PAUSE_MS; setError(`Çok fazla hatalı deneme. ${PAUSE_MS / 1000} saniye bekleyin.`); }
          else setError('PIN yanlış.');
          setCurrent(''); first.current?.focus(); return;
        }
        guard.fails = 0;
      }
      request.done(asksNew ? await makePin(next) : undefined);
    } catch { setError('PIN işlenemedi. Yeniden deneyin.'); }
    finally { setBusy(false); }
  }
  return <Modal title={request.title} onClose={onClose}>
    <form onSubmit={submit} className="lock-form">
      <h2>{request.heading}</h2><p className="muted">{request.text}</p>
      {asksOld && <label>{request.mode === 'change' ? 'Mevcut PIN' : 'PIN'}<input ref={first} type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={current} onChange={e => setCurrent(digits(e.target.value))} /></label>}
      {asksNew && <label>{request.mode === 'change' ? 'Yeni PIN' : 'PIN'}<input ref={asksOld ? undefined : first} type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={next} onChange={e => setNext(digits(e.target.value))} /></label>}
      {asksNew && <label>PIN’i tekrarlayın<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={again} onChange={e => setAgain(digits(e.target.value))} /></label>}
      {error && <div role="alert" className="error">{error}</div>}
      <div className="button-row"><button type="button" onClick={onClose}>Vazgeç</button><button type="submit" className="primary" disabled={busy}>{request.action}</button></div>
    </form>
  </Modal>;
}
