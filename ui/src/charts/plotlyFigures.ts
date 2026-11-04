import type { Data, Layout } from 'plotly.js';
import type { ChartSpec } from '../types';
import { PALETTE, type Row, toSeries } from './shared';

// Turns a chart spec into the data and layout Plotly draws. Nothing here imports Plotly itself, so it is cheap to test.
export type Figure = { data: Data[]; layout: Partial<Layout> };

const AXIS_TYPE = { category: 'category', time: 'date', number: 'linear' } as const;
const colourOf = (i: number) => PALETTE[i % PALETTE.length];
const label = (d: Row, key: string) => String(d[key]);
const unique = <T,>(values: T[]) => [...new Set(values)];
const sum = (d: Row, key: string) => Number(d[key]) || 0;
const withAlpha = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
// Plotly's typings do not describe every trace we draw (sankey, treemap, sunburst), so traces are plain objects; the tests cover their shape.
const asData = (trace: object) => trace as unknown as Data;

// A chart that is missing what its type needs is not drawn, and the UI shows the table instead.
export const supportsSpec = (spec: ChartSpec) => (spec.type === 'heatmap' ? Boolean(spec.color) : spec.type === 'sankey' ? (spec.path?.length ?? 0) >= 2 : true);

// The buttons that change the form of a bar, line, scatter or area chart are Plotly's own `updatemenus`; each one restyles the traces.
// A restyle resets the x axis type, so it is set again in the same step.
const FORMS = [
  { label: 'Bar', change: { type: 'bar', mode: null, stackgroup: null } },
  { label: 'Line', change: { type: 'scatter', mode: 'lines+markers', stackgroup: null } },
  { label: 'Scatter', change: { type: 'scatter', mode: 'markers', stackgroup: null } },
  { label: 'Area', change: { type: 'scatter', mode: 'lines', stackgroup: 'one' } },
];
const FORM_INDEX: Partial<Record<ChartSpec['type'], number>> = { bar: 0, line: 1, scatter: 2, area: 3 };

// Bar, line, scatter and area: one trace per series, on x and y axes.
const cartesian = (spec: ChartSpec): Figure => ({
  data: toSeries(spec).map(([name, rows], i) =>
    asData({
      name,
      type: spec.type === 'bar' ? 'bar' : 'scatter',
      mode: spec.type === 'line' ? 'lines+markers' : spec.type === 'scatter' ? 'markers' : spec.type === 'area' ? 'lines' : undefined,
      ...(spec.type === 'area' ? { stackgroup: 'one', line: { color: colourOf(i) } } : {}),
      x: rows.map((d) => d[spec.x]),
      y: rows.map((d) => d[spec.y]),
      marker: { color: colourOf(i) },
    }),
  ),
  layout: {
    barmode: 'stack',
    showlegend: Boolean(spec.color),
    margin: { t: 56, r: 16, b: 80, l: 70 },
    xaxis: { type: AXIS_TYPE[spec.xType], title: { text: spec.x }, tickangle: spec.xType === 'category' ? -35 : 0, automargin: true },
    yaxis: { title: { text: spec.y }, tickformat: '~s', automargin: true },
    updatemenus: [
      {
        type: 'buttons', direction: 'right', showactive: true, active: FORM_INDEX[spec.type] ?? 0,
        x: 0.5, xanchor: 'center', y: 1.14, yanchor: 'top', bgcolor: '#ffffff', bordercolor: '#e2e0e0', font: { size: 12 },
        buttons: FORMS.map(({ label: text, change }) => ({ label: text, method: 'update', args: [change, { 'xaxis.type': AXIS_TYPE[spec.xType] }] })),
      },
    ],
  },
});

// Pie and donut: one slice per value of the first dimension (rows that repeat a value are added up).
const share = (spec: ChartSpec): Figure => {
  const totals = new Map<string, number>();
  for (const d of spec.data) totals.set(label(d, spec.x), (totals.get(label(d, spec.x)) ?? 0) + sum(d, spec.y));
  const labels = [...totals.keys()];
  return {
    data: [asData({ type: 'pie', labels, values: [...totals.values()], hole: spec.type === 'donut' ? 0.5 : 0, marker: { colors: labels.map((_, i) => colourOf(i)) }, textinfo: 'percent', sort: false })],
    layout: { showlegend: true, margin: { t: 16, r: 16, b: 16, l: 16 } },
  };
};

// Funnel: stages from top to bottom in the order the rows arrive.
const funnel = (spec: ChartSpec): Figure => ({
  data: [asData({ type: 'funnel', y: spec.data.map((d) => label(d, spec.x)), x: spec.data.map((d) => d[spec.y]), marker: { color: colourOf(0) }, textinfo: 'value+percent initial' })],
  layout: { margin: { t: 16, r: 16, b: 16, l: 140 }, yaxis: { automargin: true } },
});

const waterfall = (spec: ChartSpec): Figure => ({
  data: [asData({ type: 'waterfall', x: spec.data.map((d) => label(d, spec.x)), y: spec.data.map((d) => d[spec.y]), measure: spec.data.map(() => 'relative') })],
  layout: {
    margin: { t: 16, r: 16, b: 80, l: 70 },
    xaxis: { title: { text: spec.x }, tickangle: -35, automargin: true },
    yaxis: { title: { text: spec.y }, tickformat: '~s', automargin: true },
  },
});

// Heatmap: x across, the series (second dimension) down, the measure as the colour.
const heatmap = (spec: ChartSpec): Figure => {
  const series = spec.color ?? '';
  const xs = unique(spec.data.map((d) => label(d, spec.x)));
  const ys = unique(spec.data.map((d) => label(d, series)));
  const xAt = new Map(xs.map((v, i) => [v, i]));
  const yAt = new Map(ys.map((v, i) => [v, i]));
  const z: (number | null)[][] = ys.map(() => xs.map(() => null));
  for (const d of spec.data) {
    const row = yAt.get(label(d, series))!;
    const col = xAt.get(label(d, spec.x))!;
    z[row][col] = (z[row][col] ?? 0) + sum(d, spec.y);
  }
  return {
    data: [asData({ type: 'heatmap', x: xs, y: ys, z, colorscale: 'Blues', colorbar: { tickformat: '~s' } })],
    layout: { margin: { t: 16, r: 16, b: 80, l: 120 }, xaxis: { title: { text: spec.x }, automargin: true }, yaxis: { title: { text: series }, automargin: true } },
  };
};

// Treemap and sunburst: every prefix of the path is a node, and each node is worth the sum of the rows under it.
const hierarchy = (spec: ChartSpec): Figure => {
  const path = spec.path ?? [spec.x];
  const nodes = new Map<string, { label: string; parent: string; value: number }>();
  for (const d of spec.data) {
    path.forEach((dim, k) => {
      const id = path.slice(0, k + 1).map((p) => label(d, p)).join(' / ');
      const node = nodes.get(id) ?? { label: label(d, dim), parent: path.slice(0, k).map((p) => label(d, p)).join(' / '), value: 0 };
      node.value += sum(d, spec.y);
      nodes.set(id, node);
    });
  }
  const ids = [...nodes.keys()];
  return {
    data: [asData({ type: spec.type, ids, labels: ids.map((id) => nodes.get(id)!.label), parents: ids.map((id) => nodes.get(id)!.parent), values: ids.map((id) => nodes.get(id)!.value), branchvalues: 'total', textinfo: 'label+value' })],
    layout: { margin: { t: 16, r: 16, b: 16, l: 16 } },
  };
};

// Sankey: one column of nodes per dimension, and a link between neighbouring columns for each combination.
const sankey = (spec: ChartSpec): Figure => {
  const path = spec.path ?? [spec.x];
  const index = new Map<string, number>();
  const names: string[] = [];
  const nodeAt = (level: number, name: string) => {
    const key = `${level}:${name}`; // the same name in two columns is two nodes
    if (!index.has(key)) {
      index.set(key, names.length);
      names.push(name);
    }
    return index.get(key)!;
  };
  const links = new Map<string, { source: number; target: number; value: number }>();
  for (const d of spec.data) {
    path.slice(1).forEach((dim, k) => {
      const source = nodeAt(k, label(d, path[k]));
      const target = nodeAt(k + 1, label(d, dim));
      const link = links.get(`${source}>${target}`) ?? { source, target, value: 0 };
      link.value += sum(d, spec.y);
      links.set(`${source}>${target}`, link);
    });
  }
  const all = [...links.values()];
  return {
    data: [
      asData({
        type: 'sankey',
        node: { label: names, pad: 14, thickness: 16, color: names.map((_, i) => colourOf(i)) },
        // Links are coloured explicitly: with a transparent background Plotly would draw them white.
        link: { source: all.map((l) => l.source), target: all.map((l) => l.target), value: all.map((l) => l.value), color: all.map((l) => withAlpha(colourOf(l.source), 0.35)) },
      }),
    ],
    layout: { margin: { t: 16, r: 16, b: 16, l: 16 } },
  };
};

export const figureOf = (spec: ChartSpec): Figure => {
  switch (spec.type) {
    case 'pie':
    case 'donut':
      return share(spec);
    case 'funnel':
      return funnel(spec);
    case 'waterfall':
      return waterfall(spec);
    case 'heatmap':
      return heatmap(spec);
    case 'treemap':
    case 'sunburst':
      return hierarchy(spec);
    case 'sankey':
      return sankey(spec);
    default:
      return cartesian(spec);
  }
};
