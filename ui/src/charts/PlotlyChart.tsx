import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { ChartSpec } from '../types';
import { HEIGHT, PALETTE, type Row, toSeries } from './shared';

// Plotly draws every chart type the server sends, so nothing is left out of the table-only fallback.
export const supports = (_spec: ChartSpec) => true;

const AXIS_TYPE = { category: 'category', time: 'date', number: 'linear' } as const;
const colourOf = (i: number) => PALETTE[i % PALETTE.length];
const label = (d: Row, key: string) => String(d[key]);
const withAlpha = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
const unique = <T,>(values: T[]) => [...new Set(values)];

// The buttons that change the form of a bar, line, scatter or area chart are Plotly's own `updatemenus`; each one restyles the traces.
// A restyle resets the x axis type, so it is set again in the same step.
const FORMS = [
  { label: 'Bar', change: { type: 'bar', mode: null, stackgroup: null } },
  { label: 'Line', change: { type: 'scatter', mode: 'lines+markers', stackgroup: null } },
  { label: 'Scatter', change: { type: 'scatter', mode: 'markers', stackgroup: null } },
  { label: 'Area', change: { type: 'scatter', mode: 'lines', stackgroup: 'one' } },
];
const FORM_INDEX: Partial<Record<ChartSpec['type'], number>> = { bar: 0, line: 1, scatter: 2, area: 3 };

type Figure = { data: Plotly.Data[]; layout: Partial<Plotly.Layout> };
const asData = (trace: object) => trace as unknown as Plotly.Data;

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
  for (const d of spec.data) totals.set(label(d, spec.x), (totals.get(label(d, spec.x)) ?? 0) + (Number(d[spec.y]) || 0));
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
  const xs = unique(spec.data.map((d) => label(d, spec.x)));
  const ys = unique(spec.data.map((d) => label(d, spec.color!)));
  const z: (number | null)[][] = ys.map(() => xs.map(() => null));
  for (const d of spec.data) {
    const row = ys.indexOf(label(d, spec.color!));
    const col = xs.indexOf(label(d, spec.x));
    z[row][col] = (z[row][col] ?? 0) + (Number(d[spec.y]) || 0);
  }
  return {
    data: [asData({ type: 'heatmap', x: xs, y: ys, z, colorscale: 'Blues', colorbar: { tickformat: '~s' } })],
    layout: { margin: { t: 16, r: 16, b: 80, l: 120 }, xaxis: { title: { text: spec.x }, automargin: true }, yaxis: { title: { text: spec.color }, automargin: true } },
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
      node.value += Number(d[spec.y]) || 0;
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
    const key = `${level}:${name}`;
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
      link.value += Number(d[spec.y]) || 0;
      links.set(`${source}>${target}`, link);
    });
  }
  const all = [...links.values()];
  return {
    data: [asData({ type: 'sankey', node: { label: names, pad: 14, thickness: 16, color: names.map((_, i) => colourOf(i)) }, link: { source: all.map((l) => l.source), target: all.map((l) => l.target), value: all.map((l) => l.value), color: all.map((l) => withAlpha(colourOf(l.source), 0.35)) } })], // links are coloured explicitly: with a transparent background Plotly would draw them white
    layout: { margin: { t: 16, r: 16, b: 16, l: 16 } },
  };
};

const figureOf = (spec: ChartSpec): Figure => {
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

export function Chart({ spec }: { spec: ChartSpec }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const { data, layout } = figureOf(spec);
    Plotly.react(
      el,
      data,
      { height: HEIGHT, font: { family: 'inherit', size: 12 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', ...layout },
      { displayModeBar: false, responsive: true },
    );
    return () => Plotly.purge(el);
  }, [spec]);
  return <div ref={host} />;
}
