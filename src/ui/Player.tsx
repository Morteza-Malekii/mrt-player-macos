import { useEffect, useReducer, useRef, useState } from 'react';
import type { Item, Platform, Playback, Preferences } from '../core/models';
import { MAX_SUBTITLE_BYTES, decodeSubtitles, languageKey, parseSubtitles, preferredTrack, trackNames } from '../core/tracks';
import { Icon } from './Icon';
import { PlaybackStats, type PlaybackTimings } from './PlaybackStats';
export const timeLabel = (seconds: number) => { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const s = Math.floor(seconds), h = Math.floor(s / 3600); return `${h ? h + ':' : ''}${h ? String(Math.floor(s / 60) % 60).padStart(2, '0') : Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// The page only sees a file's dubs because the window turns AudioVideoTracks on (platform/mac/main.ts),
// and the DOM typings leave `audioTracks` out. A codec the browser cannot decode (AC-3, E-AC-3, DTS) is
// never listed. Subtitles inside the file are not exposed by Chromium at all, so only a loaded file shows.
type AudioTrack = { language: string; enabled: boolean };
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
  const [, bump] = useReducer((n: number) => n + 1, 0), prefs = useRef(preferences), external = useRef<TextTrack>(), picker = useRef<HTMLInputElement>(null);
  const [subtitle, setSubtitle] = useState<{ name: string; on: boolean }>(), [notice, setNotice] = useState('');
  prefs.current = preferences;
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
    const v = video.current!; settled(); setError(''); setLoading(true); setBuffering(false); setPosition(0); setDuration(0); setSeekable(false); progressAt.current = Date.now(); positionAt.current = 0; started.current = false;
    timings.current = { startedAt: performance.now(), stalls: 0, bufferingMs: 0 };
    let resumed = false;
    const metadata = () => { if (resumed || playback.live || !preferences.resume || !resumeAt || !v.seekable.length) return; if (resumeAt < v.duration - 5) seek(resumeAt); resumed = true; };
    v.addEventListener('canplay', metadata);
    const dispose = platform.attach(v, playback, report);
    const stall = setTimeout(() => { if (v.readyState < 2) report('Yayın yanıt vermiyor. Sunucu, hesap bağlantı sınırı veya video biçimini kontrol edin.'); }, 25000);
    return () => { clearTimeout(stall); clearTimeout(hideTimer.current); settled(); v.removeEventListener('canplay', metadata); if (!playback.live && v.currentTime > 0) callback.current(v.currentTime); dispose(); };
  }, [playback]);
  useEffect(() => { if (video.current) { video.current.volume = preferences.volume; video.current.muted = preferences.muted; } }, [preferences.volume, preferences.muted]);
  // The tracks appear once the file's header is read, so that is when the dub the viewer chose last
  // time is looked for; a file without it keeps its own default.
  useEffect(() => {
    const v = video.current!, list = (v as WithAudio).audioTracks, names = ['change', 'addtrack', 'removetrack'];
    const start = () => { const tracks = audioTracksOf(v), i = preferredTrack(tracks.map(t => t.language), prefs.current.audio); if (i >= 0 && !tracks[i].enabled) selectAudio(tracks, i); bump(); };
    v.addEventListener('loadedmetadata', start); names.forEach(name => list?.addEventListener(name, bump));
    return () => { v.removeEventListener('loadedmetadata', start); names.forEach(name => list?.removeEventListener(name, bump)); };
  }, []);
  const chooseAudio = (index: number) => { const tracks = audioTracksOf(video.current); selectAudio(tracks, index); const key = languageKey(tracks[index].language); if (key) onPreference({ audio: key }); bump(); };
  // The control bar covers the bottom of the picture (always in the window, until it fades in full
  // screen), so the text sits higher in the window. Percent of the picture height, to the text's bottom edge.
  const place = (track: TextTrack, lifted: boolean) => Array.from(track.cues || []).forEach(cue => { const c = cue as VTTCue; c.snapToLines = false; c.lineAlign = 'end'; c.line = lifted ? 74 : 90; });
  useEffect(() => { if (external.current && external.current.mode !== 'disabled') place(external.current, !full); }, [full]);
  const showSubtitle = (on: boolean) => { if (external.current) external.current.mode = on ? 'showing' : 'hidden'; setSubtitle(current => current && { ...current, on }); };
  async function loadSubtitle(file: File) {
    setNotice('');
    try {
      if (file.size > MAX_SUBTITLE_BYTES) throw new Error('Dosya çok büyük. Bir altyazı dosyası seçin.');
      const cues = parseSubtitles(decodeSubtitles(new Uint8Array(await file.arrayBuffer())));
      if (!cues.length) throw new Error('Dosyada altyazı bulunamadı. .srt veya .vtt dosyası seçin.');
      const v = video.current!, track = external.current ??= v.addTextTrack('subtitles', 'Altyazı');
      // A track with no mode has no cue list, and a new file replaces the old one's cues.
      track.mode = 'hidden'; Array.from(track.cues || []).reverse().forEach(cue => track.removeCue(cue));
      cues.forEach(cue => track.addCue(new VTTCue(cue.start, cue.end, cue.text)));
      place(track, !full); track.mode = 'showing'; setSubtitle({ name: file.name, on: true }); onMenu(false);
    } catch (e) { setNotice((e as Error).message || 'Altyazı dosyası okunamadı.'); }
  }
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
    {statsVisible && <PlaybackStats platform={platform} video={video} playback={playback} timings={timings} />}
    {menu && !playback.live && (() => {
      const audio = audioTracksOf(video.current), names = trackNames(audio.map(t => t.language));
      return <div className="track-menu" role="group" aria-label="Ses ve altyazı">
        <section>
          <strong>Ses</strong>
          {audio.length > 1 ? <div role="radiogroup" aria-label="Ses">{audio.map((t, i) => <button key={i} role="radio" aria-checked={t.enabled} className="track-option" onClick={() => chooseAudio(i)}>{names[i]}</button>)}</div> : <p className="track-note">Bu dosyada seçilebilecek tek ses var.</p>}
          <small>AC-3, E-AC-3 ve DTS sesler bu Mac'te çözülemediği için listelenmez.</small>
        </section>
        <section>
          <strong>Altyazı</strong>
          <div role="radiogroup" aria-label="Altyazı"><button role="radio" aria-checked={!subtitle?.on} className="track-option" onClick={() => showSubtitle(false)}>Kapalı</button>{subtitle && <button role="radio" aria-checked={subtitle.on} className="track-option" onClick={() => showSubtitle(true)}>{subtitle.name}</button>}</div>
          <button className="track-load" onClick={() => picker.current?.click()}>Altyazı dosyası yükle…</button>
          <small>Dosyanın içine gömülü altyazılar gösterilemez; .srt veya .vtt dosyası yükleyebilirsiniz.</small>
          {notice && <div className="error" role="alert">{notice}</div>}
        </section>
      </div>;
    })()}
    <input ref={picker} type="file" hidden accept=".srt,.vtt" aria-label="Altyazı dosyası" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadSubtitle(file); }} />
  </div>;
}
