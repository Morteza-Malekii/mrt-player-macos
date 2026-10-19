// A file size the way the Finder writes it (decimal units), short enough for a button label.
export const bytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
// 3725 s -> "1:02:05": how long a recording has run.
export const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
// The value a datetime-local field wants (local time, to the minute), and back.
export const toLocalInput = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (value: string) => new Date(value).getTime();
// "20 sn", "1 dk 20 sn": how long until the next automatic attempt.
export const countdown = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return m ? `${m} dk${s % 60 ? ` ${s % 60} sn` : ''}` : `${s} sn`; };
export const retryText = (retry: { at: number; n: number; max: number }) => `${countdown(retry.at - Date.now())} sonra otomatik yeniden denenecek (${retry.n}/${retry.max}).`;
