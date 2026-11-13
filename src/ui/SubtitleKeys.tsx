import { useEffect, useState } from 'react';
import type { Platform, SubtitleKeys, SubtitleKeyValues } from '../core/models';
// Where the viewer enters the two services' keys (Settings). A key is only ever sent to the privileged side and is
// never shown again: this page learns only whether one is saved.
export function SubtitleKeysForm({ platform }: { platform: Platform }) {
  const [status, setStatus] = useState<SubtitleKeys>(), [key, setKey] = useState(''), [user, setUser] = useState(''), [password, setPassword] = useState(''), [subdl, setSubdl] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; platform.call<SubtitleKeys>('subtitleKeys').then(s => { if (alive) setStatus(s); }, () => {}); return () => { alive = false; }; }, []);
  async function save(values: SubtitleKeyValues, done: string) {
    setBusy(true); setError(''); setMessage('');
    try { setStatus(await platform.call<SubtitleKeys>('saveSubtitleKeys', values)); setKey(''); setUser(''); setPassword(''); setSubdl(''); setMessage(done); }
    catch (e) { setError((e as Error).message || 'Kaydedilemedi.'); }
    finally { setBusy(false); }
  }
  const typed = { opensubtitlesKey: key, opensubtitlesUser: user, opensubtitlesPassword: password, subdlKey: subdl };
  const changes = Object.fromEntries(Object.entries(typed).filter(([, v]) => v.trim())) as SubtitleKeyValues;
  return <>
    <label>OpenSubtitles API anahtarı{status?.opensubtitles && <small className="key-saved"> · kayıtlı</small>}<input type="password" autoComplete="off" spellCheck={false} placeholder={status?.opensubtitles ? 'Değiştirmek için yeni anahtarı yazın' : 'Anahtarı yapıştırın'} value={key} onChange={e => setKey(e.target.value)} /></label>
    <label>OpenSubtitles kullanıcı adı (isteğe bağlı){status?.opensubtitlesLogin && <small className="key-saved"> · kayıtlı</small>}<input autoComplete="off" spellCheck={false} value={user} onChange={e => setUser(e.target.value)} /></label>
    <label>OpenSubtitles parolası (isteğe bağlı)<input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></label>
    <label>SubDL API anahtarı{status?.subdl && <small className="key-saved"> · kayıtlı</small>}<input type="password" autoComplete="off" spellCheck={false} placeholder={status?.subdl ? 'Değiştirmek için yeni anahtarı yazın' : 'Anahtarı yapıştırın'} value={subdl} onChange={e => setSubdl(e.target.value)} /></label>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <p className="muted" role="status">{message}</p>}
    <div className="button-row">
      <button className="primary" disabled={busy || !Object.keys(changes).length} onClick={() => void save(changes, 'Kaydedildi.')}>Kaydet</button>
      {status?.opensubtitles && <button disabled={busy} onClick={() => void save({ opensubtitlesKey: '', opensubtitlesUser: '', opensubtitlesPassword: '' }, 'OpenSubtitles bilgileri silindi.')}>OpenSubtitles’i sil</button>}
      {status?.subdl && <button disabled={busy} onClick={() => void save({ subdlKey: '' }, 'SubDL anahtarı silindi.')}>SubDL’i sil</button>}
    </div>
  </>;
}
