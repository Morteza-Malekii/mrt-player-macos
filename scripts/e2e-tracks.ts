// Dubs and subtitles for films and episodes: a file with two audio languages lists both in the
// player's "Ses ve altyazı" menu, switching moves the enabled track and the decoder keeps reading
// (which track is audible is not measured here; a frequency probe outside the app showed it), the language chosen
// last is picked again by the next film, episode and window, and a subtitle file the viewer loads
// shows over the picture (Turkish and Persian text, odd encodings), can be turned off and on, and
// a bad file is refused. Escape closes the menu before it stops the player. No provider account or
// media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ dubs: true });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-tracks-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const files = path.join(data, 'files');
await mkdir(files); await mkdir('test-results', { recursive: true });
// First cue is on screen from the start, the second (Persian) later; a Turkish file saved the way old
// tools do (windows-1254) is loaded too, to prove the page decodes it.
const srt = path.join(files, 'altyazi.srt'), old = path.join(files, 'eski.srt'), junk = path.join(files, 'degil.srt');
await writeFile(srt, '1\n00:00:00,200 --> 00:00:05,000\nMerhaba dünya\n\n2\n00:00:05,200 --> 00:00:11,000\nسلام دنیا، حال شما چطور است؟\n');
await writeFile(old, Buffer.from('310a30303a30303a30302c323030202d2d3e2030303a30303a31312c3030300ac76f6b2067fc7a656c206269722067fc6e2c20f6f072656e636920fe696d64692067656c64692e0a', 'hex'));
await writeFile(junk, 'bu bir altyazı dosyası değil\n');

async function open() {
  const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect(page.getByRole('button', { name: 'Tüm içerikler', exact: true })).toBeVisible();
  return { app, page };
}
type Probe = { enabled: boolean[]; languages: string[]; time: number; audioBytes: number };
const probe = (page: Page): Promise<Probe> => page.locator('video').evaluate((v: HTMLVideoElement & { audioTracks?: ArrayLike<{ enabled: boolean; language: string }>; webkitAudioDecodedByteCount?: number }) => ({ enabled: Array.from(v.audioTracks || []).map(t => t.enabled), languages: Array.from(v.audioTracks || []).map(t => t.language), time: v.currentTime, audioBytes: v.webkitAudioDecodedByteCount || 0 }));
const playing = (page: Page) => expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5);
const playFilm = async (page: Page) => {
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
  await page.getByRole('button', { name: 'Filmi oynat' }).click();
  await playing(page);
};
const menu = (page: Page) => page.getByRole('group', { name: 'Ses ve altyazı' });
const openMenu = async (page: Page) => { await page.getByRole('button', { name: 'Ses ve altyazı', exact: true }).click(); await expect(menu(page)).toBeVisible(); };
const saved = (page: Page) => page.waitForTimeout(900); // preferences are saved on a short debounce
const cues = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => Array.from(v.textTracks).map(t => ({ mode: t.mode, count: t.cues ? t.cues.length : -1, active: Array.from(t.activeCues || []).map(c => (c as VTTCue).text) })));

try {
  {
    const { app, page } = await open();
    try {
      await playFilm(page);
      // Both languages are listed and the file's own first track is the one playing.
      await openMenu(page);
      await expect(menu(page).getByRole('radio', { name: 'İngilizce' })).toBeChecked();
      await expect(menu(page).getByRole('radio', { name: 'Türkçe' })).not.toBeChecked();
      expect(await probe(page).then(p => p.languages)).toEqual(['eng', 'tur']);
      // The menu is an overlay of the player, in front of the picture and inside the window.
      const box = await menu(page).boundingBox(), area = await page.locator('.player').boundingBox();
      expect(box && area && box.x >= area.x && box.y >= area.y && box.x + box.width <= area.x + area.width + 1 && box.y + box.height <= area.y + area.height + 1).toBe(true);

      // Switching to the Turkish dub moves the enabled flag, and audio bytes keep being decoded
      // after the switch while the picture keeps moving: it did not go silent or stall.
      const before = await probe(page);
      await menu(page).getByRole('radio', { name: 'Türkçe' }).click();
      await expect(menu(page).getByRole('radio', { name: 'Türkçe' })).toBeChecked();
      await expect(menu(page).getByRole('radio', { name: 'İngilizce' })).not.toBeChecked();
      await expect.poll(async () => (await probe(page)).enabled).toEqual([false, true]);
      await expect.poll(async () => { const p = await probe(page); return p.audioBytes > before.audioBytes && p.time > before.time + 1; }, { timeout: 15000 }).toBe(true);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await saved(page);
      await page.screenshot({ path: 'test-results/tracks-menu.png' });

      // A subtitle file: Turkish text over the picture, listed by its file name and checked.
      await expect(menu(page).getByRole('radio', { name: 'Kapalı' })).toBeChecked();
      await page.getByLabel('Altyazı dosyası', { exact: true }).setInputFiles(srt);
      await expect(menu(page)).toHaveCount(0); // the menu gets out of the way so the picture shows
      await expect.poll(() => cues(page)).toEqual([{ mode: 'showing', count: 2, active: expect.any(Array) }]);
      await page.getByRole('button', { name: 'Duraklat', exact: true }).click();
      await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
      await expect.poll(async () => (await cues(page))[0].active).toEqual(['Merhaba dünya']);
      await page.screenshot({ path: 'test-results/tracks-subtitle-tr.png' });
      await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 6; });
      await expect.poll(async () => (await cues(page))[0].active).toEqual(['سلام دنیا، حال شما چطور است؟']);
      await page.screenshot({ path: 'test-results/tracks-subtitle-fa.png' });

      // Off and on again from the menu; the cues stay loaded.
      await openMenu(page);
      await expect(menu(page).getByRole('radio', { name: 'altyazi.srt' })).toBeChecked();
      await menu(page).getByRole('radio', { name: 'Kapalı' }).click();
      await expect.poll(async () => (await cues(page))[0].mode).toBe('hidden');
      await menu(page).getByRole('radio', { name: 'altyazi.srt' }).click();
      await expect.poll(async () => (await cues(page))[0].mode).toBe('showing');

      // A second file replaces the first one rather than stacking up; a file in an old Turkish
      // code page reads right; a file with no cues in it is refused and leaves the old one alone.
      await expect(menu(page)).toBeVisible(); // choosing an option does not close the menu; loading a file does
      await page.getByLabel('Altyazı dosyası', { exact: true }).setInputFiles(old);
      await expect.poll(async () => { const c = await cues(page); return c.length === 1 && c[0].count === 1; }).toBe(true);
      await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 2; });
      await expect.poll(async () => (await cues(page))[0].active).toEqual(['Çok güzel bir gün, öğrenci şimdi geldi.']);
      await openMenu(page);
      await expect(menu(page).getByRole('radio', { name: 'eski.srt' })).toBeChecked();
      await page.getByLabel('Altyazı dosyası', { exact: true }).setInputFiles(junk);
      await expect(menu(page).getByRole('alert')).toContainText('Dosyada altyazı bulunamadı');
      await expect(menu(page).getByRole('radio', { name: 'eski.srt' })).toBeChecked();
      expect((await cues(page))[0].count).toBe(1);

      // Escape closes the menu first and only then the player.
      await page.keyboard.press('Escape');
      await expect(menu(page)).toHaveCount(0);
      await expect(page.locator('video')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.locator('video')).toHaveCount(0);
    } finally { await app.close(); }
  }
  const library = JSON.parse(await readFile(path.join(data, (await readdir(data)).find(name => /^library-[a-f0-9]{24}\.json$/.test(name))!), 'utf8'));
  // What is kept is the language, not a track number or a file name.
  expect(library.preferences.audio).toBe('tr');
  expect(JSON.stringify(library)).not.toContain('altyazi');
  {
    // A new window: the Turkish dub is chosen by itself, for a film and for an episode alike.
    const { app, page } = await open();
    try {
      await playFilm(page);
      await expect.poll(async () => (await probe(page)).enabled).toEqual([false, true]);
      await openMenu(page);
      await expect(menu(page).getByRole('radio', { name: 'Türkçe' })).toBeChecked();
      // Nothing carries over for subtitles: a new film starts without them.
      await expect(menu(page).getByRole('radio', { name: 'Kapalı' })).toBeChecked();
      expect(await cues(page)).toEqual([]);
      // Back to English by choice, and that is what the next title follows.
      await menu(page).getByRole('radio', { name: 'İngilizce' }).click();
      await expect.poll(async () => (await probe(page)).enabled).toEqual([true, false]);
      await saved(page);
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
      await page.getByRole('button', { name: 'Diziler', exact: true }).click();
      await page.getByRole('button', { name: 'Test dizisi', exact: true }).click();
      await page.getByRole('button', { name: /Birinci test/ }).click();
      await playing(page);
      await expect.poll(async () => (await probe(page)).enabled).toEqual([true, false]);
      // Live TV has no dubs or subtitles to choose, so it has no such button.
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
      await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
      await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
      await playing(page);
      await expect(page.getByRole('button', { name: 'Ses ve altyazı', exact: true })).toHaveCount(0);
    } finally { await app.close(); }
  }
  console.log('PASS: Ses ve altyazı: iki dilli dosyada iki ses listelenir ve geçiş çözülen sesi değiştirir, son seçilen dil film ve bölümde kendiliğinden seçilir, altyazı dosyası (UTF-8, windows-1254, Farsça) görüntü üstünde çıkar, kapanıp açılır, yenisi eskisinin yerine geçer, bozuk dosya reddedilir, Escape önce menüyü kapatır, canlı yayında düğme yok');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
