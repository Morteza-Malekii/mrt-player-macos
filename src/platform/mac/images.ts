import { request, collect } from '../../runtime/http';
// Serves `kiyi://image/<kind>/<id>` for the poster and logo pictures in the lists.
//
// It is deliberately separate from the media gateway. Media tokens are thrown away on every
// channel change and media requests queue up behind each other on a one-stream account;
// pictures must do neither, or opening a channel would blank the list and a screenful of
// posters would hold up the video.
//
// The page never learns where a picture comes from: the address is looked up in the
// privileged process, and only something that really is a raster image is passed back.
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i; // not SVG
interface Picture { type: string; body: Buffer }
export class ImageGateway {
  private static readonly MAX_IMAGE = 4 * 1024 * 1024;
  private static readonly CACHE_BYTES = 48 * 1024 * 1024;
  private static readonly PARALLEL = 4;
  private static readonly RETRY_AFTER = 10 * 60 * 1000;
  private static readonly REMEMBERED_FAILURES = 5000;
  private cache = new Map<string, Picture>();
  private cached = 0;
  private failed = new Map<string, number>();
  private pending = new Map<string, Promise<Picture | null>>();
  private active = 0;
  private waiting: Array<() => void> = [];
  async handle(incoming: Request, lookup: (kind: string, id: string) => string | undefined): Promise<Response> {
    const [kind, id] = new URL(incoming.url).pathname.split('/').filter(Boolean);
    const source = incoming.method === 'GET' && ['live', 'vod', 'series'].includes(kind) && /^\d{1,20}$/.test(id || '') ? lookup(kind, id) : undefined;
    const picture = source ? await this.load(source) : null;
    // no-store: the same `kind/id` path means a different picture after another login, so the
    // browser must never keep its own copy. This gateway keeps the copies, keyed by address.
    return picture ? new Response(new Uint8Array(picture.body), { headers: { 'Content-Type': picture.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 });
  }
  private load(source: string): Promise<Picture | null> {
    const hit = this.cache.get(source);
    if (hit) { this.cache.delete(source); this.cache.set(source, hit); return Promise.resolve(hit); }
    if ((this.failed.get(source) || 0) > Date.now()) return Promise.resolve(null);
    let running = this.pending.get(source);
    if (!running) { running = this.fetch(source).finally(() => this.pending.delete(source)); this.pending.set(source, running); }
    return running;
  }
  private async fetch(source: string): Promise<Picture | null> {
    await this.slot();
    try {
      const response = await request(source, { Accept: 'image/*', 'Accept-Encoding': 'identity' });
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode !== 200 || !IMAGE_TYPE.test(type) || Number(response.headers['content-length'] || 0) > ImageGateway.MAX_IMAGE) { response.resume(); return this.fail(source); }
      const picture = { type, body: await collect(response, ImageGateway.MAX_IMAGE) };
      this.keep(source, picture);
      return picture;
    } catch { return this.fail(source); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
  // A few at a time: a screenful of posters must not open a screenful of connections.
  private slot(): Promise<void> {
    if (this.active < ImageGateway.PARALLEL) { this.active++; return Promise.resolve(); }
    return new Promise(resolve => this.waiting.push(() => { this.active++; resolve(); }));
  }
  private keep(source: string, picture: Picture) {
    this.cache.set(source, picture); this.cached += picture.body.length;
    while (this.cached > ImageGateway.CACHE_BYTES) { const oldest = this.cache.keys().next().value!; this.cached -= this.cache.get(oldest)!.body.length; this.cache.delete(oldest); }
  }
  // A missing picture is remembered for a while, or every scroll would ask the provider again.
  private fail(source: string): null {
    if (this.failed.size >= ImageGateway.REMEMBERED_FAILURES) this.failed.delete(this.failed.keys().next().value!);
    this.failed.set(source, Date.now() + ImageGateway.RETRY_AFTER);
    return null;
  }
}
