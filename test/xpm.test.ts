import { describe, expect, it } from 'vitest';
import { xpm2 } from '../src/xpm.js';

describe('xpm2', () => {
  it('writes the XPM2 header, palette and pixel rows', () => {
    const out = xpm2(
      [
        [0, 1, 2],
        [2, 1, 0],
      ],
      ['none', '#004050', '#00FFFF'],
    );
    expect(out.split('\n')).toEqual(['! XPM2', '3 2 3 1', '. c none', 'a c #004050', 'b c #00FFFF', '.ab', 'ba.']);
  });

  it('rejects ragged rows, unknown indices and oversized palettes', () => {
    expect(() => xpm2([[0, 0], [0]], ['none'])).toThrow(/row 1/);
    expect(() => xpm2([[0, 3]], ['none', 'red'])).toThrow(/out of range/);
    expect(() => xpm2([[0]], new Array(33).fill('red'))).toThrow(/palette/);
  });
});
