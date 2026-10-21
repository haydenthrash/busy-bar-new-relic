import { registerFontMaps, textWidth, type DisplayDrawParams } from '@busy-app/busy-lib';
import { small } from '@busy-app/busy-lib/fonts';
import { xpm2 } from './xpm.js';

registerFontMaps(small);

export type Element = DisplayDrawParams['elements'][number];
export type Severity = 'NOT_ALERTING' | 'WARNING' | 'CRITICAL' | 'NOT_CONFIGURED';

export const WIDTH = 72;
export const HEIGHT = 16;

export interface GraphStyle {
  line: string; // #RRGGBB, top pixel of each column
  fill: string; // #RRGGBB, area below the line
  minCeiling: number; // smallest Y-axis max, so tiny values don't fill the screen
}

export const RESPONSE_STYLE: GraphStyle = { line: '#00FFFF', fill: '#004050', minCeiling: 1 };
export const ERROR_STYLE: GraphStyle = { line: '#FF8000', fill: '#502800', minCeiling: 0.1 };

const BORDER_COLORS: Partial<Record<Severity, string>> = {
  WARNING: '#FFC800FF',
  CRITICAL: '#FF0000FF',
};

const FONT = 'small';
const LABEL_COLOR = '#FFFFFFFF';
const STALE_COLOR = '#808080FF';

export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${trim(ms / 1000)}s`;
  return `${trim(ms)}ms`;
}

export function formatErrorRate(pct: number): string {
  if (pct > 0 && pct < 0.01) return 'ERR <0.01%';
  return `ERR ${trim(pct)}%`;
}

/** At most 3 significant figures, no trailing zeros: 0.42, 1.5, 12, 245. */
function trim(n: number): string {
  if (n >= 100) return String(Math.round(n));
  return String(Number(n.toFixed(n >= 10 ? 0 : n >= 1 ? 1 : 2)));
}

/** Y-axis max: 10% headroom over the largest value, never below `minCeiling`. */
export function ceiling(series: (number | null)[], minCeiling: number): number {
  const max = Math.max(0, ...series.filter((v): v is number => v !== null));
  return Math.max(max * 1.1, minCeiling);
}

/**
 * Area graph as palette indices (0 = transparent, 1 = fill, 2 = line).
 * The series is stretched to `width` columns; null buckets are gaps.
 * Any non-null value (including 0) draws at least the 1px line.
 */
export function graphPixels(series: (number | null)[], width: number, height: number, minCeiling: number): number[][] {
  const rows = Array.from({ length: height }, () => new Array<number>(width).fill(0));
  if (series.length === 0) return rows;
  const top = ceiling(series, minCeiling);
  for (let x = 0; x < width; x++) {
    const v = series[Math.floor((x * series.length) / width)];
    if (v === null || v === undefined) continue;
    const h = Math.min(height, Math.max(1, Math.round((v / top) * height)));
    for (let y = height - h; y < height; y++) rows[y]![x] = y === height - h ? 2 : 1;
  }
  return rows;
}

export interface Screen {
  series: (number | null)[];
  label: string;
  severity: Severity;
  style: GraphStyle;
  stale?: boolean; // last NR fetch failed: dim the label and add "?"
}

export function renderScreen({ series, label, severity, style, stale = false }: Screen): Element[] {
  const border = borderElement(severity);
  const inset = border ? 1 : 0;
  const w = WIDTH - 2 * inset;
  const h = HEIGHT - 2 * inset;
  const graph: Element = {
    id: 'graph',
    type: 'xpmbitmap',
    x: inset,
    y: inset,
    z_index: 0,
    data: xpm2(graphPixels(series, w, h, style.minCeiling), ['none', style.fill, style.line]),
  };
  return [graph, ...labelElements(stale ? `${label}?` : label, stale ? STALE_COLOR : LABEL_COLOR), ...(border ? [border] : [])];
}

export function renderMessage(text: string, severity: Severity): Element[] {
  const border = borderElement(severity);
  return [
    { id: 'label', type: 'text', text, font: FONT, color: LABEL_COLOR, x: WIDTH / 2, y: HEIGHT / 2, align: 'center', z_index: 2 },
    ...(border ? [border] : []),
  ];
}

/** Text at top-left on a black box so it stays readable over the graph. */
function labelElements(text: string, color: string): Element[] {
  // `small` glyphs occupy rows 2..6 when drawn at y=0, leaving room for the border row.
  return [
    { id: 'label-bg', type: 'rectangle', x: 0, y: 0, width: textWidth(text, FONT) + 3, height: 8, fill: 'solid', fill_colors: ['#000000FF'], border_width: 0, z_index: 1 },
    { id: 'label', type: 'text', text, font: FONT, color, x: 2, y: 0, z_index: 2 },
  ];
}

function borderElement(severity: Severity): Element | undefined {
  const color = BORDER_COLORS[severity];
  if (!color) return undefined;
  return { id: 'border', type: 'rectangle', x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: 'none', border_width: 1, border_color: color, z_index: 3 };
}
