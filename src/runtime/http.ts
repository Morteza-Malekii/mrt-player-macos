import http from 'http';
import https from 'https';
import { URL } from 'url';
import { gunzip, inflate } from 'zlib';
import { promisify } from 'util';
import { AppError } from '../core/errors';
import type { Transport } from '../core/xtream';
// Which player the provider thinks it is talking to. Some accounts are rate limited, or handed
// a weaker stream, unless the client looks like one the provider knows; VLC is the client
// IPTV panels most commonly expect. A fixed string on purpose: a free-text header would be a
// header-injection hole for no benefit.
const announce = 'VLC/3.0.20 LibVLC/3.0.20';

// Pooled connections: a warm socket removes the TCP/TLS handshake from every manifest and
// segment fetch, and reusing one socket keeps the account below the provider's simultaneous
// connection limit instead of opening a fresh stream per request.
const agents: Record<string, http.Agent> = {
  'http:': new http.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8, timeout: 60000 }),
  'https:': new https.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8, timeout: 60000 })
};
export interface RequestOptions { redirects?: number; authOrigin?: string; streaming?: boolean }
export async function request(urlString: string, headers: Record<string, string> = {}, options: RequestOptions = {}): Promise<http.IncomingMessage> {
  const url = new URL(urlString);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError('URL', 'Sunucu adresi desteklenmiyor.');
  const redirects = options.redirects || 0;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, agent: agents[url.protocol], headers: { 'User-Agent': announce, ...headers } }, res => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next: URL;
        try { next = new URL(res.headers.location, url); } catch { reject(new AppError('REDIRECT', 'Sunucu yönlendirmesi geçersiz.')); return; }
        if (redirects >= 4 || (url.protocol === 'https:' && next.protocol !== 'https:') || (options.authOrigin && next.origin !== options.authOrigin)) {
          reject(new AppError('REDIRECT', 'Güvenli olmayan veya fazla sayıda sunucu yönlendirmesi.')); return;
        }
        request(next.href, headers, { ...options, redirects: redirects + 1 }).then(resolve, reject); return;
      }
      // A player that has filled its buffer stops reading for minutes, which looks exactly
      // like an idle socket. Timing the body would cut healthy 4K and film streams mid
      // segment, so only the connect and header phase is timed; a peer that really goes away
      // is caught by TCP keep-alive or by the caller aborting the request.
      if (options.streaming) { req.setTimeout(0); res.socket?.setKeepAlive(true, 15000); }
      // The final URL is only retained in the privileged process, for relative HLS links.
      (res as http.IncomingMessage & { finalUrl: string }).finalUrl = url.href;
      resolve(res);
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', error => {
      const code = (error as NodeJS.ErrnoException).code || '';
      reject(new AppError(code.includes('CERT') || code.includes('TLS') || code.includes('SSL') ? 'TLS' : 'NETWORK', code.includes('CERT') || code.includes('TLS') || code.includes('SSL') ? 'Sunucunun TLS sertifikası doğrulanamadı.' : 'Sunucuya ulaşılamadı veya bağlantı zaman aşımına uğradı.'));
    });
  });
}
export async function collect(res: http.IncomingMessage, limit = 16 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    res.on('data', chunk => { size += chunk.length; if (size > limit) { res.destroy(); reject(new AppError('SIZE', 'Sunucunun yanıtı çok büyük. Kategori seçerek tekrar deneyin.')); } else chunks.push(chunk); });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', () => reject(new AppError('NETWORK', 'Veri aktarımı kesildi.')));
    res.on('aborted', () => reject(new AppError('NETWORK', 'Veri aktarımı kesildi.')));
  });
}
export class NodeTransport implements Transport {
  async json(url: string): Promise<unknown> {
    const catalogLimit = 48 * 1024 * 1024;
    const response = await request(url, { Accept: 'application/json', 'Accept-Encoding': 'identity' }, { authOrigin: new URL(url).origin });
    if (response.statusCode === 401 || response.statusCode === 403) { response.resume(); throw new AppError('AUTH', 'Sunucu erişimi reddetti. Hesap bilgilerini kontrol edin.'); }
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.resume(); throw new AppError('HTTP_STATUS', 'Sunucu isteği tamamlayamadı. Daha sonra yeniden deneyin.'); }
    let body = await collect(response, catalogLimit);
    if (response.headers['content-encoding'] === 'gzip') body = await promisify(gunzip)(body);
    if (response.headers['content-encoding'] === 'deflate') body = await promisify(inflate)(body);
    if (body.length > catalogLimit) throw new AppError('SIZE', 'Sunucu yanıtı çok büyük. Kategori seçerek tekrar deneyin.');
    try { return JSON.parse(body.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new AppError('RESPONSE', 'Sunucu geçerli bir Xtream yanıtı göndermedi. Adresi kontrol edin.'); }
  }
}
