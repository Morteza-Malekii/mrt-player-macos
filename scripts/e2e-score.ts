// The score filter on the Filmler list: it keeps films scoring at least the chosen value, drops the
// unscored ones while it is on, is absent on Canlı TV, and "Hepsi" brings everything back.
// No provider account or media is used.
import { _electron as electron, expect } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ scores: true });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-score-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
try {
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect(page.getByRole('button', { name: 'Tüm içerikler', exact: true })).toBeVisible();
  await expect(page.getByLabel('Puana göre süz')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  const card = (name: string) => page.getByRole('button', { name, exact: true });
  for (const name of ['Skorlu A', 'Skorlu B', 'Skorlu C', 'Skorlu D']) await expect(card(name)).toBeVisible();
  await page.getByLabel('Puana göre süz').selectOption('7');
  await expect(card('Skorlu A')).toBeVisible(); await expect(card('Skorlu B')).toBeVisible();
  await expect(card('Skorlu C')).toHaveCount(0); await expect(card('Skorlu D')).toHaveCount(0);
  await page.getByLabel('Puana göre süz').selectOption('9');
  await expect(card('Skorlu A')).toBeVisible(); await expect(card('Skorlu B')).toHaveCount(0);
  await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
  await expect(page.getByLabel('Puana göre süz')).toHaveCount(0);
  await expect(page.getByText('Sonuç bulunamadı')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  await page.getByLabel('Puana göre süz').selectOption('0');
  for (const name of ['Skorlu A', 'Skorlu B', 'Skorlu C', 'Skorlu D']) await expect(card(name)).toBeVisible();
  console.log('Puan süzgeci denetimleri geçti.');
} finally { await app.close(); await fixture.close(); await rm(data, { recursive: true, force: true }); }
