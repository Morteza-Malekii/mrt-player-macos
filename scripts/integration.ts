import assert from 'node:assert/strict';
import { createFixture } from './fixture';
import { Xtream, normalizeCredentials } from '../src/core/xtream';
import { NodeTransport } from '../src/runtime/http';
import { MediaGateway } from '../src/platform/mac/media';
const fixture = await createFixture();
try {
  const client = new Xtream(normalizeCredentials(fixture.credentials, true), new NodeTransport());
  assert.equal((await client.authenticate()).maxConnections, 2);
  const categories = await client.categories('live'); assert.equal(categories.length, 2);
  const items = await client.items('live', categories[0].id); assert.equal(items.length, 2);
  const media = new MediaGateway(), url = media.add(client.stream('live', items[0].id));
  const playlist = await (await media.handle(new Request(url))).text();
  assert.ok(playlist.startsWith('#EXTM3U')); assert.ok(!playlist.includes(fixture.credentials.password));
  const segment = playlist.split('\n').find(line => line.startsWith('kiyi://'))!;
  assert.ok((await (await media.handle(new Request(segment))).arrayBuffer()).byteLength > 1000);
  const movieUrl = media.add(client.stream('vod', '3', 'mp4'));
  const range = await media.handle(new Request(movieUrl, { headers: { Range: 'bytes=100-999' } }));
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 900);
  const large = await createFixture({ catalogSizes: { live: 50000, vod: 40000, series: 11000 } });
  try {
    const client = new Xtream(normalizeCredentials(large.credentials, true), new NodeTransport());
    assert.equal((await client.items('live', '1')).length, 2);
    assert.equal((await client.items('live')).length, 50000);
    assert.equal((await client.items('vod')).length, 40000);
    assert.equal((await client.items('series')).length, 11000);
  } finally { await large.close(); }
  console.log('PASS: Xtream HLS/VOD aktarımı, 50 bin kanal + 40 bin film + 11 bin dizi kataloğu.');
} finally { await fixture.close(); }
