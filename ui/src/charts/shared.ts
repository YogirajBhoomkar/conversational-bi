import type { ChartSpec } from '../types';

export type Row = ChartSpec['data'][number];

export const HEIGHT = 320;
export const PALETTE = ['#2563eb', '#f97316', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#65a30d'];

// Rows grouped by the colour field, in first-seen order. A chart without one is a single series named after its y field.
export const toSeries = (spec: ChartSpec): [name: string, rows: Row[]][] => {
  const series = new Map<string, Row[]>();
  for (const d of spec.data) {
    const name = spec.color ? String(d[spec.color]) : spec.y;
    series.set(name, [...(series.get(name) ?? []), d]);
  }
  return [...series];
};

export const formatNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format;
