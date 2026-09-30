import { useEffect, useMemo, useRef, useState } from 'react';
import { type Account, type Category, type Item, type Kind, type Library, type Platform, type Playback, type Preferences, type PinRecord, type Visibility, itemKey } from '../core/models';
import { categoryState, isLockedItem, lockKey, withCategoryState } from '../core/lock';
import { matches, normalizeLibrary, remember, toggleFavorite } from '../core/library';
import { Login } from './Login';
import { Player } from './Player';
import { Details } from './Details';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { Guide } from './Guide';
import { Settings } from './Settings';
import { LockDialog, type LockRequest } from './LockDialog';
import { Tile } from './Tile';
type View = Kind | 'favorites' | 'recent' | 'settings';
const names: Record<View, string> = { live: 'Canlı TV', vod: 'Filmler', series: 'Diziler', favorites: 'Favoriler', recent: 'Son izlenenler', settings: 'Ayarlar' };
const kinds = { live: 'Canlı TV', vod: 'Film', series: 'Dizi' };
const views: { id: View; icon: string }[] = [{ id: 'live', icon: 'live' }, { id: 'vod', icon: 'film' }, { id: 'series', icon: 'series' }, { id: 'favorites', icon: 'heart' }, { id: 'recent', icon: 'clock' }];
export function App({ platform }: { platform: Platform }) {
  const [account, setAccount] = useState<Account>();
  return account ? <Workspace key={account.profile} account={account} platform={platform} onLogout={() => setAccount(undefined)} /> : <Login platform={platform} onLogin={setAccount} />;
}
function Workspace({ platform, account, onLogout }: { platform: Platform; account: Account; onLogout(): void }) {
  const [view, setView] = useState<View>('live'), [category, setCategory] = useState<string | null>(null), [query, setQuery] = useState('');
  const [categories, setCategories] = useState<Category[]>([]), [items, setItems] = useState<Item[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0), [limit, setLimit] = useState(60);
  const [library, setLibrary] = useState<Library>(normalizeLibrary({})), [ready, setReady] = useState(false), [storageError, setStorageError] = useState('');
  const [detail, setDetail] = useState<Item>(), [playing, setPlaying] = useState<{ item: Item; playback: Playback; resumeAt: number }>(), [connecting, setConnecting] = useState<Item>(), [playError, setPlayError] = useState(''), [streamStarted, setStreamStarted] = useState(false), [full, setFull] = useState(false), [confirmExit, setConfirmExit] = useState(false);
  const libraryRef = useRef(library), saveTimer = useRef<ReturnType<typeof setTimeout>>(), saveQueue = useRef(Promise.resolve()), lastSaveError = useRef<Error>(), forgetting = useRef(false), playRevision = useRef(0), alive = useRef(true);
  const catalog = view === 'live' || view === 'vod' || view === 'series';
  // Unlocking is for the whole window: one PIN opens every locked list until they are locked
  // again or the app closes. It lives in memory only, so it never survives a restart.
  const [unlocked, setUnlocked] = useState(false), [lockRequest, setLockRequest] = useState<LockRequest>();
  const locks = library.locks, hasLocks = locks.categories.length > 0;
  // Pictures come from the Mac's image gateway; other platforms have none to offer.
  const posters = platform.type === 'mac' && library.preferences.posters, [posterEpoch, setPosterEpoch] = useState(0);
  // Hidden categories are never shown; locked ones only after the PIN.
  const hidden = (item: Item) => library.hidden.includes(lockKey(item.kind, item.categoryId)) || (!unlocked && isLockedItem(locks, item));
  const stateOf = (id: string) => categoryState(library, view as Kind, id);
  const selectedLocked = catalog && !!category && stateOf(category) === 'locked' && !unlocked;
  const [categoryQuery, setCategoryQuery] = useState('');
  function showError(e: Error & { code?: string }) { if (!alive.current) return; if (e.code === 'LOCKED') { setPlaying(undefined); onLogout(); } else setError(e.message); }
  function loadLibrary() { platform.call<Library>('library').then(value => { if (alive.current) { const clean = normalizeLibrary(value); libraryRef.current = clean; setLibrary(clean); setReady(true); setStorageError(''); } }).catch(e => { if (alive.current) setStorageError(e.message); }); }
  useEffect(() => {
    alive.current = true; loadLibrary();
    const timer = setInterval(() => { platform.call('heartbeat').catch(showError); }, 15000);
    return () => { alive.current = false; clearInterval(timer); clearTimeout(saveTimer.current); };
  }, []);
  function queueSave() {
    const snapshot = libraryRef.current;
    saveQueue.current = saveQueue.current.then(() => platform.call('saveLibrary', { library: snapshot })).then(() => { lastSaveError.current = undefined; if (alive.current) setStorageError(''); }).catch((e: Error) => { lastSaveError.current = e; if (alive.current) setStorageError(e.message); });
    return saveQueue.current;
  }
  function update(transform: (current: Library) => Library) {
    if (!ready || forgetting.current) return;
    const next = normalizeLibrary(transform(libraryRef.current)); libraryRef.current = next; setLibrary(next);
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(queueSave, 400);
  }
  async function flush() { if (!ready) return; clearTimeout(saveTimer.current); await queueSave(); if (lastSaveError.current) throw lastSaveError.current; }
  function preference(values: Partial<Preferences>) {
    update(current => ({ ...current, preferences: { ...current.preferences, ...values } }));
    // The app serves pictures only once it has the saved setting, so save at once and then let
    // the pictures that were refused a moment ago ask again.
    if ('posters' in values) void flush().catch(() => {}).then(() => { if (alive.current) setPosterEpoch(v => v + 1); });
  }
  const closeLock = () => setLockRequest(undefined);
  function changeLocks(change: (locks: Library['locks']) => Library['locks']) { update(current => ({ ...current, locks: change(current.locks) })); }
  function askPin(heading: string, text: string, action: string, done: () => void, title = 'KİLİTLİ LİSTE') { setLockRequest({ mode: 'verify', title, heading, text, action, done }); }
  function unlockThen(then?: () => void) { askPin('PIN’i girin', 'Kilitli listeleri açmak için PIN gerekir.', 'Aç', () => { setUnlocked(true); closeLock(); then?.(); }); }
  function createPinThen(then: (pin: NonNullable<Library['locks']['pin']>) => void) { setLockRequest({ mode: 'create', title: 'PIN BELİRLE', heading: 'Liste kilidi için PIN', text: '4 ile 8 rakamdan oluşan bir PIN seçin. Kilitli listeleri açmak için gerekir. Unutursanız yalnızca hesabı cihazdan silerek sıfırlayabilirsiniz.', action: 'Kaydet', done: pin => { if (pin) then(pin); closeLock(); } }); }
  // Locking hides everything at once, and a channel that is playing from a list that has just
  // been locked must not keep playing in front of whoever is watching.
  function relock(extraKey?: string) {
    setUnlocked(false);
    if (playing && (isLockedItem(locks, playing.item) || lockKey(playing.item.kind, playing.item.categoryId) === extraKey)) stop();
  }
  function openCategory(id: string) { setCategory(id); setLimit(60); if (stateOf(id) === 'locked' && !unlocked) unlockThen(); }
  // A category is shown, locked or hidden. Locking and hiding need nothing; making a locked or
  // hidden one visible again needs the PIN (once one exists), or anyone could undo it here.
  function setVisibility(kind: Kind, c: Category, to: Visibility) {
    const from = categoryState(library, kind, c.id), key = lockKey(kind, c.id);
    if (from === to) return;
    const apply = (pin?: PinRecord) => {
      update(current => withCategoryState(current, kind, c.id, to, pin));
      if (to !== 'shown' && playing && lockKey(playing.item.kind, playing.item.categoryId) === key) stop();
      if (to === 'locked') setUnlocked(false);
    };
    if (to === 'locked' && !locks.pin) createPinThen(pin => apply(pin));
    else if (to === 'shown' && locks.pin && !unlocked) askPin('Listeyi göster', `“${c.name}” listesini tekrar göstermek için PIN girin.`, 'Göster', () => { apply(); setUnlocked(true); closeLock(); }, 'LİSTE AYARI');
    else apply();
  }
  function navigate(next: View) { if (next === view) { setReload(v => v + 1); return; } setView(next); setCategory(null); setQuery(''); setCategoryQuery(''); setLimit(60); setLoading(true); setError(''); setCategories([]); setItems([]); }
  useEffect(() => {
    if (!catalog) return; let current = true;
    platform.call<Category[]>('categories', { kind: view }).then(value => { if (current) { setCategories(value); setCategory(previous => previous === null ? value.find(c => !libraryRef.current.hidden.includes(lockKey(view as Kind, c.id)))?.id || '' : previous); } }).catch(e => { if (current) { setLoading(false); showError(e); } });
    return () => { current = false; };
  }, [view, reload]);
  useEffect(() => {
    if (!catalog || category === null) return; let current = true; setLoading(true); setError(''); setItems([]);
    platform.call<Item[]>('items', { kind: view, category }).then(value => { if (current) setItems(value); }).catch(e => { if (current) showError(e); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [view, category, reload]);
  async function play(item: Item) {
    if (hidden(item)) { unlockThen(() => void play(item)); return; }
    setDetail(undefined); setPlayError(''); setPlaying(undefined); setStreamStarted(false); setConnecting(item);
    const version = ++playRevision.current;
    try {
      const playback = await platform.call<Playback>('play', item);
      if (version === playRevision.current && alive.current) setPlaying({ item, playback, resumeAt: libraryRef.current.recent.find(r => itemKey(r.item) === itemKey(item))?.position || 0 });
    } catch (e) { if (version === playRevision.current) setPlayError((e as Error).message); }
    finally { if (version === playRevision.current) setConnecting(undefined); }
  }
  function select(item: Item) { if (item.kind === 'live' || item.isEpisode) void play(item); else setDetail(item); }
  function stop() { ++playRevision.current; setPlaying(undefined); setStreamStarted(false); setConnecting(undefined); setFull(false); setPlayError(''); void platform.call('stop').catch(() => {}); }
  async function logout(forget = false) {
    try {
      if (forget) forgetting.current = true;
      const video = document.querySelector('video'); if (!forget && playing && video) update(current => remember(current, playing.item, playing.item.kind === 'live' ? 0 : video.currentTime));
      forgetting.current = true;
      await flush(); stop(); await platform.call('logout', { forget }); onLogout();
    } catch (e) { forgetting.current = false; setStorageError((e as Error).message); }
  }
  useEffect(() => {
    const back = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.keyCode !== 461) return; e.preventDefault(); e.stopImmediatePropagation();
      if (lockRequest) closeLock(); else if (full) setFull(false); else if (detail) setDetail(undefined); else if (confirmExit) setConfirmExit(false); else if (query) setQuery(''); else if (playing || connecting) stop(); else if (view !== 'live') navigate('live'); else if (category) setCategory(''); else if (platform.type === 'tv') setConfirmExit(true);
    };
    window.addEventListener('keydown', back, true); return () => window.removeEventListener('keydown', back, true);
  }, [full, detail, confirmExit, query, playing, connecting, view, category, lockRequest]);
  useEffect(() => { const hide = () => { if (document.hidden) void flush().catch(() => {}); }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, [ready]);
  const source = useMemo(() => (view === 'favorites' ? library.favorites : view === 'recent' ? library.recent.map(r => r.item) : items).filter(item => !library.hidden.includes(lockKey(item.kind, item.categoryId)) && (unlocked || !isLockedItem(locks, item))), [view, library.favorites, library.recent, items, locks, library.hidden, unlocked]);
  const filtered = useMemo(() => { const needle = query.trim().toLocaleLowerCase('tr-TR'); return needle ? source.filter(item => item.name.toLocaleLowerCase('tr-TR').includes(needle)) : source; }, [source, query]);
  const selectedCategory = categories.find(c => c.id === category)?.name || 'Tüm içerikler';
  const favoriteKeys = useMemo(() => new Set(library.favorites.map(itemKey)), [library.favorites]);
  const visibleFavorites = library.favorites.filter(item => !hidden(item)).length;
  const isFavorite = (item: Item) => favoriteKeys.has(itemKey(item));
  return <div className="workspace">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">M</span>MRT<span className="brand-light">-Player</span></div><div className="nav-label">KEŞFET</div><nav aria-label="Ana menü">{views.map(v => <button key={v.id} className={`nav-item ${view === v.id ? 'selected' : ''}`} aria-current={view === v.id ? 'page' : undefined} onClick={() => navigate(v.id)}><Icon name={v.icon} /><span>{names[v.id]}</span>{v.id === 'favorites' && visibleFavorites > 0 && <span className="nav-count">{visibleFavorites}</span>}</button>)}</nav><div className="sidebar-bottom">{hasLocks && <button className="nav-item" onClick={() => unlocked ? relock() : unlockThen()}><Icon name={unlocked ? 'lock' : 'unlock'} />{unlocked ? 'Listeleri yeniden kilitle' : 'Kilitli listeleri aç'}</button>}<button className={`nav-item ${view === 'settings' ? 'selected' : ''}`} onClick={() => navigate('settings')}><Icon name="settings" />Ayarlar</button><div className="account-note"><span className="status-dot" /><div><strong>Kişisel hesap</strong><small>{account.expires ? `${new Date(account.expires).toLocaleDateString('tr-TR')} tarihine kadar` : 'Hesap bağlı'}</small></div></div><button className="nav-item logout" onClick={() => void logout()}><Icon name="lock" />Oturumu kilitle</button></div></aside>
    <main className="main-area"><header className="topbar"><div><div className="eyebrow">SİZİN KOLEKSİYONUNUZ</div><h1>{names[view]}</h1></div>{view !== 'settings' && <div className="search-field"><Icon name="search" /><input type="search" aria-label="İçerik ara" placeholder={view === 'live' ? 'Kanal ara…' : 'İçerik ara…'} value={query} onChange={e => { setQuery(e.target.value); setLimit(60); }} />{query && <button className="icon-button" aria-label="Aramayı temizle" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}</div>}<div className="local-badge"><span className="status-dot" />Yerel & özel</div></header>
      {storageError && <div className="error storage-error" role="alert">{storageError}<button onClick={() => ready ? void flush().catch(() => {}) : loadLibrary()}>Kaydı yeniden dene</button></div>}
      {view === 'settings' ? <Settings platform={platform} account={account} preferences={library.preferences} locks={locks} hidden={library.hidden} onCategoryState={setVisibility} onPreference={preference} onCreatePin={() => createPinThen(pin => changeLocks(l => ({ ...l, pin })))} onChangePin={() => locks.pin && setLockRequest({ mode: 'change', title: 'PIN DEĞİŞTİR', heading: 'PIN’i değiştir', text: 'Önce mevcut PIN’i, sonra yeni PIN’i girin.', action: 'Değiştir', done: pin => { if (pin) changeLocks(l => ({ ...l, pin })); closeLock(); } })} onRemoveLocks={() => askPin('Tüm kilitler kaldırılsın mı?', 'PIN silinir ve hiçbir liste kilitli kalmaz.', 'Kaldır', () => { changeLocks(() => ({ categories: [] })); setUnlocked(false); closeLock(); }, 'KİLİTLERİ KALDIR')} onClearHistory={() => update(current => ({ ...current, recent: [] }))} onForget={() => void logout(true)} /> : <div className="library-layout">
        {catalog && <aside className="categories" aria-label="Kategoriler"><div className="category-search"><Icon name="search" size={16} /><input type="search" aria-label="Kategori ara" placeholder="Kategori ara…" value={categoryQuery} onChange={e => setCategoryQuery(e.target.value)} /></div><div className="nav-label">KATEGORİLER</div><button className={`category ${!category ? 'selected' : ''}`} onClick={() => { setCategory(''); setLimit(60); }}>Tüm içerikler</button>{categories.filter(c => stateOf(c.id) !== 'hidden' && matches(c.name, categoryQuery)).map(c => <button key={c.id} className={`category ${category === c.id ? 'selected' : ''}`} onClick={() => openCategory(c.id)}>{c.name}</button>)}<button className="category refresh" onClick={() => setReload(v => v + 1)}><Icon name="refresh" size={16} /> Listeyi yenile</button></aside>}
        <div className={`browse-area ${!catalog ? 'wide-browse' : ''}`}><div className="section-title"><h2>{catalog ? selectedCategory : names[view]}</h2><span>{selectedLocked ? 'Kilitli' : loading && catalog ? 'Yükleniyor' : `${filtered.length} içerik`}</span></div>
          <div className={`browse-columns ${view === 'live' || playing || connecting || playError ? 'with-player' : ''}`}><section className="content-list" aria-label="İçerikler">
            {selectedLocked ? <div className="empty"><Icon name="lock" size={36} /><h3>Bu liste kilitli</h3><p>İçeriği görmek için PIN girin.</p><button onClick={() => unlockThen()}>Kilidi aç</button></div> : loading && catalog ? <div className="empty" role="status"><div className="spinner" />İçerikler yükleniyor…</div> : error && catalog ? <div className="empty"><div role="alert" className="error">{error}</div><button onClick={() => setReload(v => v + 1)}>Tekrar dene</button></div> : filtered.length === 0 ? <div className="empty"><Icon name={view === 'favorites' ? 'heart' : 'search'} size={36} /><h3>{query ? 'Sonuç bulunamadı' : view === 'favorites' ? 'Favorileriniz burada' : view === 'recent' ? 'Henüz izleme geçmişi yok' : 'Bu kategori boş'}</h3><p>{query ? 'Başka bir adla arayın veya tüm içeriklere geçin.' : view === 'favorites' ? 'İçeriklerin yanındaki kalbe basarak ekleyin.' : 'Bir içerik seçerek izlemeye başlayabilirsiniz.'}</p>{query && <button onClick={() => { setQuery(''); setCategory(''); }}>Tüm içerikleri göster</button>}</div> : <div className={`tile-grid ${view === 'vod' || view === 'series' ? 'tile-grid-posters' : ''}`}>{filtered.slice(0, limit).map((item, index) => <Tile key={itemKey(item)} item={item} index={index} playing={!!playing && itemKey(playing.item) === itemKey(item)} favorite={isFavorite(item)} posters={posters} epoch={posterEpoch} ready={ready} onSelect={() => select(item)} onFavorite={() => update(current => toggleFavorite(current, item))} />)}</div>}
            {filtered.length > limit && <button className="load-more" onClick={() => setLimit(v => v + 60)}>Daha fazla göster ({filtered.length - limit})</button>}
          </section>
          {(view === 'live' || playing || connecting || playError) && <aside className="watch-area">{playing ? <Player key={playing.playback.url} platform={platform} item={playing.item} playback={playing.playback} preferences={library.preferences} resumeAt={playing.resumeAt} full={full} onFull={setFull} onPreference={preference} onProgress={position => update(current => remember(current, playing.item, position))} onStarted={() => setStreamStarted(true)} onClose={stop} onRetry={() => void play(playing.item)} /> : <div className="watch-placeholder">{connecting ? <><div className="spinner" /><h3>{connecting.name}</h3><p>Yayına bağlanılıyor…</p><button onClick={stop}>İptal</button></> : playError ? <><div className="error" role="alert">{playError}</div><p>Listeden içeriği tekrar seçerek deneyin.</p></> : <><div className="placeholder-mark"><Icon name="play" size={40} /></div><h3>Bir kanal seçin</h3><p>Canlı yayınınız burada başlasın.</p><span className="pill">SADECE SİZİN HESABINIZ</span></>}</div>}{playing?.item.kind === 'live' && streamStarted && <Guide platform={platform} item={playing.item} />}<div className="watch-hint"><Icon name="full" size={16} /><span>{platform.type === 'tv' ? 'Tam ekran düğmesiyle yayını büyütün. Geri ile dönün.' : 'Tam ekran için F · Oynat / duraklatlat için boşluk'}</span></div></aside>}
          </div>
        </div>
      </div>}
    </main>
    {lockRequest && <LockDialog request={lockRequest} record={locks.pin} onClose={closeLock} />}
    {detail && <Details item={detail} platform={platform} onClose={() => setDetail(undefined)} onPlay={item => void play(item)} />}
    {confirmExit && <Modal title="UYGULAMADAN ÇIK" onClose={() => setConfirmExit(false)}><h2>İzlemeyi bitirelim mi?</h2><p className="muted">Hesabınız kilitlenecek, tercihleriniz cihazda kalacak.</p><div className="button-row"><button onClick={() => setConfirmExit(false)}>Burada kal</button><button className="primary" onClick={async () => { await logout(); platform.exit(); }}>Çıkış yap</button></div></Modal>}
  </div>;
}
