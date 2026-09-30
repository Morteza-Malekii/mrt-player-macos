import { useEffect, useState, type RefObject, type MutableRefObject } from 'react';
import type { MediaStats, Platform, Playback } from '../core/models';

export interface PlaybackTimings {
  startedAt: number;
  firstFrameAt?: number;
  stalls: number;
  bufferingMs: number;
  bufferingStartedAt?: number;
}

export function PlaybackStats({ platform, video, playback, timings }: { platform: Platform; video: RefObject<HTMLVideoElement>; playback: Playback; timings: MutableRefObject<PlaybackTimings> }) {
  const [sample, setSample] = useState({ width: 0, height: 0, ahead: undefined as number | undefined, dropped: undefined as number | undefined, total: undefined as number | undefined, now: performance.now(), audioBytes: undefined as number | undefined, videoBytes: undefined as number | undefined, playing: 0 });
  const [network, setNetwork] = useState<{ mbps?: number; media?: MediaStats }>({});
  useEffect(() => {
    let previous: { at: number; delivered: number } | undefined;
    const update = async () => {
      const v = video.current;
      if (!v) return;
      let ahead: number | undefined;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.currentTime >= v.buffered.start(i) - 0.1 && v.currentTime <= v.buffered.end(i)) { ahead = Math.max(0, v.buffered.end(i) - v.currentTime); break; }
      }
      const quality = v.getVideoPlaybackQuality?.();
      // Decoded byte counters are the quickest honest answer to "can this Mac play this
      // stream at all": a track that stays on zero while the other one moves is a codec the
      // browser has no decoder for, which is silence or a stall rather than a network fault.
      const counted = v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
      setSample({ width: v.videoWidth, height: v.videoHeight, ahead, dropped: quality?.droppedVideoFrames, total: quality?.totalVideoFrames, now: performance.now(), audioBytes: counted.webkitAudioDecodedByteCount, videoBytes: counted.webkitVideoDecodedByteCount, playing: v.currentTime });
      // Rate is derived from two readings of the same counter, so a slow provider shows up as
      // a low number even while the picture is still running off the buffer.
      const media = await platform.call<MediaStats | null>('mediaStats').catch(() => null);
      if (!media) return;
      const at = performance.now();
      const mbps = previous && at > previous.at ? (media.delivered - previous.delivered) * 8 / 1e6 / ((at - previous.at) / 1000) : undefined;
      previous = { at, delivered: media.delivered };
      setNetwork({ mbps, media });
    };
    void update();
    const timer = setInterval(() => void update(), 1000);
    return () => clearInterval(timer);
  }, [platform, video, playback]);
  const t = timings.current;
  const bufferingMs = t.bufferingMs + (t.bufferingStartedAt ? sample.now - t.bufferingStartedAt : 0);
  const source = playback.format === 'ts' ? 'MPEG-TS' : playback.format === 'hls' ? playback.engine === 'js' ? 'HLS uyumluluk' : 'Yerel HLS' : 'Dosya';
  return <div className="playback-stats" aria-label="Akış bilgileri">
    <strong>Akış bilgileri</strong>
    <dl>
      <div><dt>Oynatıcı</dt><dd>{source}</dd></div>
      <div><dt>Çözünürlük</dt><dd>{sample.width ? `${sample.width}×${sample.height}` : 'Bekleniyor'}</dd></div>
      <div><dt>Ön tampon</dt><dd>{sample.ahead === undefined ? 'Ölçülemiyor' : `${sample.ahead.toFixed(1)} sn`}</dd></div>
      <div><dt>Atlanan kare</dt><dd>{sample.dropped === undefined ? 'Ölçülemiyor' : `${sample.dropped}/${sample.total || 0}`}</dd></div>
      <div><dt>İlk görüntü</dt><dd>{t.firstFrameAt === undefined ? 'Bekleniyor' : `${((t.firstFrameAt - t.startedAt) / 1000).toFixed(1)} sn`}</dd></div>
      <div><dt>Kesinti</dt><dd>{t.stalls} kez · {(bufferingMs / 1000).toFixed(1)} sn</dd></div>
      <div><dt>Ses çözümü</dt><dd>{sample.audioBytes === undefined ? 'Ölçülemiyor' : sample.audioBytes > 0 ? `${Math.round(sample.audioBytes / 1024)} KB çözüldü` : sample.playing > 1 ? 'Yok · codec desteklenmiyor' : 'Bekleniyor'}</dd></div>
      <div><dt>Görüntü çözümü</dt><dd>{sample.videoBytes === undefined ? 'Ölçülemiyor' : sample.videoBytes > 0 ? `${Math.round(sample.videoBytes / 1024)} KB çözüldü` : sample.playing > 1 ? 'Yok · codec desteklenmiyor' : 'Bekleniyor'}</dd></div>
      {network.media && <>
        <div><dt>Sunucu hızı</dt><dd>{network.mbps === undefined ? 'Ölçülüyor' : `${network.mbps.toFixed(1)} Mbps`}</dd></div>
        <div><dt>En yüksek hız</dt><dd>{network.media.peakBps > 0 ? `${(network.media.peakBps * 8 / 1e6).toFixed(1)} Mbps` : 'Ölçülüyor'}</dd></div>
        <div><dt>Açık bağlantı</dt><dd>{network.media.open}</dd></div>
        <div><dt>En yavaş yanıt</dt><dd>{(network.media.slowestMs / 1000).toFixed(1)} sn</dd></div>
        <div><dt>Sunucu hatası</dt><dd>{network.media.failures} / {network.media.requests} istek{network.media.failures > 0 ? ` · son kod ${network.media.lastStatus}` : ''}</dd></div>
        <div><dt>Kurtarılan istek</dt><dd>{network.media.retries}</dd></div>
      </>}
    </dl>
    <small>Bu bilgiler yalnızca ekranda görünür; hesap ve yayın adresi gösterilmez.</small>
  </div>;
}
