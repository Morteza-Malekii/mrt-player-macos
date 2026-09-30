import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { randomBytes, pbkdf2, createCipheriv, createDecipheriv } from 'crypto';
import type { Credentials, Library } from '../core/models';
import type { LibraryStore, Vault } from './session';
import { AppError } from '../core/errors';
import { normalizeLibrary } from '../core/library';
const readFile = promisify(fs.readFile), writeFile = promisify(fs.writeFile), rename = promisify(fs.rename), unlink = promisify(fs.unlink), stat = promisify(fs.stat), readdir = promisify(fs.readdir);
export async function ensureDirectory(dir: string): Promise<void> {
  try { await promisify(fs.mkdir)(dir, 0o700); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
}
export async function atomicWrite(file: string, contents: Buffer | string): Promise<void> {
  await ensureDirectory(path.dirname(file));
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try { await writeFile(temporary, contents, { mode: 0o600 }); await rename(temporary, file); }
  finally { try { await unlink(temporary); } catch {} }
}
export async function exists(file: string): Promise<boolean> { try { return (await stat(file)).isFile(); } catch { return false; } }
export async function remove(file: string): Promise<void> { try { await unlink(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
export class FileLibraryStore implements LibraryStore {
  constructor(private dir: string) {}
  async read(profile: string): Promise<Library> {
    try { return normalizeLibrary(JSON.parse(await readFile(this.file(profile), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return normalizeLibrary({}); throw new AppError('STORAGE', 'Yerel kitaplık okunamadı. Disk veya kayıt verisini kontrol edin.'); }
  }
  async write(profile: string, library: Library): Promise<void> { try { await atomicWrite(this.file(profile), JSON.stringify(normalizeLibrary(library))); } catch { throw new AppError('STORAGE', 'Yerel ayarlar kaydedilemedi. Boş disk alanını kontrol edin.'); } }
  async clear(): Promise<void> {
    try {
      for (const name of await readdir(this.dir)) if (/^library-[a-f0-9]{24}\.json$/.test(name)) await remove(path.join(this.dir, name));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('STORAGE', 'Yerel favoriler ve geçmiş silinemedi.'); }
  }
  private file(profile: string) { if (!/^[a-f0-9]{24}$/.test(profile)) throw new AppError('PROFILE', 'Geçersiz profil.'); return path.join(this.dir, `library-${profile}.json`); }
}
// Node 8 compatible; passphrase is never persisted. Authenticated encryption rejects tampering.
export class PassphraseVault implements Vault {
  constructor(private file: string) {}
  exists() { return exists(this.file); }
  clear() { return remove(this.file); }
  async save(credentials: Credentials, passphrase?: string) {
    if (!passphrase || passphrase.length < 10 || passphrase.length > 512) throw new AppError('PASSPHRASE', 'Kilit parolası en az 10 karakter olmalı.');
    const salt = randomBytes(32), iv = randomBytes(12);
    const key = await promisify(pbkdf2)(passphrase, salt, 600000, 32, 'sha256');
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
      await atomicWrite(this.file, JSON.stringify({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
    } finally { key.fill(0); }
  }
  async load(passphrase?: string): Promise<Credentials> {
    if (!passphrase || passphrase.length > 512) throw new AppError('PASSPHRASE', 'Kilit parolasını girin.');
    let key: Buffer | undefined;
    try {
      const envelope = JSON.parse(await readFile(this.file, 'utf8'));
      if (envelope.v !== 1) throw new Error();
      const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
      if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error();
      key = await promisify(pbkdf2)(passphrase, salt, 600000, 32, 'sha256');
      const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString('utf8'));
    } catch { throw new AppError('VAULT', 'Kilit parolası yanlış veya güvenli kayıt okunamıyor.'); }
    finally { key?.fill(0); }
  }
}
