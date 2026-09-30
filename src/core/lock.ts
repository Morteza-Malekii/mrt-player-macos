import type { Item, Kind, Library, Locks, PinRecord, Visibility } from './models';
// A PIN is a short number, so hashing only slows guessing down; it does not make four digits
// strong. The aim is to keep a child or a housemate out of a list, not to defend the library
// file against someone who can copy it.
const ITERATIONS = 150_000;
export const validPin = (pin: string) => /^\d{4,8}$/.test(pin);
export const lockKey = (kind: Kind, categoryId: string) => `${kind}:${categoryId}`;
export const isLockedItem = (locks: Locks, item: Pick<Item, 'kind' | 'categoryId'>) => locks.categories.includes(lockKey(item.kind, item.categoryId));
export const categoryState = (library: Pick<Library, 'locks' | 'hidden'>, kind: Kind, categoryId: string): Visibility => {
  const key = lockKey(kind, categoryId);
  return library.hidden.includes(key) ? 'hidden' : library.locks.categories.includes(key) ? 'locked' : 'shown';
};
// The same category, told as a change to a library: one state per category, never two.
export function withCategoryState(library: Library, kind: Kind, categoryId: string, to: Visibility, pin?: PinRecord): Library {
  const key = lockKey(kind, categoryId), without = (list: string[]) => list.filter(k => k !== key);
  return { ...library, hidden: to === 'hidden' ? [...without(library.hidden), key] : without(library.hidden), locks: { pin: pin ?? library.locks.pin, categories: to === 'locked' ? [...without(library.locks.categories), key] : without(library.locks.categories) } };
}
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function derive(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256));
}
export async function makePin(pin: string): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: toBase64(await derive(pin, salt)) };
}
export async function checkPin(pin: string, record: PinRecord): Promise<boolean> {
  if (!validPin(pin)) return false;
  const expected = fromBase64(record.hash), actual = await derive(pin, fromBase64(record.salt));
  let difference = expected.length ^ actual.length;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ (expected[i] ?? 0);
  return difference === 0;
}
