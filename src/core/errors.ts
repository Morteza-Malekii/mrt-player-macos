export class AppError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'AppError'; }
}
export function publicError(error: unknown): { code: string; message: string } {
  return error instanceof AppError ? { code: error.code, message: error.message } : { code: 'INTERNAL', message: 'İşlem tamamlanamadı. Lütfen yeniden deneyin.' };
}
export const invalid = () => new AppError('INVALID', 'Girilen bilgileri kontrol edin.');
export function object(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
export const text = (value: unknown, max = 1000): string => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
export function id(value: unknown): string { const s = text(value, 50); if (!/^\d{1,20}$/.test(s)) throw invalid(); return s; }
