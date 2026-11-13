// Every dub and subtitle inside a film's own file, in a real Electron window: a Matroska film with an AAC
// dub, a 5.1 E-AC-3 dub Chromium cannot decode and two text subtitles lists all four with their names;
// choosing the E-AC-3 dub plays it through the converter (its own 880 Hz tone is what the page hears),
// keeps the place in the film, survives a seek back outside what is buffered, and going back to the AAC
// dub returns to the plain file; the file's subtitles show at the right moment; the dub chosen last is
// where the next window starts; an episode with only E-AC-3 sound is no longer silent. No provider
// account or media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ mkv: true });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-embedded-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;

async function open() {
  const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => console.error('page error:', error.message));
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect(page.getByRole('button', { name: 'Tüm içerikler', exact: true })).toBeVisible();
  return { app, page };
}
type State = { src: string; time: number; audioBytes: number; enabled: boolean[]; buffered: number[][]; paused: boolean };
const state = (page: Page): Promise<State> => page.locator('video').evaluate((v: HTMLVideoElement & { audioTracks?: ArrayLike<{ enabled: boolean }>; webkitAudioDecodedByteCount?: number }) => ({
  src: v.currentSrc || v.src, time: v.currentTime, audioBytes: v.webkitAudioDecodedByteCount || 0, enabled: Array.from(v.audioTracks || []).map(t => t.enabled),
  buffered: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]), paused: v.paused
}));
// The loudest frequency in what the element plays. Only a converted film can be measured: its data reaches
// the page through fetch, while the plain file is a cross-origin stream Web Audio hears as silence.
const tone = (page: Page) => page.locator('video').evaluate(async (v: HTMLVideoElement) => {
  const w = v as unknown as { probe?: { ctx: AudioContext; analyser: AnalyserNode } }; // one per element: a new title gets a new one
  if (!w.probe) { const ctx = new AudioContext(), analyser = ctx.createAnalyser(); analyser.fftSize = 8192; ctx.createMediaElementSource(v).connect(analyser); analyser.connect(ctx.destination); w.probe = { ctx, analyser }; }
  await w.probe.ctx.resume(); await new Promise(resolve => setTimeout(resolve, 700));
  const bins = new Float32Array(w.probe.analyser.frequencyBinCount); w.probe.analyser.getFloatFrequencyData(bins);
  let best = 1; for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  return best * w.probe.ctx.sampleRate / w.probe.analyser.fftSize;
});
const advancing = async (page: Page, timeout = 20000) => { const before = await state(page); await expect.poll(async () => { const now = await state(page); return now.time > before.time + 1 && now.audioBytes > before.audioBytes; }, { timeout }).toBe(true); };
const menu = (page: Page) => page.getByRole('group', { name: 'Ses ve altyazı' });
const audio = (page: Page) => menu(page).getByRole('radiogroup', { name: 'Ses' });
const subtitles = (page: Page) => menu(page).getByRole('radiogroup', { name: 'Altyazı' });
const openMenu = async (page: Page) => { if (await menu(page).count()) return; await page.getByRole('button', { name: 'Ses ve altyazı', exact: true }).click(); await expect(menu(page)).toBeVisible(); };
const active = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => Array.from(v.textTracks).filter(t => t.mode === 'showing').flatMap(t => Array.from(t.activeCues || []).map(c => (c as VTTCue).text)));
const jump = (page: Page, seconds: number) => page.locator('video').evaluate((v: HTMLVideoElement, s: number) => { v.currentTime = s; }, seconds);
const playFilm = async (page: Page) => {
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
  await page.getByRole('button', { name: /Filmi oynat|Kaldığın yerden/ }).first().click();
  await expect.poll(async () => (await state(page)).time, { timeout: 25000 }).toBeGreaterThan(0.5);
};
const converted = (s: State) => s.src.startsWith('blob:');
const near = (value: number, target: number, within: number) => Math.abs(value - target) <= within;

try {
  {
    const { app, page } = await open();
    try {
      await playFilm(page);
      await openMenu(page);
      // All four tracks, named the way the file names them; the file's default dub is the one playing.
      await expect(audio(page).getByRole('radio')).toHaveText(['İngilizce', 'Türkçe · Dublaj · 5.1']);
      await expect(audio(page).getByRole('radio', { name: 'İngilizce' })).toBeChecked();
      await expect(subtitles(page).getByRole('radio')).toHaveText(['Kapalı', 'İngilizce · SDH', 'Türkçe']);
      await expect(subtitles(page).getByRole('radio', { name: 'Kapalı' })).toBeChecked();
      await expect(menu(page)).toContainText('AAC’ye çevrilir');
      expect(converted(await state(page))).toBe(false);
      await page.screenshot({ path: 'test-results/embedded-menu.png' });

      // The E-AC-3 dub: the converter takes over where the film is, and its own tone is what plays.
      await expect.poll(async () => (await state(page)).time, { timeout: 15000 }).toBeGreaterThan(3);
      const before = await state(page);
      await audio(page).getByRole('radio', { name: 'Türkçe · Dublaj · 5.1' }).click();
      await expect.poll(async () => converted(await state(page)), { timeout: 15000 }).toBe(true);
      await openMenu(page);
      await expect(audio(page).getByRole('radio', { name: 'Türkçe · Dublaj · 5.1' })).toBeChecked();
      await advancing(page);
      const after = await state(page);
      // The file's own timestamps: the converted stream sits where the film was, not back at zero.
      expect(after.time).toBeGreaterThan(before.time - 1);
      expect(after.buffered[0][0]).toBeGreaterThan(before.time - 3);
      expect(near(await tone(page), 880, 15)).toBe(true);
      await expect(page.getByRole('alert')).toHaveCount(0);

      // Back to before where the conversion started: a new conversion from there, same dub.
      await jump(page, 0.5);
      await expect.poll(async () => { const s = await state(page); return s.buffered.length > 0 && s.buffered[0][0] < 1 && s.time > 1; }, { timeout: 20000 }).toBe(true);
      await advancing(page);
      expect(near(await tone(page), 880, 15)).toBe(true);

      // The file's subtitles: on at the right moment, in either language, while converting.
      await openMenu(page);
      await subtitles(page).getByRole('radio', { name: 'Türkçe' }).click();
      await expect(subtitles(page).getByRole('radio', { name: 'Türkçe' })).toBeChecked();
      await jump(page, 10.5);
      await expect.poll(() => active(page), { timeout: 15000 }).toEqual(['Çok güzel bir gün']);
      await page.screenshot({ path: 'test-results/embedded-subtitle.png' });
      await subtitles(page).getByRole('radio', { name: 'İngilizce · SDH' }).click();
      await jump(page, 9.5);
      await expect.poll(() => active(page), { timeout: 15000 }).toEqual(['Hello two']);
      await subtitles(page).getByRole('radio', { name: 'Kapalı' }).click();
      await expect.poll(() => active(page)).toEqual([]);

      // Back to the AAC dub: the plain file again, from where the film was.
      const at = (await state(page)).time;
      await audio(page).getByRole('radio', { name: 'İngilizce' }).click();
      await expect.poll(async () => { const s = await state(page); return !converted(s) && s.enabled.join() === 'true' && s.time > at - 1; }, { timeout: 20000 }).toBe(true);
      await advancing(page);
      await openMenu(page);
      await expect(audio(page).getByRole('radio', { name: 'İngilizce' })).toBeChecked();

      // Turkish again, and that is what is remembered.
      await audio(page).getByRole('radio', { name: 'Türkçe · Dublaj · 5.1' }).click();
      await expect.poll(async () => converted(await state(page)), { timeout: 15000 }).toBe(true);
      await advancing(page);
      await page.waitForTimeout(900); // preferences are saved on a short debounce
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
    } finally { await app.close(); }
  }
  const library = JSON.parse(await readFile(path.join(data, (await readdir(data)).find(name => /^library-[a-f0-9]{24}\.json$/.test(name))!), 'utf8'));
  expect(library.preferences.audio).toBe('tr');
  {
    const { app, page } = await open();
    try {
      // A new window: the Turkish dub is chosen by itself, which means the converter.
      await playFilm(page);
      await expect.poll(async () => converted(await state(page)), { timeout: 15000 }).toBe(true);
      await advancing(page);
      await openMenu(page);
      await expect(audio(page).getByRole('radio', { name: 'Türkçe · Dublaj · 5.1' })).toBeChecked();
      expect(near(await tone(page), 880, 15)).toBe(true);
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();

      // An episode with nothing but E-AC-3 sound: it used to play without sound; now it is converted.
      await page.getByRole('button', { name: 'Diziler', exact: true }).click();
      await page.getByRole('button', { name: 'Test dizisi', exact: true }).click();
      await page.getByRole('button', { name: /^\d+ Birinci test/ }).click();
      await expect.poll(async () => converted(await state(page)), { timeout: 20000 }).toBe(true);
      await advancing(page);
      await expect.poll(async () => near(await tone(page), 660, 15), { timeout: 10000 }).toBe(true);
      await openMenu(page);
      await expect(audio(page).getByRole('radio')).toHaveText(['Almanca']);
      await expect(audio(page).getByRole('radio', { name: 'Almanca' })).toBeChecked();
      await expect(subtitles(page).getByRole('radio')).toHaveText(['Kapalı']);
      await expect(menu(page)).toContainText('gösterilebilecek altyazı yok');
      await page.screenshot({ path: 'test-results/embedded-episode.png' });
    } finally { await app.close(); }
  }
  console.log('PASS: Dosyadaki bütün dublajlar ve altyazılar: MKV filmde AAC ve E-AC-3 5.1 dublaj ile iki altyazı adlarıyla listelenir, E-AC-3 dublaj dönüştürülerek kendi sesiyle (880 Hz) ve filmin yerinde çalar, tamponun dışına geri sarma yeni dönüşüm başlatır, dosyadaki altyazılar doğru anda çıkar, AAC dublaja dönünce düz dosyaya geçilir, son seçilen dublaj yeni pencerede kendiliğinden seçilir, yalnızca E-AC-3 sesli bölüm artık sessiz değil');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
