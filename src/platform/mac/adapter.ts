import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type { Action, Platform, Playback, Reply } from '../../core/models';
import { remuxType } from '../../core/tracks';
declare global { interface Window { kiyi: { call<T>(action: Action, payload?: unknown): Promise<Reply<T>> } } }
// Live sources drop segments, rotate upstreams and close sockets mid-stream. A bounded retry
// keeps the channel on screen instead of turning every hiccup into an error page; the budget
// refills once playback has been steady again, so a long session is not spent by a bad minute.
const RETRIES = 4;
// A film whose dub goes through the converter (platform/mac/remux.ts): fragmented MP4 is fetched from
// kiyi://remux and appended to a MediaSource. The file's own timestamps are kept, so the timeline, the seek
// bar and the resume position read exactly as they do for the plain file. A seek inside what is buffered
// plays on; one outside it starts a new conversion at that point. Reading pauses once enough is buffered,
// which pauses the converter and the provider's connection with it.
const AHEAD = 45, BEHIND = 30;
function remux(video: HTMLVideoElement, playback: Playback, onError: (message: string) => void): () => void {
  const { audio, video: family, duration } = playback.remux!;
  const base = playback.url.replace(/^kiyi:\/\//, 'kiyi://remux/'), source = new MediaSource(), address = URL.createObjectURL(source);
  let disposed = false, buffer: SourceBuffer | undefined, run = 0, control: AbortController | undefined, from = 0, failures = 0, seekTimer: ReturnType<typeof setTimeout> | undefined;
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const idle = async () => { while (buffer?.updating) await new Promise(resolve => buffer!.addEventListener('updateend', resolve, { once: true })); };
  const span = (t: number) => { for (let i = 0; i < video.buffered.length; i++) if (t >= video.buffered.start(i) - 0.3 && t <= video.buffered.end(i)) return [video.buffered.start(i), video.buffered.end(i)]; return undefined; };
  const ahead = () => { const s = span(video.currentTime); return s ? s[1] - video.currentTime : 0; };
  const last = () => video.buffered.length ? video.buffered.end(video.buffered.length - 1) : from;
  async function append(chunk: Uint8Array, mine: number) {
    for (let tries = 0; ; tries++) {
      await idle(); if (disposed || mine !== run || !buffer) return;
      const sb = buffer, behind = sb.buffered.length ? video.currentTime - sb.buffered.start(0) : 0;
      if (behind > BEHIND * 2) { sb.remove(0, video.currentTime - BEHIND); continue; }
      try { sb.appendBuffer(chunk as BufferSource); await idle(); return; }
      catch (error) {
        // The buffer is full: make room behind playback, or let playback use some up first.
        if ((error as DOMException).name !== 'QuotaExceededError' || tries >= 60) throw error;
        if (behind > 6) sb.remove(0, video.currentTime - 5); else await wait(1000);
      }
    }
  }
  // `keep` carries on after a dropped connection without throwing away what is buffered.
  async function load(at: number, keep: boolean) {
    const mine = ++run; control?.abort(); const own = control = new AbortController(); from = at;
    try {
      await idle(); if (disposed || mine !== run || !buffer) return;
      if (source.readyState === 'open') buffer.abort();
      if (!keep && buffer.buffered.length) { buffer.remove(0, Infinity); await idle(); }
      const response = await fetch(`${base}?audio=${audio}&at=${at.toFixed(3)}`, { signal: own.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`converter ${response.status}`);
      const reader = response.body.getReader();
      for (;;) {
        while (!disposed && mine === run && ahead() > AHEAD) await wait(400);
        if (disposed || mine !== run) { void reader.cancel().catch(() => {}); return; }
        const { value, done } = await reader.read();
        if (disposed || mine !== run) { void reader.cancel().catch(() => {}); return; }
        if (done) break;
        await append(value, mine);
        if (ahead() > 5) failures = 0;
      }
      await idle();
      if (!disposed && mine === run && source.readyState === 'open') source.endOfStream();
    } catch {
      if (disposed || mine !== run) return;
      if (++failures > RETRIES) { onError('Dönüştürülen ses oynatılamadı. Başka bir ses seçin veya yeniden deneyin.'); return; }
      await wait(500 * failures);
      if (!disposed && mine === run) { const s = span(video.currentTime); void load(s ? s[1] : video.currentTime, !!s); }
    }
  }
  const seeking = () => {
    const t = video.currentTime;
    // Already buffered, or on its way: this conversion started at or before it and is not far behind.
    if (span(t) || (t >= from - 0.5 && t <= Math.max(from, last()) + 20)) return;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => { if (!disposed && !span(video.currentTime)) void load(video.currentTime, false); }, 200);
  };
  source.addEventListener('sourceopen', () => {
    if (buffer || disposed) return;
    try { if (duration > 0) source.duration = duration; buffer = source.addSourceBuffer(remuxType(family)); }
    catch { onError('Bu dosyanın görüntüsü bu Mac’te dönüştürülerek oynatılamıyor.'); return; }
    const at = playback.at || 0;
    if (at > 0) video.currentTime = at;
    void load(at, false);
    void video.play().catch(() => { if (!disposed) onError('Oynat düğmesine basarak yayını başlatın.'); });
  });
  video.addEventListener('seeking', seeking);
  video.src = address;
  return () => { disposed = true; run++; control?.abort(); clearTimeout(seekTimer); video.removeEventListener('seeking', seeking); video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(address); };
}
export const platform: Platform = {
  type: 'mac',
  async call<T>(action: Action, payload?: unknown): Promise<T> {
    const reply = await window.kiyi.call<T>(action, payload);
    if (!reply.ok) throw Object.assign(new Error(reply.error?.message || 'İşlem tamamlanamadı.'), { code: reply.error?.code });
    return reply.data as T;
  },
  attach(video, playback, onError) {
    if (playback.remux) return remux(video, playback, onError);
    let disposed = false, attempts = 0, settle: ReturnType<typeof setTimeout> | undefined;
    const big = playback.buffer === 'large';
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (run: () => void, delay: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!disposed) run(); }, delay); timers.add(timer); };
    const again = (restart: () => void) => { if (disposed || attempts >= RETRIES) return false; later(restart, 400 * ++attempts); return true; };
    const steady = () => { clearTimeout(settle); settle = setTimeout(() => { attempts = 0; }, 10000); };
    const unsettle = () => clearTimeout(settle);
    video.addEventListener('playing', steady); video.addEventListener('waiting', unsettle);
    const stop = () => { disposed = true; clearTimeout(settle); video.removeEventListener('playing', steady); video.removeEventListener('waiting', unsettle); for (const timer of timers) clearTimeout(timer); timers.clear(); };
    if (playback.format === 'ts') {
      if (!mpegts.getFeatureList().mseLivePlayback) { stop(); onError('Bu Mac MPEG-TS canlı yayını desteklemiyor. Ayarlar’dan HLS seçin.'); return () => {}; }
      let player: ReturnType<typeof mpegts.createPlayer> | undefined;
      const teardown = () => { if (!player) return; try { player.pause(); player.unload(); player.detachMediaElement(); player.destroy(); } catch { /* already torn down */ } player = undefined; };
      const start = () => {
        teardown();
        try {
          // Never chase the live edge. Latency chasing seeks forward whenever a cushion builds
          // up, which is exactly the cushion a jittery provider needs; a few seconds behind and
          // steady beats being current and stuttering. A bigger stash rides out slow patches.
          player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: playback.url }, { enableWorker: true, enableStashBuffer: true, stashInitialSize: big ? 2048 * 1024 : 512 * 1024, lazyLoad: false, liveBufferLatencyChasing: false, autoCleanupSourceBuffer: true });
          player.on(mpegts.Events.ERROR, () => { if (disposed) return; if (!again(start)) { teardown(); onError('MPEG-TS yayını açılamadı. HLS biçimini veya başka bir kanalı deneyin.'); } });
          player.attachMediaElement(video); player.load();
          void Promise.resolve(player.play()).catch(() => { if (!disposed) onError('Oynat düğmesine basarak yayını başlatın.'); });
        } catch {
          teardown();
          onError('MPEG-TS oynatıcısı başlatılamadı. HLS biçimini deneyin.');
        }
      };
      start();
      return () => { stop(); teardown(); video.removeAttribute('src'); video.load(); };
    }
    if (playback.format !== 'hls' || (playback.engine !== 'js' && video.canPlayType('application/vnd.apple.mpegurl'))) {
      // Native HLS and plain files: the element owns loading, so a retry re-opens the source
      // and puts a film back where it was interrupted rather than at the beginning.
      const start = (resumeAt: number) => {
        video.src = playback.url; video.load();
        if (resumeAt > 0) video.addEventListener('loadedmetadata', () => { if (!disposed && video.currentTime < resumeAt) video.currentTime = resumeAt; }, { once: true });
        void video.play().catch(() => { if (!disposed) onError('Oynat düğmesine basarak yayını başlatın.'); });
      };
      const failed = () => {
        if (disposed) return;
        const resumeAt = playback.live ? 0 : video.currentTime;
        if (!again(() => start(resumeAt))) onError('Video açılamadı. Sunucu erişimini ve cihazın codec desteğini kontrol edin.');
      };
      // Left alone, the element resumes the moment it has a fraction of a second of video, so
      // a provider that keeps dipping below the bitrate produces a stall every few seconds.
      // Waiting for a real cushion turns a dozen interruptions into one longer wait.
      // Chromium caps how far a paused element reads ahead — measured at roughly 15-16s — so a
      // target at or above that is never reached and the hold never ends. Stay clearly under
      // it, and resume anyway the moment the buffer stops growing or a hard cap is hit, so a
      // provider that cannot even sustain the cushion can never hang the film.
      const CUSHION = 10, MAX_HOLD_MS = 15000;
      let holding = false, ours = false, stopped = false, startedAt = 0, lastAhead = 0, flat = 0;
      const ahead = () => {
        for (let i = 0; i < video.buffered.length; i++) if (video.currentTime >= video.buffered.start(i) - 0.1 && video.currentTime <= video.buffered.end(i)) return video.buffered.end(i) - video.currentTime;
        return 0;
      };
      const complete = () => video.buffered.length > 0 && Number.isFinite(video.duration) && video.buffered.end(video.buffered.length - 1) >= video.duration - 0.5;
      const paused = () => { if (ours) { ours = false; return; } stopped = true; };
      const resumed = () => { stopped = false; };
      const release = () => { holding = false; void video.play().catch(() => {}); };
      const settle = () => {
        if (disposed || !holding) return;
        if (stopped) { holding = false; return; }
        const now = ahead();
        if (now >= CUSHION || complete() || Date.now() - startedAt >= MAX_HOLD_MS) { release(); return; }
        flat = now <= lastAhead + 0.05 ? flat + 1 : 0;
        lastAhead = now;
        if (flat >= 4) { release(); return; } // the provider cannot even sustain the wait; playing is no worse
        later(settle, 500);
      };
      const hold = () => {
        if (!big || playback.live || disposed || holding || stopped || video.currentTime <= 0 || complete()) return;
        holding = true; ours = true; startedAt = Date.now(); lastAhead = ahead(); flat = 0; video.pause(); later(settle, 500);
      };
      if (big && !playback.live) { video.addEventListener('waiting', hold); video.addEventListener('pause', paused); video.addEventListener('play', resumed); }
      video.addEventListener('error', failed);
      start(playback.at || 0);
      return () => { stop(); video.removeEventListener('error', failed); video.removeEventListener('waiting', hold); video.removeEventListener('pause', paused); video.removeEventListener('play', resumed); video.pause(); video.removeAttribute('src'); video.load(); };
    }
    if (Hls.isSupported()) {
      let hls: Hls | undefined;
      const start = () => {
        hls?.destroy();
        hls = new Hls({
          enableWorker: true, debug: false, startFragPrefetch: true,
          backBufferLength: playback.live ? 10 : 30,
          maxBufferLength: playback.live ? 30 : 60, maxMaxBufferLength: 120,
          // 4K segments are large: the 60 MB default caps the buffer at a few seconds and every
          // jitter becomes a stall. Chromium evicts if a source buffer really fills up.
          maxBufferSize: 120 * 1000 * 1000,
          // On a live stream the cushion is however far back from the live edge playback starts:
          // you cannot buffer past what has aired. Sitting further back is the whole difference
          // between a player that rides out a slow segment and one that shows a spinner.
          liveSyncDurationCount: big ? 7 : 4, liveMaxLatencyDurationCount: big ? 20 : 12,
          manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 6
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || disposed) return;
          const fail = () => { onError('Yayın açılamadı. Bağlantıyı, hesap sınırını ve H.264/AAC desteğini kontrol edip yeniden deneyin.'); hls?.destroy(); hls = undefined; };
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { if (!again(() => hls?.startLoad())) fail(); }
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { if (!again(() => hls?.recoverMediaError())) fail(); }
          else fail();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => { if (!disposed) onError('Oynat düğmesine basarak yayını başlatın.'); }); });
        hls.loadSource(playback.url); hls.attachMedia(video);
      };
      start();
      return () => { stop(); hls?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); };
    }
    video.src = playback.url; video.load();
    void video.play().catch(() => { if (!disposed) onError('Oynat düğmesine basarak yayını başlatın.'); });
    return () => { stop(); video.pause(); video.removeAttribute('src'); video.load(); };
  },
  exit() { window.close(); }
};
