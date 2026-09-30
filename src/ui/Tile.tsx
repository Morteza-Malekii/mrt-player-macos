import type { Item } from '../core/models';
import { Icon } from './Icon';
import { Poster } from './Poster';
const initials = (name: string) => name.slice(0, 2).toLocaleUpperCase('tr-TR');
// One card in a list: the picture fills it and the name sits over its lower edge. A channel
// gets a logo plate, a film or series a poster with its score in the corner. Without a picture
// (posters off, none offered, or it failed) the plate shows the initials or an icon instead.
export function Tile({ item, index, playing, favorite, posters, epoch, ready, onSelect, onFavorite }: { item: Item; index: number; playing: boolean; favorite: boolean; posters: boolean; epoch: number; ready: boolean; onSelect(): void; onFavorite(): void }) {
  const live = item.kind === 'live', score = Number(item.rating);
  const rating = !live && Number.isFinite(score) && score > 0 ? (Number.isInteger(score) ? String(score) : score.toFixed(1)) : '';
  return <article className={`content-card tile ${live ? 'tile-live' : 'tile-poster'} ${playing ? 'now-playing' : ''}`}>
    <button className="content-select" aria-label={item.name} onClick={onSelect}>
      <span className={`tile-art tone-${index % 6}`}><Poster key={epoch} item={item} enabled={posters}>{live ? <span className="tile-initials">{initials(item.name)}</span> : <Icon name={item.kind === 'series' ? 'series' : 'film'} size={38} />}</Poster></span>
      {rating && <span className="tile-badge">{rating}</span>}
      {playing && <span className="tile-badge tile-now">● Oynatılıyor</span>}
      <span className="tile-name">{item.name}</span>
    </button>
    <button disabled={!ready} className={`favorite-button ${favorite ? 'active' : ''}`} aria-label={`${item.name} ${favorite ? 'favorilerden çıkar' : 'favorilere ekle'}`} aria-pressed={favorite} onClick={onFavorite}><Icon name="heart" size={16} /></button>
  </article>;
}
