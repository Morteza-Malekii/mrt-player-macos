import { useState } from 'react';
import type { Item, Platform, Playback, SubtitleFile, SubtitleHit, SubtitleSearchResult } from '../core/models';
import { SUBTITLE_LANGUAGE_NAMES } from '../core/subtitles';
// The button at the bottom of the player's subtitle menu: looks the film up on the internet (the privileged side
// does the asking, see platform/mac/subtitles.ts), lists what it finds in English, Persian and Turkish, and hands the
// one the viewer picks to the player as a file, as if they had loaded it themselves.
const PROVIDER = { opensubtitles: 'OpenSubtitles', subdl: 'SubDL' };
const count = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} B` : String(n);
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
export function SubtitleSearch({ platform, item, playback, onStart, onPick }: { platform: Platform; item: Item; playback: Playback; onStart(): void; onPick(name: string, bytes: Uint8Array): void }) {
  const [phase, setPhase] = useState<'idle' | 'searching' | 'done'>('idle'), [hits, setHits] = useState<SubtitleHit[]>([]), [notes, setNotes] = useState<string[]>([]), [error, setError] = useState(''), [getting, setGetting] = useState('');
  async function search() {
    onStart(); setPhase('searching'); setError(''); setNotes([]); setHits([]);
    try {
      const result = await platform.call<SubtitleSearchResult>('subtitleSearch', { kind: item.kind, id: item.id, name: item.name, series: item.series, seriesId: item.seriesId, season: item.season, episode: item.episode, url: playback.url, local: playback.local === true });
      setHits(result.hits); setNotes(result.notes); setPhase('done');
    } catch (e) { setError((e as Error).message || 'Altyazı aranamadı.'); setPhase('idle'); }
  }
  async function choose(hit: SubtitleHit) {
    setGetting(hit.id); setError('');
    try { const file = await platform.call<SubtitleFile>('subtitleGet', { id: hit.id }); onPick(file.name, bytesOf(file.data)); }
    catch (e) { setError((e as Error).message || 'Altyazı indirilemedi.'); }
    finally { setGetting(''); }
  }
  return <div className="subtitle-search">
    <button className="track-load" disabled={phase === 'searching'} onClick={() => void search()}>{phase === 'searching' ? 'Aranıyor…' : phase === 'done' ? 'Yeniden ara' : 'İnternette altyazı ara'}</button>
    {error && <div className="error" role="alert">{error}</div>}
    {phase === 'done' && <>
      {hits.length > 0 && <div className="subtitle-hits" role="list" aria-label="Bulunan altyazılar">{hits.map((hit, i) => <div role="listitem" key={hit.id}>
        {(i === 0 || hits[i - 1].language !== hit.language) && <div className="subtitle-language">{SUBTITLE_LANGUAGE_NAMES[hit.language]}</div>}
        <button className="track-option subtitle-hit" disabled={!!getting} title={hit.release} onClick={() => void choose(hit)}>
          <span className="subtitle-release">{getting === hit.id ? 'İndiriliyor… ' : ''}{hit.release || 'Adsız sürüm'}</span>
          <span className="subtitle-meta">{PROVIDER[hit.provider]}{hit.hash && <b className="subtitle-exact">Bu dosyaya uygun</b>}{hit.hearingImpaired && ' · işitme engelli'}{hit.trusted && ' · güvenilir'}{hit.downloads > 0 && ` · ${count(hit.downloads)} indirme`}</span>
        </button></div>)}</div>}
      {notes.map(note => <small key={note} className="subtitle-note">{note}</small>)}
      {hits.length > 0 && <small>“Bu dosyaya uygun” etiketi, servisin altyazıyı tam bu dosya için kaydettiğini gösterir. Diğerleri adı ve sürümü benzer olanlardır.</small>}
    </>}
  </div>;
}
