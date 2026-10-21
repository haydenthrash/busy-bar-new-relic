import { describe, expect, it } from 'vitest';
import {
  ERROR_STYLE,
  RESPONSE_STYLE,
  ceiling,
  formatDuration,
  formatErrorRate,
  graphPixels,
  renderMessage,
  renderScreen,
} from '../src/render.js';

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(245.3)).toBe('245ms');
    expect(formatDuration(42.26)).toBe('42ms');
    expect(formatDuration(3.44)).toBe('3.4ms');
    expect(formatDuration(0.123)).toBe('0.12ms');
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(12_345)).toBe('12s');
  });

  it('formats error rates with at most 3 significant figures', () => {
    expect(formatErrorRate(0.4234)).toBe('ERR 0.42%');
    expect(formatErrorRate(0.4)).toBe('ERR 0.4%');
    expect(formatErrorRate(1.55)).toBe('ERR 1.6%');
    expect(formatErrorRate(12.3)).toBe('ERR 12%');
    expect(formatErrorRate(100)).toBe('ERR 100%');
    expect(formatErrorRate(0)).toBe('ERR 0%');
    expect(formatErrorRate(0.004)).toBe('ERR <0.01%');
  });
});

describe('scaling', () => {
  it('adds 10% headroom and respects the minimum ceiling', () => {
    expect(ceiling([100, null, 200], 1)).toBeCloseTo(220);
    expect(ceiling([0, 0.01], 0.1)).toBe(0.1);
    expect(ceiling([null], 1)).toBe(1);
  });

  it('draws columns with a bright top, dim fill and gaps for null', () => {
    const px = graphPixels([0, 10, null, 5], 4, 11, 1);
    const column = (x: number) => px.map((row) => row[x]);
    // ceiling = 11, so 10 -> 10 rows, 5 -> 5 rows, 0 -> 1px line
    expect(column(0)).toEqual([...new Array(10).fill(0), 2]);
    expect(column(1)).toEqual([0, 2, ...new Array(9).fill(1)]);
    expect(column(2)).toEqual(new Array(11).fill(0));
    expect(column(3)).toEqual([...new Array(6).fill(0), 2, 1, 1, 1, 1]);
  });

  it('stretches the series across the full width', () => {
    const px = graphPixels([1, 2], 4, 4, 1);
    // two buckets over four columns: each bucket covers two columns
    expect(px).toEqual([
      [0, 0, 2, 2],
      [0, 0, 1, 1],
      [2, 2, 1, 1],
      [1, 1, 1, 1],
    ]);
  });
});

describe('renderScreen', () => {
  const series = Array.from({ length: 61 }, (_, i) => 100 + i);

  it('draws a full-screen graph and label without a border when not alerting', () => {
    const els = renderScreen({ series, label: '245ms', severity: 'NOT_ALERTING', style: RESPONSE_STYLE });
    expect(els.map((e) => e.id)).toEqual(['graph', 'label-bg', 'label']);
    const graph = els[0] as { data: string; x: number; y: number };
    expect(graph.data.split('\n')[1]).toBe('72 16 3 1');
    expect(graph.data).toContain('b c #00FFFF');
    expect([graph.x, graph.y]).toEqual([0, 0]);
    expect(els[2]).toMatchObject({ type: 'text', text: '245ms', font: 'small', color: '#FFFFFFFF' });
  });

  it('insets the graph and adds a yellow / red border for WARNING / CRITICAL', () => {
    const warn = renderScreen({ series, label: 'ERR 0.42%', severity: 'WARNING', style: ERROR_STYLE });
    expect(warn.at(-1)).toMatchObject({ id: 'border', type: 'rectangle', width: 72, height: 16, fill: 'none', border_width: 1, border_color: '#FFC800FF' });
    const graph = warn[0] as { data: string; x: number; y: number };
    expect(graph.data.split('\n')[1]).toBe('70 14 3 1');
    expect([graph.x, graph.y]).toEqual([1, 1]);

    const crit = renderScreen({ series, label: 'x', severity: 'CRITICAL', style: ERROR_STYLE });
    expect(crit.at(-1)).toMatchObject({ border_color: '#FF0000FF' });
    expect(renderScreen({ series, label: 'x', severity: 'NOT_CONFIGURED', style: ERROR_STYLE }).some((e) => e.id === 'border')).toBe(false);
  });

  it('sizes the label background to the text and dims stale labels', () => {
    const els = renderScreen({ series, label: '245ms', severity: 'NOT_ALERTING', style: RESPONSE_STYLE, stale: true });
    expect(els.find((e) => e.id === 'label')).toMatchObject({ text: '245ms?', color: '#808080FF' });
    const bg = els.find((e) => e.id === 'label-bg') as { width: number };
    expect(bg.width).toBeGreaterThan(20);
    expect(bg.width).toBeLessThan(40);
  });

  it('renders a centered message', () => {
    expect(renderMessage('NR: no data', 'CRITICAL').map((e) => e.id)).toEqual(['label', 'border']);
  });
});
