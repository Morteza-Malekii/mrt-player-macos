import { useState, type ReactNode } from 'react';
import type { Item } from '../core/models';
// The picture comes from the privileged process as `kiyi://image/<kind>/<id>`; the address of
// the provider's image host never reaches this page. While it loads, when the provider has no
// picture, and when it fails, `children` (initials or an icon) stay on screen instead.
export function Poster({ item, enabled, children }: { item: Item; enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const shown = enabled && !item.isEpisode && state !== 'failed';
  return <>
    {shown && <img className={`poster-image ${item.kind} ${state}`} src={`kiyi://image/${item.kind}/${item.id}`} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setState('ready')} onError={() => setState('failed')} />}
    {!(shown && state === 'ready') && children}
  </>;
}
