// Plays a film with a dub Chromium cannot decode. Chromium has no AC-3, E-AC-3 or DTS decoder (Dolby and
// DTS are licensed; TVs and VLC-based players carry their own), so those dubs used to be missing from the
// list, and a film with only such audio played silent. Here the bundled FFmpeg copies the picture as it is
// and turns only the chosen dub into AAC, as fragmented MP4 that the page feeds to Media Source Extensions.
//
// FFmpeg reads a provider's file through the media gateway (a loopback address that only knows the
// gateway's tokens), so the account's connection limit, the parallel lanes and the subtitle reader all
// apply to it just as they do to the player. A seek outside what is buffered starts a new conversion at
// that point; timestamps stay those of the file, so the page's timeline never shifts.
import http from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import type { MediaInspector } from './inspector';

export interface RemuxSources {
  has(token: string): boolean;
  serve(token: string, method: string, range: string | undefined, signal: AbortSignal): Promise<Response>;
  file(id: string): string | undefined;
}
// Where a conversion starts, for FFmpeg: from the very start the encoder's own priming would make the first
// audio timestamps negative, so a start this close to zero is read from the top instead.
// Surround sound is laid out as plain 5.1: Chromium refuses AAC in the "5.1 (side)" layout that Dolby and
// DTS tracks decode to (measured: the stream does not parse), and accepts the standard one. Layouts between
// stereo and 5.1 become stereo.
export function remuxArgs(input: string, options: { remote: boolean; at: number; audio: number; codec: string; channels?: number; video: string }): string[] {
  const at = options.at >= 1 ? options.at : 0, copy = options.codec === 'aac', channels = options.channels || 2;
  return ['-hide_banner', '-loglevel', 'error', '-nostdin',
    ...(options.remote ? ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5'] : []),
    ...(at ? ['-ss', at.toFixed(3), '-copyts'] : []),
    '-i', input, '-map', '0:V:0', '-map', `0:a:${options.audio}`,
    '-c:v', 'copy', ...(options.video === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', ...(channels >= 6 ? ['-ac', '6', '-b:a', '384k'] : channels > 2 ? ['-ac', '2', '-b:a', '192k'] : ['-b:a', '192k'])]),
    '-sn', '-dn', '-map_chapters', '-1', ...(at ? ['-avoid_negative_ts', 'disabled'] : []), '-max_muxing_queue_size', '4096',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof+frag_discont', '-frag_duration', '1000000', 'pipe:1'];
}

export class Remuxer {
  private running?: () => void;
  private server?: http.Server;
  private port?: Promise<number>;
  private latest = new Map<string, AbortController>();
  constructor(private ffmpeg: string | undefined, private inspector: MediaInspector, private sources: RemuxSources) {}
  available = () => !!this.ffmpeg && fs.existsSync(this.ffmpeg);
  // One conversion at a time: a seek or another dub replaces the running one, and so does a new title.
  stop = () => { this.running?.(); this.running = undefined; for (const control of this.latest.values()) control.abort(); this.latest.clear(); };
  close = () => { this.stop(); this.server?.close(); this.server = undefined; this.port = undefined; };
  private listen(): Promise<number> {
    return this.port ??= new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => void this.relay(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
      this.server = server;
    });
  }
  // FFmpeg's side of the gateway. A browser page could reach a loopback port, so only a gateway token is
  // answered and a request that carries an Origin is refused. FFmpeg opens the new connection of a seek
  // before closing the old one; on an account with one connection the old one has to go first, so a
  // new request for a file ends the one before it.
  private async relay(req: http.IncomingMessage, res: http.ServerResponse) {
    const token = (req.url || '').slice(1), method = req.method || 'GET';
    if (!/^[a-f0-9]{48}$/.test(token) || req.headers.origin || !['GET', 'HEAD'].includes(method) || !this.sources.has(token)) { res.writeHead(404).end(); return; }
    this.latest.get(token)?.abort();
    const control = new AbortController(); this.latest.set(token, control);
    res.on('close', () => { control.abort(); if (this.latest.get(token) === control) this.latest.delete(token); });
    try {
      const reply = await this.sources.serve(token, method, typeof req.headers.range === 'string' ? req.headers.range : undefined, control.signal);
      if (control.signal.aborted) { void reply.body?.cancel().catch(() => {}); res.destroy(); return; }
      const headers: Record<string, string> = {}; reply.headers.forEach((value, name) => { if (name !== 'access-control-allow-origin') headers[name] = value; });
      res.writeHead(reply.status, headers);
      if (!reply.body || method === 'HEAD') { res.end(); return; }
      const body = Readable.fromWeb(reply.body as import('stream/web').ReadableStream<Uint8Array>);
      control.signal.addEventListener('abort', () => body.destroy(), { once: true });
      body.on('error', () => res.destroy());
      body.pipe(res);
    } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  }
  // kiyi://remux/media/<token>?audio=<n>&at=<seconds> (or local/<id>): the file's picture with its n-th dub.
  async handle(incoming: Request): Promise<Response> {
    const url = new URL(incoming.url), key = url.pathname.slice(1), match = /^(media|local)\/([A-Za-z0-9-]{1,80})$/.exec(key);
    const audio = Number(url.searchParams.get('audio')), at = Number(url.searchParams.get('at') || 0);
    if (!match || !this.available() || incoming.method !== 'GET' || !Number.isInteger(audio) || audio < 0 || audio > 63 || !Number.isFinite(at) || at < 0 || at > 172800) return new Response(null, { status: 400 });
    const header = this.inspector.header(key), video = this.inspector.tracks(`kiyi://${key}`)?.video;
    const track = header?.tracks.filter(t => t.type === 'audio')[audio];
    if (!header || !track || !video) return new Response(null, { status: 404 });
    let input: string | undefined;
    if (match[1] === 'media') input = this.sources.has(match[2]) ? `http://127.0.0.1:${await this.listen()}/${match[2]}` : undefined;
    else input = this.sources.file(match[2]);
    if (!input) return new Response(null, { status: 404 });
    this.stop();
    const child = spawn(this.ffmpeg!, remuxArgs(input, { remote: match[1] === 'media', at, audio, codec: track.codec, channels: track.channels, video }), { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '', cancelled = false;
    child.stderr!.on('data', data => { errors = (errors + data).slice(-2000); });
    const kill = () => { cancelled = true; child.kill('SIGKILL'); };
    this.running = kill;
    incoming.signal.addEventListener('abort', kill, { once: true });
    // Pulled, not pushed: when the page has enough buffered it stops reading, FFmpeg blocks on its output
    // and stops reading the file, and the provider's connection goes quiet instead of racing ahead.
    const out = child.stdout!;
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        out.on('data', (chunk: Buffer) => { try { controller.enqueue(new Uint8Array(chunk)); if ((controller.desiredSize ?? 1) <= 0) out.pause(); } catch { /* cancelled */ } });
        child.on('error', () => { try { controller.error(new Error('converter failed to start')); } catch { /* closed */ } });
        child.on('close', code => {
          incoming.signal.removeEventListener('abort', kill);
          if (this.running === kill) this.running = undefined;
          if (code !== 0 && !cancelled) console.warn('remux:', code, errors.trim().split('\n').slice(-3).join(' | '));
          try { if (code === 0) controller.close(); else controller.error(new Error('converter stopped')); } catch { /* cancelled */ }
        });
      },
      pull: () => { out.resume(); },
      cancel: () => { kill(); }
    }, { highWaterMark: 4 * 1024 * 1024, size: chunk => chunk.byteLength });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'kiyi://app' } });
  }
}
