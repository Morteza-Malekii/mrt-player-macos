import { useEffect, useReducer, useRef, useState } from 'react';
import type { CueBatch, Item, MediaTrack, MediaTracks, Platform, Playback, Preferences } from '../core/models';
import { fitNote } from '../core/subtitles';
import { MAX_SUBTITLE_BYTES, canRemux, decodeSubtitles, languageKey, mediaTrackNames, nativeIndex, parseSubtitles, preferredTrack, startingTrack, trackNames } from '../core/tracks';
import { Icon } from './Icon';
import { PlaybackStats, type PlaybackTimings } from './PlaybackStats';
import { SubtitleSearch } from './SubtitleSearch';
export const timeLabel = (seconds: number) => { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const s = Math.floor(seconds), h = Math.floor(s / 3600); return `${h ? h + ':' : ''}${h ? String(Math.floor(s / 60) % 60).padStart(2, '0') : Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// The page only sees a file's dubs because the window turns AudioVideoTracks on (platform/mac/main.ts),
// and the DOM typings leave `audioTracks` out. A codec the browser cannot decode (AC-3, E-AC-3, DTS) is
// never listed there, and subtitles inside the file are not exposed at all. So on the Mac the file itself
// is read as it plays (`tracks`): every dub and subtitle is listed, a dub Chromium cannot decode plays
// through the converter (another route for the same title, `remux`), and a text subtitle inside the file
// is shown as it is read (`subtitleCues`). Without that list the player shows what Chromium offers.
type AudioTrack = { id: string; language: string; enabled: boolean };
type Choice = 'off' | 'file' | number;
type WithAudio = HTMLVideoElement & { audioTracks?: ArrayLike<AudioTrack> & EventTarget };
const audioTracksOf = (v: HTMLVideoElement | null) => Array.from((v as WithAudio | null)?.audioTracks || []);
const selectAudio = (tracks: AudioTrack[], index: number) => { tracks[index].enabled = true; tracks.forEach((t, i) => { if (i !== index) t.enabled = false; }); };
export function Player({ platform, item, playback, preferences, resumeAt, full, onFull, menu, onMenu, onPreference, onProgress, onStarted, onClose, onRetry }: { platform: Platform; item: Item; playback: Playback; preferences: Preferences; resumeAt: number; full: boolean; onFull(value: boolean): void; menu: boolean; onMenu(open: boolean): void; onPreference(p: Partial<Preferences>): void; onProgress(position: number): void; onStarted(): void; onClose(): void; onRetry(): void }) {
  const video = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null), callback = useRef(onProgress), startedCallback = useRef(onStarted), started = useRef(false);
  callback.current = onProgress; startedCallback.current = onStarted;
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [buffering, setBuffering] = useState(false), [paused, setPaused] = useState(true), [position, setPosition] = useState(0), [duration, setDuration] = useState(0), [seekable, setSeekable] = useState(false);
  const [controls, setControls] = useState(true), [statsVisible, setStatsVisible] = useState(false); const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const progressAt = useRef(0), positionAt = useRef(0), waitTimer = useRef<ReturnType<typeof setTimeout>>(), errorTimer = useRef<ReturnType<typeof setTimeout>>(), stallTimer = useRef<ReturnType<typeof setTimeout>>();
  const timings = useRef<PlaybackTimings>({ startedAt: performance.now(), stalls: 0, bufferingMs: 0 });
  const [, bump] = useReducer((n: number) => n + 1, 0), prefs = useRef(preferences), external = useRef<TextTrack>(), embedded = useRef<TextTrack>(), embeddedOf = useRef<{ id: number; next: number }>(), picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string>(), [shown, setShown] = useState<Choice>('off'), [notice, setNotice] = useState(''), [caution, setCaution] = useState(''), [shift, setShift] = useState(0);
  // `route` is how the title is played right now: the plain file, or the converter with a chosen dub.
  const [route, setRoute] = useState(playback), routeRef = useRef(route), [info, setInfo] = useState<MediaTracks | null>(null), infoRef = useRef(info);
  const settledDub = useRef(false), resumed = useRef(false), natives = useRef<Array<{ id: string; language: string }>>(), nativeWanted = useRef<MediaTrack>();
  prefs.current = preferences; routeRef.current = route; infoRef.current = info;
  // A short rebuffer or a drop the player recovers from on its own should not paint a status
  // over the picture; only a gap that outlasts the retries is worth telling the viewer about.
  const settled = () => { clearTimeout(waitTimer.current); clearTimeout(errorTimer.current); clearTimeout(stallTimer.current); };
  const report = (message: string) => { settled(); setLoading(false); setError(message); };
  const play = () => { const v = video.current; if (!v) return; if (v.paused) { setError(''); void v.play().catch(() => setError('Yayın oynatılamadı. Yeniden deneyin.')); } else v.pause(); };
  const seek = (seconds: number) => { const v = video.current; if (!v || playback.live || !v.seekable.length) return; const start = v.seekable.start(0), end = v.seekable.end(v.seekable.length - 1); v.currentTime = Math.max(start, Math.min(end, seconds)); };
  function reveal() { setControls(true); clearTimeout(hideTimer.current); if (full) hideTimer.current = setTimeout(() => { if (!container.current?.contains(document.activeElement) || document.activeElement === container.current) setControls(false); }, 4500); }
  function fullscreen() {
    onFull(!full); setControls(true);
    if (!full && platform.type === 'mac') void container.current?.requestFullscreen().catch(() => {});
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }
  useEffect(() => {
    const v = video.current!; settled(); setError(''); setLoading(true); setBuffering(false); setPosition(route.at || 0); setDuration(0); setSeekable(false); progressAt.current = Date.now(); positionAt.current = 0; started.current = false;
    timings.current = { startedAt: performance.now(), stalls: 0, bufferingMs: 0 };
    // Only the first route goes back to where the viewer stopped last time; a later one starts where the last one was.
    const metadata = () => { if (route !== playback || resumed.current || playback.live || !preferences.resume || !resumeAt || !v.seekable.length) return; if (resumeAt < v.duration - 5) seek(resumeAt); resumed.current = true; };
    v.addEventListener('canplay', metadata);
    const dispose = platform.attach(v, route, report);
    const stall = setTimeout(() => { if (v.readyState < 2) report('Yayın yanıt vermiyor. Sunucu, hesap bağlantı sınırı veya video biçimini kontrol edin.'); }, 25000);
    return () => { clearTimeout(stall); clearTimeout(hideTimer.current); settled(); v.removeEventListener('canplay', metadata); if (!playback.live && v.currentTime > 0) callback.current(v.currentTime); dispose(); };
  }, [route]);
  useEffect(() => { if (video.current) { video.current.volume = preferences.volume; video.current.muted = preferences.muted; } }, [preferences.volume, preferences.muted]);
  // Where the next route starts: where playback is, or where the viewer stopped last time if the first
  // route has not got there yet.
  const startAt = () => { const v = video.current!; return routeRef.current === playback && !resumed.current && prefs.current.resume && resumeAt && v.currentTime < 1 && !(v.duration && resumeAt >= v.duration - 5) ? resumeAt : v.currentTime; };
  const convert = (track: MediaTrack) => { const known = infoRef.current; if (!known || !canRemux(known.video)) return; const at = startAt(); resumed.current = true; setRoute({ ...playback, at, remux: { audio: track.order, video: known.video, duration: known.duration } }); };
  const plain = (track: MediaTrack) => { nativeWanted.current = track; setRoute({ ...playback, at: video.current?.currentTime || 0 }); };
  // The dub the title starts on, once both the file's list and Chromium's are known: the language chosen
  // last time, else the file's default. If Chromium cannot play it, the converter does.
  const reconcile = () => {
    const v = video.current, known = infoRef.current;
    if (!v || !known || settledDub.current || routeRef.current !== playback || v.readyState < 1) return;
    settledDub.current = true;
    const audio = known.tracks.filter(t => t.kind === 'audio'), wanted = startingTrack(audio, prefs.current.audio);
    if (!wanted) return;
    const list = audioTracksOf(v), n = nativeIndex(wanted, list);
    if (n >= 0) { if (!list[n].enabled) selectAudio(list, n); bump(); }
    else convert(wanted);
  };
  useEffect(reconcile, [info]);
  // The file's own list: its header passes through as the player starts reading, so it is asked for a few
  // times until it is there. Live channels and platforms without a reader have none.
  useEffect(() => {
    if (playback.live || platform.type !== 'mac') return;
    let alive = true, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => platform.call<MediaTracks | null>('tracks', { url: playback.url }).then(result => { if (!alive) return; if (result) setInfo(result); else if (++tries < 60) timer = setTimeout(ask, 500); }, () => {});
    void ask();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  // The tracks appear once the file's header is read, so that is when the dub the viewer chose last
  // time is looked for; a file without it keeps its own default.
  useEffect(() => {
    const v = video.current!, list = (v as WithAudio).audioTracks, names = ['change', 'addtrack', 'removetrack'];
    const start = () => {
      if (routeRef.current.remux) { bump(); return; }
      const tracks = audioTracksOf(v);
      natives.current ??= tracks.map(t => ({ id: t.id, language: t.language }));
      const back = nativeWanted.current; nativeWanted.current = undefined;
      const i = back ? nativeIndex(back, tracks) : preferredTrack(tracks.map(t => t.language), prefs.current.audio);
      if (i >= 0 && !tracks[i].enabled) selectAudio(tracks, i);
      bump(); reconcile();
    };
    v.addEventListener('loadedmetadata', start); names.forEach(name => list?.addEventListener(name, bump));
    return () => { v.removeEventListener('loadedmetadata', start); names.forEach(name => list?.removeEventListener(name, bump)); };
  }, []);
  const chooseAudio = (index: number) => { const tracks = audioTracksOf(video.current); selectAudio(tracks, index); const key = languageKey(tracks[index].language); if (key) onPreference({ audio: key }); bump(); };
  // A dub from the file's list: Chromium plays it if it can, otherwise the converter does.
  const chooseTrack = (track: MediaTrack) => {
    const key = languageKey(track.language); if (key) onPreference({ audio: key });
    const current = routeRef.current, playable = nativeIndex(track, natives.current || []) >= 0;
    if (!current.remux) { const list = audioTracksOf(video.current), n = nativeIndex(track, list); if (n >= 0) { selectAudio(list, n); bump(); } else convert(track); return; }
    if (current.remux.audio === track.order) return;
    if (playable) plain(track); else convert(track);
  };
  // The control bar covers the bottom of the picture (always in the window, until it fades in full
  // screen), so the text sits higher in the window. Percent of the picture height, to the text's bottom edge.
  const placeCue = (cue: VTTCue, lifted: boolean) => { cue.snapToLines = false; cue.lineAlign = 'end'; cue.line = lifted ? 74 : 90; };
  const place = (track: TextTrack, lifted: boolean) => Array.from(track.cues || []).forEach(cue => placeCue(cue as VTTCue, lifted));
  const fullRef = useRef(full); fullRef.current = full;
  useEffect(() => { for (const track of [external.current, embedded.current]) if (track && track.mode !== 'disabled') place(track, !full); }, [full]);
  const showSubtitle = (choice: Choice) => { if (external.current) external.current.mode = choice === 'file' ? 'showing' : 'hidden'; if (embedded.current) embedded.current.mode = typeof choice === 'number' ? 'showing' : 'hidden'; setShown(choice); };
  // A subtitle inside the file: its lines arrive as the file is read, so they are fetched now and then
  // while it is on. Lines for a part not read yet (far ahead of a seek) appear once playback gets there.
  useEffect(() => {
    if (typeof shown !== 'number') return;
    const track = embedded.current ??= video.current!.addTextTrack('subtitles', 'Gömülü altyazı');
    if (embeddedOf.current?.id !== shown) { track.mode = 'hidden'; Array.from(track.cues || []).reverse().forEach(cue => track.removeCue(cue)); embeddedOf.current = { id: shown, next: 0 }; }
    track.mode = 'showing';
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      const state = embeddedOf.current!;
      try {
        const batch = await platform.call<CueBatch>('subtitleCues', { url: playback.url, track: state.id, since: state.next });
        if (!alive || embeddedOf.current !== state) return;
        for (const line of batch.cues) { const cue = new VTTCue(line.start, line.end, line.text); placeCue(cue, !fullRef.current); track.addCue(cue); }
        state.next = batch.next;
        timer = setTimeout(() => void pull(), batch.cues.length >= 2000 ? 50 : 1500);
      } catch { if (alive) timer = setTimeout(() => void pull(), 3000); }
    };
    void pull();
    return () => { alive = false; clearTimeout(timer); };
  }, [shown]);
  // A subtitle file, picked from disk or found on the internet, becomes the track the viewer sees.
  function applySubtitle(name: string, bytes: Uint8Array) {
    setNotice(''); setCaution('');
    try {
      if (bytes.length > MAX_SUBTITLE_BYTES) throw new Error('Dosya çok büyük. Bir altyazı dosyası seçin.');
      const cues = parseSubtitles(decodeSubtitles(bytes));
      if (!cues.length) throw new Error('Dosyada altyazı bulunamadı. .srt veya .vtt dosyası seçin.');
      const v = video.current!, track = external.current ??= v.addTextTrack('subtitles', 'Altyazı');
      // A track with no mode has no cue list, and a new file replaces the old one's cues.
      track.mode = 'hidden'; Array.from(track.cues || []).reverse().forEach(cue => track.removeCue(cue));
      cues.forEach(cue => track.addCue(new VTTCue(cue.start, cue.end, cue.text)));
      place(track, !full); setFile(name); setShift(0); showSubtitle('file');
      setCaution(fitNote(Math.max(...cues.map(cue => cue.end)), infoRef.current?.duration || (Number.isFinite(v.duration) ? v.duration : 0)));
      return true;
    } catch (e) { setNotice((e as Error).message || 'Altyazı dosyası okunamadı.'); return false; }
  }
  async function loadSubtitle(file: File) {
    setNotice('');
    try { if (file.size > MAX_SUBTITLE_BYTES) throw new Error('Dosya çok büyük. Bir altyazı dosyası seçin.'); if (applySubtitle(file.name, new Uint8Array(await file.arrayBuffer()))) onMenu(false); }
    catch (e) { setNotice((e as Error).message || 'Altyazı dosyası okunamadı.'); }
  }
  // A subtitle timed a little early or late: every line moves together. Plus makes the lines come later.
  const nudge = (delta: number) => { const track = external.current; if (!track) return; Array.from(track.cues || []).forEach(cue => { cue.startTime = Math.max(0, cue.startTime + delta); cue.endTime = Math.max(cue.startTime + 0.1, cue.endTime + delta); }); setShift(value => Math.round((value + delta) * 10) / 10); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('.track-menu')) return;
      const code = e.keyCode;
      if (e.key === ' ' || code === 415 || code === 19) { e.preventDefault(); if (code === 415) void video.current?.play().catch(() => setError('Oynatma başlatılamadı.')); else if (code === 19) video.current?.pause(); else play(); }
      else if (code === 413) { e.preventDefault(); onClose(); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); fullscreen(); }
      else if (e.key.toLowerCase() === 'm') { e.preventDefault(); onPreference({ muted: !preferences.muted }); }
      else if (code === 417 || code === 412 || (platform.type !== 'tv' && full && ['ArrowLeft', 'ArrowRight'].includes(e.key))) { e.preventDefault(); seek((video.current?.currentTime || 0) + (code === 412 || e.key === 'ArrowLeft' ? -10 : 10)); }
      reveal();
    };
    const visibility = () => { if (document.hidden) video.current?.pause(); };
    const fullChanged = () => { if (!document.fullscreenElement && platform.type === 'mac') onFull(false); };
    window.addEventListener('keydown', onKey); document.addEventListener('visibilitychange', visibility); document.addEventListener('fullscreenchange', fullChanged);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', fullChanged); };
  }, [full, preferences, playback]);
  useEffect(() => { if (!full && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); if (full) { container.current?.focus(); reveal(); } }, [full]);
  return <div className={`player ${full ? 'player-full' : ''} ${controls || statsVisible || menu || !full || paused || error ? 'show-controls' : ''}`} ref={container} tabIndex={-1} onMouseMove={reveal} onClick={reveal}>
    <video ref={video} autoPlay playsInline onDoubleClick={fullscreen} onLoadStart={() => { if (!started.current) { setLoading(true); setBuffering(false); } }} onWaiting={() => { const t = timings.current; if (started.current && !t.bufferingStartedAt) { t.stalls++; t.bufferingStartedAt = performance.now(); } if (!started.current) { setLoading(true); setBuffering(true); } else { clearTimeout(waitTimer.current); waitTimer.current = setTimeout(() => { setLoading(true); setBuffering(true); }, 800); clearTimeout(stallTimer.current); stallTimer.current = setTimeout(() => { if (!video.current?.paused) report('Yayın kesildi ve geri gelmedi. Yeniden deneyin veya Ayarlar’dan başka bir canlı yayın biçimi seçin.'); }, 20000); } }} onPlaying={() => { const t = timings.current, now = performance.now(); if (t.firstFrameAt === undefined) t.firstFrameAt = now; if (t.bufferingStartedAt) { t.bufferingMs += now - t.bufferingStartedAt; t.bufferingStartedAt = undefined; } settled(); setLoading(false); setBuffering(false); setError(''); setPaused(false); if (!started.current) { started.current = true; startedCallback.current(); callback.current(playback.live ? 0 : video.current?.currentTime || 0); } }} onPause={() => setPaused(true)} onCanPlay={() => { settled(); setLoading(false); }} onEnded={() => { setPaused(true); callback.current(0); }} onError={() => { clearTimeout(errorTimer.current); errorTimer.current = setTimeout(() => { setLoading(false); setError('Video açılamadı. Sunucu erişimini ve cihazın codec desteğini kontrol edin.'); }, 3000); }} onTimeUpdate={() => { if (playback.live) return; const v = video.current!, now = Date.now(); if (now - positionAt.current > 500) { positionAt.current = now; setPosition(v.currentTime); setDuration(Number.isFinite(v.duration) ? v.duration : 0); setSeekable(v.seekable.length > 0); } if (v.currentTime > 0 && now - progressAt.current > 30000) { progressAt.current = now; callback.current(v.currentTime); } }} />
    <div className="player-top"><div><span className={`pill ${playback.live ? 'live-pill' : ''}`}>{playback.live ? '● CANLI' : 'İZLENİYOR'}</span><strong>{item.name}</strong></div><button className="icon-button" aria-label="Oynatıcıyı kapat" onClick={onClose}><Icon name="close" /></button></div>
    {loading && !error && <div className="player-status" role="status"><div className="spinner" /><span>{buffering ? 'Yayın tamponlanıyor…' : 'Yayın yükleniyor…'}</span></div>}
    {error && <div className="player-status"><div className="error" role="alert">{error}</div><button className="primary" onClick={onRetry}><Icon name="refresh" /> Yeniden dene</button></div>}
    <div className="player-controls" onFocus={reveal}>{!playback.live && <div className="seek-row"><span>{timeLabel(position)}</span><input aria-label="Oynatma konumu" type="range" min={0} max={duration || 1} step={1} value={position} disabled={!seekable} onChange={e => seek(Number(e.target.value))} /><span>{timeLabel(duration)}</span></div>}<div className="control-row"><button className="icon-button" aria-label={paused ? 'Oynat' : 'Duraklat'} onClick={play}><Icon name={paused ? 'play' : 'pause'} /></button>{!playback.live && <><button className="skip-button" onClick={() => seek(position - 10)} aria-label="10 saniye geri">−10</button><button className="skip-button" onClick={() => seek(position + 10)} aria-label="10 saniye ileri">+10</button></>}<button className="icon-button" aria-label={preferences.muted ? 'Sesi aç' : 'Sesi kapat'} onClick={() => onPreference({ muted: !preferences.muted })}><Icon name={preferences.muted ? 'mute' : 'volume'} /></button><input className="volume-slider" aria-label="Ses seviyesi" type="range" min={0} max={1} step={0.05} value={preferences.volume} onChange={e => onPreference({ volume: Number(e.target.value), muted: false })} /><span className="control-spacer" />{!playback.live && <button className="icon-button" aria-label="Ses ve altyazı" aria-expanded={menu} onClick={() => { setStatsVisible(false); setNotice(''); onMenu(!menu); }}><Icon name="subtitles" /></button>}<button className="stream-info-button" aria-label="Akış bilgileri" aria-pressed={statsVisible} onClick={() => { onMenu(false); setStatsVisible(value => !value); }}>Akış bilgisi</button><button className="icon-button" aria-label={full ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={fullscreen}><Icon name="full" /></button></div></div>
    {statsVisible && <PlaybackStats platform={platform} video={video} playback={route} timings={timings} />}
    {menu && !playback.live && (() => {
      const native = audioTracksOf(video.current), nativeNames = trackNames(native.map(t => t.language));
      const listed = info?.tracks.filter(t => t.kind === 'audio') || [], names = mediaTrackNames(listed);
      const subs = info?.tracks.filter(t => t.kind === 'subtitle') || [], subNames = mediaTrackNames(subs);
      const convertible = canRemux(info?.video), known = natives.current || native;
      const playable = (t: MediaTrack) => nativeIndex(t, known) >= 0;
      const on = (t: MediaTrack) => { if (route.remux) return route.remux.audio === t.order; const n = nativeIndex(t, native); return n >= 0 && native[n].enabled; };
      const converted = listed.some(t => !playable(t));
      return <div className="track-menu" role="group" aria-label="Ses ve altyazı">
        <section>
          <strong>Ses</strong>
          {listed.length ? <div role="radiogroup" aria-label="Ses">{listed.map((t, i) => <button key={t.id} role="radio" aria-checked={on(t)} className="track-option" disabled={!playable(t) && !convertible} title={names[i]} onClick={() => chooseTrack(t)}>{names[i]}</button>)}</div>
            : native.length > 1 ? <div role="radiogroup" aria-label="Ses">{native.map((t, i) => <button key={i} role="radio" aria-checked={t.enabled} className="track-option" onClick={() => chooseAudio(i)}>{nativeNames[i]}</button>)}</div>
            : <p className="track-note">Bu dosyada seçilebilecek tek ses var.</p>}
          {listed.length ? converted && <small>{convertible ? 'Dolby (AC-3, E-AC-3) ve DTS sesler bu Mac’te çözülemediği için çalınırken AAC’ye çevrilir.' : 'Dolby (AC-3, E-AC-3) ve DTS sesler bu dosyada çevrilemediği için seçilemez.'}</small>
            : <small>AC-3, E-AC-3 ve DTS sesler bu Mac'te çözülemediği için listelenmez.</small>}
        </section>
        <section>
          <strong>Altyazı</strong>
          <div role="radiogroup" aria-label="Altyazı">
            <button role="radio" aria-checked={shown === 'off'} className="track-option" onClick={() => showSubtitle('off')}>Kapalı</button>
            {subs.map((t, i) => <button key={t.id} role="radio" aria-checked={shown === t.id} className="track-option" disabled={!t.text} title={subNames[i]} onClick={() => showSubtitle(t.id)}>{subNames[i]}</button>)}
            {file && <button role="radio" aria-checked={shown === 'file'} className="track-option" onClick={() => showSubtitle('file')}>{file}</button>}
          </div>
          {shown === 'file' && <div className="track-shift" role="group" aria-label="Altyazı zamanlaması"><span>Zamanlama</span><button aria-label="Altyazıyı 0,5 saniye öne al" onClick={() => nudge(-0.5)}>−0,5 sn</button><output>{shift > 0 ? '+' : ''}{shift.toFixed(1).replace('.', ',')} sn</output><button aria-label="Altyazıyı 0,5 saniye geciktir" onClick={() => nudge(0.5)}>+0,5 sn</button></div>}
          {caution && shown === 'file' && <small className="subtitle-note" role="status">{caution}</small>}
          <button className="track-load" onClick={() => picker.current?.click()}>Altyazı dosyası yükle…</button>
          {platform.type === 'mac' && <SubtitleSearch platform={platform} item={item} playback={playback} onStart={() => { setNotice(''); setCaution(''); }} onPick={(name, bytes) => { if (applySubtitle(name, bytes)) onMenu(false); }} />}
          <small>{subs.some(t => !t.text) ? (info?.format === 'mp4' ? 'MP4 içindeki altyazılar gösterilemez. ' : 'Resim altyazılar (PGS, VobSub) gösterilemez. ') : ''}
            {!info || info.format === 'other' ? 'Dosyanın içine gömülü altyazılar gösterilemez; .srt veya .vtt dosyası yükleyebilirsiniz.' : subs.some(t => t.text) ? 'Dosyadaki altyazı film okundukça gelir; .srt veya .vtt dosyası da yükleyebilirsiniz.' : 'Dosyada gösterilebilecek altyazı yok; .srt veya .vtt dosyası yükleyebilirsiniz.'}</small>
          {notice && <div className="error" role="alert">{notice}</div>}
        </section>
      </div>;
    })()}
    <input ref={picker} type="file" hidden accept=".srt,.vtt" aria-label="Altyazı dosyası" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadSubtitle(file); }} />
  </div>;
}
