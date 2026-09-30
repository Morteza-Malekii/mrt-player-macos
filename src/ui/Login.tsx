import { useEffect, useState, type FormEvent } from 'react';
import type { Account, Platform, Status } from '../core/models';
export function Login({ platform, onLogin }: { platform: Platform; onLogin(account: Account): void }) {
  const [status, setStatus] = useState<Status>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [server, setServer] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false), [passphrase, setPassphrase] = useState(''), [allowHttp, setAllowHttp] = useState(false), [manual, setManual] = useState(false);
  const tv = platform.type === 'tv';
  useEffect(() => { platform.call<Status>('status').then(setStatus).catch(e => setError(e.message)); }, [platform]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const account = status?.saved && !manual ? await platform.call<Account>('unlock', { passphrase }) : await platform.call<Account>('login', { server, username, password, remember, passphrase, allowHttp });
      setPassword(''); setPassphrase(''); onLogin(account);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="login-page"><section className="intro"><div className="brand"><span className="brand-mark">M</span>MRT<span className="brand-light">-Player</span></div><div className="eyebrow">SİZİN EKRANINIZ. SİZİN İÇERİĞİNİZ.</div><h1>İyi seyirler,<br /><span>kendi alanınızda.</span></h1><p>Canlı yayınlarınız, filmleriniz ve dizileriniz.<br />Tek bir yerde, yalnızca sizin hesabınızla.</p><div className="intro-note">Yerel uygulama <span>•</span> Bulut hesabı gerekmez</div></section><section className="login-card"><div className="eyebrow">{tv ? 'LG WEBOS' : 'MACOS'} İÇİN MRT-PLAYER</div><h2>{status?.saved && !manual ? 'Tekrar hoş geldiniz' : 'Hesabınıza bağlanın'}</h2><p className="muted">Uygulama içerik sağlamaz. Kullanım hakkına sahip olduğunuz Xtream hesabını ekleyin.</p><form onSubmit={submit}>
    {status?.saved && !manual ? <><p>Hesabınız bu cihazda şifreli olarak saklanıyor.</p>{status.requiresPassphrase && <label>Kilit parolası<input type="password" autoFocus value={passphrase} autoComplete="off" onChange={e => setPassphrase(e.target.value)} required /></label>}</> : <><label>Sunucu adresi<input type="url" autoFocus placeholder="https://sunucu:port" value={server} onChange={e => setServer(e.target.value)} required autoComplete="off" spellCheck={false} /></label><label>Kullanıcı adı<input value={username} onChange={e => setUsername(e.target.value)} required autoComplete="off" spellCheck={false} /></label><label>Şifre<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="off" /></label><label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Bu cihazda güvenli sakla</label>{tv && remember && <label>Kilit parolası <small>En az 10 karakter. Uygulama açıldığında istenir.</small><input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} minLength={10} required autoComplete="new-password" /></label>}{server.toLowerCase().startsWith('http:') && <label className="check warning"><input type="checkbox" checked={allowHttp} onChange={e => setAllowHttp(e.target.checked)} />HTTP, hesap bilgilerini ağda şifrelemez. Bu bağlantıyı kullan.</label>}</>}
    {error && <div role="alert" className="error">{error}</div>}<button className="primary wide" disabled={busy} type="submit">{busy ? 'Bağlanıyor…' : status?.saved && !manual ? 'Kilidi aç' : 'Bağlan'} <span>→</span></button>
    {status?.saved && <button type="button" className="subtle wide" onClick={() => { setManual(!manual); setError(''); }}>{manual ? 'Kayıtlı hesaba dön' : 'Başka hesapla giriş yap'}</button>}
    {status?.saved && <button type="button" className="subtle wide" onClick={async () => { try { await platform.call('logout', { forget: true }); setStatus({ ...status, saved: false }); setManual(true); } catch (e) { setError((e as Error).message); } }}>Kayıtlı hesabı bu cihazdan sil</button>}
    </form><div className="privacy-note">{tv ? 'Kilit parolanız cihazda saklanmaz.' : 'Kayıtlı bilgiler macOS Anahtar Zinciri ile korunur.'}</div></section></main>;
}
