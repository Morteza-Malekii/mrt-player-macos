import type { Item } from '../core/models';
import type { Move } from '../core/order';
import { Icon } from './Icon';
import { Poster } from './Poster';
const initials = (name: string) => name.slice(0, 2).toLocaleUpperCase('tr-TR');
// One card in a list: the picture fills it and the name sits over its lower edge. A channel
// gets a logo plate, a film or series a poster with its score in the corner. Without a picture
// (posters off, none offered, or it failed) the plate shows the initials or an icon instead.
// While the list is being arranged (`arrange`), the card does not play; it shows three buttons:
// to the front, one place earlier, one place later.
export interface Arrange { first: boolean; last: boolean; onMove(move: Move): void }
export function Tile({ item, index, playing, favorite, posters, epoch, ready, arrange, onSelect, onFavorite }: { item: Item; index: number; playing: boolean; favorite: boolean; posters: boolean; epoch: number; ready: boolean; arrange?: Arrange; onSelect(): void; onFavorite(): void }) {
  const live = item.kind === 'live', score = Number(item.rating);
  const rating = !live && Number.isFinite(score) && score > 0 ? (Number.isInteger(score) ? String(score) : score.toFixed(1)) : '';
  return <article className={`content-card tile ${live ? 'tile-live' : 'tile-poster'} ${playing ? 'now-playing' : ''} ${arrange ? 'arranging' : ''}`}>
    <button className="content-select" aria-label={item.name} tabIndex={arrange ? -1 : undefined} onClick={arrange ? undefined : onSelect}>
      <span className={`tile-art tone-${index % 6}`}><Poster key={epoch} item={item} enabled={posters}>{live ? <span className="tile-initials">{initials(item.name)}</span> : <Icon name={item.kind === 'series' ? 'series' : 'film'} size={38} />}</Poster></span>
      {rating && <span className="tile-badge">{rating}</span>}
      {playing && <span className="tile-badge tile-now">● Oynatılıyor</span>}
      <span className="tile-name">{item.name}</span>
    </button>
    {arrange && <span className="tile-arrange" role="group" aria-label={`${item.name} sırası`}>
      <button type="button" disabled={arrange.first} aria-label={`${item.name}: başa al`} title="Başa al" onClick={() => arrange.onMove('top')}><Icon name="top" size={16} /></button>
      <button type="button" disabled={arrange.first} aria-label={`${item.name}: öne al`} title="Bir öne al" onClick={() => arrange.onMove('up')}><Icon name="back" size={16} /></button>
      <button type="button" disabled={arrange.last} aria-label={`${item.name}: geriye al`} title="Bir geriye al" onClick={() => arrange.onMove('down')}><Icon name="next" size={16} /></button>
    </span>}
    <button disabled={!ready} className={`favorite-button ${favorite ? 'active' : ''}`} aria-label={`${item.name} ${favorite ? 'favorilerden çıkar' : 'favorilere ekle'}`} aria-pressed={favorite} onClick={onFavorite}><Icon name="heart" size={16} /></button>
  </article>;
}
