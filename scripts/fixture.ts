// Test-only Xtream emulator. No credentials or third-party content are embedded.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import ffmpeg from 'ffmpeg-static';
export async function createFixture(options: { tls?: { key: Buffer; cert: Buffer }; cors?: boolean; catalogSizes?: Partial<Record<'live' | 'vod' | 'series', number>>; videoSize?: string; videoBitrate?: string; videoDuration?: number; live?: boolean; audio?: 'aac' | 'ac3' | 'eac3' | 'mp2'; video?: 'h264' | 'hevc' | 'hevc10'; perConnectionBps?: number; oneStreamOnly?: boolean; uneven?: boolean; maxConnections?: number } = {}) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'kiyi-fixture-'));
  const credentials = { username: randomBytes(12).toString('hex'), password: randomBytes(24).toString('hex') };
  execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${options.videoSize || '640x360'}:rate=25`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(options.videoDuration || 12), ...(options.video === 'hevc' || options.video === 'hevc10'
      ? ['-c:v', 'hevc_videotoolbox', '-tag:v', 'hvc1', '-pix_fmt', options.video === 'hevc10' ? 'p010le' : 'yuv420p', '-g', '50']
      : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-g', '50']), ...(options.videoBitrate ? ['-b:v', options.videoBitrate] : []), '-c:a', options.audio || 'aac', '-b:a', options.audio === 'mp2' ? '192k' : options.audio ? '384k' : '64k', '-movflags', '+faststart', path.join(directory, 'pattern.mp4')]);
  execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-i', path.join(directory, 'pattern.mp4'), '-c', 'copy', '-hls_time', '2', '-hls_list_size', '0', '-hls_segment_filename', path.join(directory, 'part%d.ts'), path.join(directory, 'pattern.m3u8')]);
  execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-i', path.join(directory, 'pattern.mp4'), '-c', 'copy', '-f', 'mpegts', path.join(directory, 'pattern.ts')]);
  let requests = 0, streaming = 0, refused = 0, maxConnections = options.maxConnections ?? (options.oneStreamOnly ? 1 : 2);
  const agents: string[] = [];
  const segments = fs.readdirSync(directory).filter(name => /^part\d+\.ts$/.test(name)).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const started = Date.now();
  const catalogRequests: Array<{ action: string; category: string | null }> = [];
  const metadata = 'x'.repeat(360);
  const largeCatalog = (kind: 'live' | 'vod' | 'series', count: number) => Array.from({ length: count }, (_, index) => ({
    [kind === 'series' ? 'series_id' : 'stream_id']: index + 1000,
    name: `Sentetik ${kind} ${index}`, category_id: '1', provider_metadata: metadata
  }));
  const serve: http.RequestListener = (req, res) => {
    requests++;
    if (typeof req.headers['user-agent'] === 'string') agents.push(req.headers['user-agent']);
    const url = new URL(req.url!, 'http://fixture.invalid');
    if (options.cors) res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/player_api.php') {
      res.setHeader('Content-Type', 'application/json');
      if (url.searchParams.get('username') !== credentials.username || url.searchParams.get('password') !== credentials.password) { res.end(JSON.stringify({ user_info: { auth: 0 } })); return; }
      const action = url.searchParams.get('action');
      if (action === 'get_live_streams' || action === 'get_vod_streams' || action === 'get_series') catalogRequests.push({ action, category: url.searchParams.get('category_id') });
      const now = Math.floor(Date.now() / 1000), b64 = (s: string) => Buffer.from(s).toString('base64');
      let data: unknown;
      if (!action) data = { user_info: { auth: 1, status: 'Active', exp_date: String(now + 86400), active_cons: '0', max_connections: String(maxConnections) } };
      else if (action.endsWith('_categories')) data = [{ category_id: '1', category_name: 'Test laboratuvarı' }, { category_id: '2', category_name: 'Boş kategori' }];
      else if (action === 'get_live_streams') data = url.searchParams.get('category_id') === '2' ? [] : !url.searchParams.has('category_id') && options.catalogSizes?.live ? largeCatalog('live', options.catalogSizes.live) : [{ stream_id: 1, name: 'Sentetik test yayını', category_id: '1' }, { stream_id: 2, name: 'İstanbul test deseni', category_id: '1' }];
      else if (action === 'get_vod_streams') data = !url.searchParams.has('category_id') && options.catalogSizes?.vod ? largeCatalog('vod', options.catalogSizes.vod) : [{ stream_id: 3, name: 'Test filmi', category_id: '1', container_extension: 'mp4' }];
      else if (action === 'get_series') data = !url.searchParams.has('category_id') && options.catalogSizes?.series ? largeCatalog('series', options.catalogSizes.series) : [{ series_id: 4, name: 'Test dizisi', category_id: '1' }];
      else if (action === 'get_vod_info') data = { info: { name: 'Test filmi', plot: 'Bu video yalnızca otomatik olarak üretilmiş bir renk ve hareket desenidir.', genre: 'Teknik test', duration: '00:00:12', rating: '10' }, movie_data: { stream_id: 3 } };
      else if (action === 'get_series_info') data = { info: { name: 'Test dizisi', plot: 'Sentetik bölümler.' }, episodes: { '1': [{ id: '5', title: 'Birinci test', episode_num: 1, season: 1, container_extension: 'mp4' }], '2': [{ id: '6', title: 'İkinci test', episode_num: 1, season: 2, container_extension: 'mp4' }] } };
      else if (action === 'get_short_epg') data = { epg_listings: [{ id: 1, title: b64('Şimdi: Görüntü testi'), description: b64('Yerel üretilen renk ve ses deseni.'), start_timestamp: now - 600, stop_timestamp: now + 1800 }, { id: 2, title: b64('Sırada: Ses testi'), description: '', start_timestamp: now + 1800, stop_timestamp: now + 3600 }] };
      else { res.statusCode = 400; data = { error: 'unsupported' }; }
      res.end(JSON.stringify(data)); return;
    }
    const parts = url.pathname.split('/');
    if (!['live', 'movie', 'series'].includes(parts[1]) || decodeURIComponent(parts[2] || '') !== credentials.username || decodeURIComponent(parts[3] || '') !== credentials.password) { res.writeHead(404).end(); return; }
    const base = path.basename(parts[4] || '');
    // A single-slot account: the provider turns away anything that overlaps the live one.
    if (options.oneStreamOnly) {
      if (streaming > 0) { refused++; res.writeHead(403).end(); return; }
      streaming++;
      res.on('close', () => { streaming--; });
    }
    // A rolling window with no ENDLIST, so a live channel behaves like one: the playlist only
    // ever offers what has already aired, and it stops growing when the source runs out.
    if (options.live && parts[1] === 'live' && base.endsWith('.m3u8')) {
      const window = 4, aired = Math.floor((Date.now() - started) / 2000) + window;
      const first = Math.max(0, Math.min(aired, segments.length) - window);
      const shown = segments.slice(first, first + window);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:3', `#EXT-X-MEDIA-SEQUENCE:${first}`, ...shown.flatMap(part => ['#EXTINF:2.000000,', part])].join('\n') + '\n');
      return;
    }
    const name = base.endsWith('.m3u8') ? 'pattern.m3u8' : /^part\d+\.ts$/.test(base) ? base : base.endsWith('.ts') ? 'pattern.ts' : 'pattern.mp4';
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const size = fs.statSync(file).size;
    res.setHeader('Content-Type', name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : name.endsWith('.ts') ? 'video/mp2t' : 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); }
    res.setHeader('Content-Length', end - start + 1);
    const source = fs.createReadStream(file, { start, end });
    // Providers commonly cap each connection rather than the account, which is why one stream
    // crawls while several together do not. This reproduces that shape.
    if (options.perConnectionBps) {
      // Real providers do not deliver a flat rate: they surge and then sag, which is what
      // drains a shallow buffer over and over.
      const pace = () => options.perConnectionBps! * (options.uneven && Math.floor(Date.now() / 4000) % 2 === 0 ? 0.35 : 1.6);
      source.on('data', chunk => { res.write(chunk); source.pause(); setTimeout(() => source.resume(), chunk.length / pace() * 1000); });
      source.on('end', () => res.end());
      res.on('close', () => source.destroy());
    } else source.pipe(res);
  };
  const server = options.tls ? https.createServer(options.tls, serve) : http.createServer(serve);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { credentials: { ...credentials, server: `${options.tls ? 'https' : 'http'}://127.0.0.1:${address.port}` }, directory, requestCount: () => requests, catalogRequests: () => catalogRequests, userAgents: () => agents.slice(), refusedCount: () => refused, setMaxConnections: (count: number) => { maxConnections = count; },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); } };
}
