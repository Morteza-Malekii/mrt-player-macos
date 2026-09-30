import { randomBytes } from 'crypto';
import type { IncomingMessage } from 'http';
import { Readable } from 'stream';
import { request, collect } from '../../runtime/http';
import type { MediaStats } from '../../core/models';
// How many connections one film transfer may use. Providers commonly cap each connection
// rather than the account, so splitting a file across a few lanes is the difference between
// 16 Mbps and enough headroom to hold a 4K film. The account's own limit is the ceiling, and
// one slot is always left free: the player opens side requests of its own (the index at the
// end of an mp4, a seek), and a provider turns away anything past the limit. An unknown
// limit is treated as the smallest one.
export const lanesFor = (max: number) => Number.isFinite(max) ? Math.max(1, Math.min(4, Math.floor(max) - 1)) : 1;
export class MediaGateway {
  private entries = new Map<string, string>();
  private reverse = new Map<string, string>();
  private open = new Set<IncomingMessage>();
  private generation = 0;
  private counters = { delivered: 0, requests: 0, failures: 0, lastStatus: 0, slowestMs: 0, peakBps: 0, retries: 0 };
  private solo = false;
  private queue: Promise<unknown> = Promise.resolve();
  // An account that is allowed one stream at a time refuses the second request even when the
  // two only overlap for a moment, and the player sees that refusal as a dead channel. So on
  // such an account requests take turns: a new one waits for the previous to be really gone.
  // The same limit decides how wide a film download may fan out (see useLimit below).
  useLimit = (max: number) => { this.solo = max === 1; this.lanes = lanesFor(max); };
  private async turn(): Promise<() => void> {
    if (!this.solo) return () => {};
    const ahead = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    // Never wait for ever: a live stream holds its connection open by design.
    await Promise.race([ahead, new Promise(resolve => setTimeout(resolve, 8000))]);
    let spent = false;
    return () => { if (!spent) { spent = true; release(); } };
  }
  // A refusal is usually the provider's connection slot still being busy, not a missing
  // stream, so it is worth waiting out rather than handing the player an error.
  private static readonly WORTH_RETRY = new Set([403, 429, 500, 502, 503, 504]);
  private async upstream(source: string, headers: Record<string, string>): Promise<IncomingMessage> {
    for (let attempt = 0; ; attempt++) {
      let response: IncomingMessage;
      try { response = await request(source, headers, { streaming: true }); }
      catch (error) { if (attempt >= 3) throw error; this.counters.retries++; await new Promise(r => setTimeout(r, 200 + attempt * 400)); continue; }
      const status = response.statusCode || 0;
      if (status === 200 || status === 206 || attempt >= 3 || !MediaGateway.WORTH_RETRY.has(status)) return response;
      response.resume();
      this.counters.retries++;
      await new Promise(r => setTimeout(r, 200 + attempt * 400));
    }
  }
  // Counts only, never addresses: enough to tell a provider that cannot keep up from a Mac
  // that cannot decode, without putting the account or the stream URL on screen. Sampling
  // in-flight transfers here (not only completed ones) is what makes this work for a large
  // film still streaming, not just short segments that happen to finish inside the poll
  // interval.
  stats = (): MediaStats => { this.sample(); return { ...this.counters, open: this.open.size }; };
  private inFlight = new Set<{ bytes: number; startedAt: number }>();
  // Each transfer's own elapsed time, from its own start to now — never another transfer's
  // gap. A player with a full buffer goes idle for whole seconds *between* requests; a measure
  // that could span across that gap would report whatever the idle time produces, not the
  // provider's real speed, so nothing here ever mixes two transfers' time together. Below a
  // size floor the duration is too short relative to scheduling jitter to mean anything, so a
  // manifest or a short HLS segment cannot set the reading, only a substantial transfer can.
  private static readonly RATE_FLOOR = 256 * 1024;
  private sample() {
    const now = Date.now();
    for (const t of this.inFlight) if (t.bytes >= MediaGateway.RATE_FLOOR) this.counters.peakBps = Math.max(this.counters.peakBps, t.bytes / ((now - t.startedAt) / 1000));
  }
  private lanes = 1;
  private static readonly CHUNK = 2 * 1024 * 1024;
  private static readonly WORTH_SPLITTING = 8 * 1024 * 1024;
  // Only a ranged reply of a decent size is worth splitting: the server has already proved it
  // honours Range, and a short HLS segment would spend more on round trips than it saves.
  private splittable(status: number, response: IncomingMessage, headers: Headers) {
    if (this.solo || this.lanes < 2 || status !== 206) return null;
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
    if (!match) return null;
    const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
    if (!(end >= start) || end - start + 1 < MediaGateway.WORTH_SPLITTING) return null;
    headers.set('content-range', `bytes ${start}-${end}/${total}`);
    headers.set('content-length', String(end - start + 1));
    return { start, end };
  }
  private lanesBody(source: string, span: { start: number; end: number }, signal: AbortSignal): ReadableStream<Uint8Array> {
    let next = span.start, failed = false;
    const flight: Promise<Buffer>[] = [];
    const fetchChunk = async (from: number, to: number): Promise<Buffer> => {
      const reply = await request(source, { Range: `bytes=${from}-${to}` }, { streaming: true });
      this.open.add(reply); reply.on('close', () => this.open.delete(reply));
      if (reply.statusCode !== 206) { reply.resume(); throw new Error('range refused'); }
      const tracker = { bytes: 0, startedAt: Date.now() };
      this.inFlight.add(tracker);
      reply.on('data', chunk => { tracker.bytes += chunk.length; });
      try { const body = await collect(reply, to - from + 1 + 1024); this.counters.delivered += body.length; return body; }
      finally { this.sample(); this.inFlight.delete(tracker); }
    };
    const fill = () => {
      while (!failed && flight.length < this.lanes && next <= span.end) {
        const from = next, to = Math.min(from + MediaGateway.CHUNK - 1, span.end);
        next = to + 1;
        flight.push(fetchChunk(from, to));
      }
    };
    const give = () => { failed = true; };
    signal.addEventListener('abort', give, { once: true });
    return new ReadableStream<Uint8Array>({
      start: () => { fill(); },
      pull: async controller => {
        fill();
        const head = flight.shift();
        if (!head) { signal.removeEventListener('abort', give); controller.close(); return; }
        try { controller.enqueue(new Uint8Array(await head)); fill(); }
        catch (error) { give(); this.counters.failures++; controller.error(error); }
      },
      cancel: () => { give(); signal.removeEventListener('abort', give); }
    });
  }
  // Dropping the tokens is not enough on a channel change: an abandoned upstream response
  // keeps the provider's stream running and holds one of the account's simultaneous
  // connections, so the next channel waits for it to time out. Close them at once.
  clear = () => { this.generation++; this.entries.clear(); this.reverse.clear(); for (const response of this.open) response.destroy(); this.open.clear(); };
  add = (url: string): string => {
    const existing = this.reverse.get(url); if (existing) return existing;
    const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid media protocol');
    if (this.entries.size >= 10000) { const oldest = this.entries.keys().next().value!; const oldUrl = this.entries.get(oldest)!; this.reverse.delete(oldUrl); this.entries.delete(oldest); }
    const token = randomBytes(24).toString('hex'), local = `kiyi://media/${token}`;
    this.entries.set(token, url); this.reverse.set(url, local); return local;
  };
  async handle(incoming: Request): Promise<Response> {
    const token = new URL(incoming.url).pathname.slice(1), source = this.entries.get(token), generation = this.generation;
    if (!source || !['GET', 'HEAD'].includes(incoming.method)) return new Response(null, { status: 404 });
    const asked = Date.now();
    this.counters.requests++;
    const release = await this.turn();
    try {
      const range = incoming.headers.get('range');
      const response = await this.upstream(source, range ? { Range: range } : {});
      response.on('close', release);
      // How long the provider took to say anything at all: a server that stalls before the
      // first byte is a different problem from one that sends slowly.
      this.counters.slowestMs = Math.max(this.counters.slowestMs, Date.now() - asked);
      const abort = () => response.destroy(); incoming.signal.addEventListener('abort', abort, { once: true });
      this.open.add(response);
      response.on('close', () => { this.open.delete(response); incoming.signal.removeEventListener('abort', abort); });
      if (generation !== this.generation) { response.destroy(); return new Response(null, { status: 410 }); }
      const status = response.statusCode || 502;
      this.counters.lastStatus = status;
      if (![200, 206].includes(status)) { this.counters.failures++; response.resume(); return new Response(null, { status: status >= 400 && status <= 599 ? status : 502 }); }
      const headers = new Headers({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'kiyi://app' });
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = response.headers[name]; if (typeof value === 'string') headers.set(name, value); }
      const finalUrl = (response as typeof response & { finalUrl: string }).finalUrl;
      if (/\.m3u8(?:\?|$)/i.test(finalUrl) || /mpegurl/i.test(headers.get('content-type') || '')) {
        const raw = await collect(response, 2 * 1024 * 1024);
        this.counters.delivered += raw.length;
        const body = raw.toString('utf8').replace(/^﻿/, '');
        if (generation !== this.generation || !body.trimStart().startsWith('#EXTM3U')) return new Response(null, { status: 502 });
        const rewrite = (value: string) => this.add(new URL(value, finalUrl).href);
        const manifest = body.split(/\r?\n/).map(line => line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewrite(uri)}"`) : line.trim() ? rewrite(line.trim()) : line).join('\n');
        headers.delete('content-length'); headers.set('content-type', 'application/vnd.apple.mpegurl');
        return new Response(manifest, { status, headers });
      }
      if (incoming.method === 'HEAD') { response.resume(); return new Response(null, { status, headers }); }
      // A provider that caps each connection starves a 4K film on one lane while the line
      // sits idle. When the source honours ranges, pull the rest over several lanes at once
      // and hand the player a single ordered stream; the player never knows the difference.
      const span = this.splittable(status, response, headers);
      if (span) { response.destroy(); return new Response(this.lanesBody(source, span, incoming.signal), { status: 206, headers }); }
      const tracker = { bytes: 0, startedAt: Date.now() };
      this.inFlight.add(tracker);
      const counted = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => { tracker.bytes += chunk.byteLength; this.counters.delivered += chunk.byteLength; controller.enqueue(chunk); },
        flush: () => { this.inFlight.delete(tracker); }
      });
      response.on('close', () => this.inFlight.delete(tracker));
      return new Response((Readable.toWeb(response) as ReadableStream<Uint8Array>).pipeThrough(counted), { status, headers });
    } catch { release(); this.counters.failures++; return new Response(null, { status: 502 }); }
  }
}
