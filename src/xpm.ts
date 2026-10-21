/** One character per pixel; index 0 is used for the first palette entry. */
const CHARS = '.abcdefghijklmnopqrstuvwxyzABCDEF';
const MAX_COLORS = 32;

/**
 * Builds an XPM2 image as accepted by the BUSY Bar `xpmbitmap` element.
 *
 * @param pixels rows of palette indices (all rows the same length)
 * @param palette colors: `none`, a named color, or `#RRGGBB`
 */
export function xpm2(pixels: number[][], palette: string[]): string {
  if (palette.length === 0 || palette.length > MAX_COLORS) {
    throw new Error(`XPM palette must have 1..${MAX_COLORS} colors`);
  }
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const rows = pixels.map((row, y) => {
    if (row.length !== width) throw new Error(`XPM row ${y} has ${row.length} pixels, expected ${width}`);
    return row
      .map((i) => {
        const ch = CHARS[i];
        if (ch === undefined || i >= palette.length) throw new Error(`XPM pixel index ${i} out of range`);
        return ch;
      })
      .join('');
  });
  return [
    '! XPM2',
    `${width} ${height} ${palette.length} 1`,
    ...palette.map((color, i) => `${CHARS[i]} c ${color}`),
    ...rows,
  ].join('\n');
}
