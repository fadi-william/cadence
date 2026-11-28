/**
 * Classes for a responsive grid of KPI tiles (DORA tiles, stat cards) that holds up to five per row: one
 * column on phones, two from `sm`, a six-track grid from `xl` (three tiles a row, see {@link tileSpan}) and
 * a single row of five from `2xl`. Pair every tile with {@link tileSpan}.
 */
export const TILE_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-5';

/**
 * Column-span classes for tile `index` of `count` in {@link TILE_GRID}, so no row ends with a lone,
 * half-empty slot: an odd last tile spans both columns from `sm`; from `xl` tiles sit three to a row and the
 * final row's tiles widen to fill it; from `2xl` every tile takes one of five columns.
 *
 * @param index - Zero-based position of the tile.
 * @param count - Number of tiles in the grid.
 * @returns Space-separated Tailwind classes for the tile.
 */
export const tileSpan = (index: number, count: number): string => {
  const cls: string[] = [];
  if (count % 2 === 1 && index === count - 1) cls.push('sm:col-span-2');
  const tail = count % 3;
  const inTail = tail > 0 && index >= count - tail;
  cls.push(inTail ? (tail === 1 ? 'xl:col-span-6' : 'xl:col-span-3') : 'xl:col-span-2');
  cls.push('2xl:col-span-1');
  return cls.join(' ');
};
