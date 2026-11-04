import type { Data, Layout } from 'plotly.js';
import type { ChartSpec } from '../types';

export type ChartType = ChartSpec['type'];
type Row = Record<string, unknown>;

export const PALETTE = ['#0b2a8a', '#0067b1', '#7b3fe4', '#1a9d4b', '#f59e0b', '#e11d48', '#38bdf8', '#6b7280'];

export const TYPE_LABEL: Record<ChartType, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  scatter: 'Scatter',
  pie: 'Pie',
  donut: 'Donut',
  funnel: 'Funnel',
  waterfall: 'Waterfall',
  heatmap: 'Heatmap',
  treemap: 'Treemap',
  sunburst: 'Sunburst',
  sankey: 'Sankey',
};

/** Shown as the segmented buttons in the card header; every other type goes under "More". */
export const CORE_TYPES: ChartType[] = ['line', 'bar', 'area', 'pie'];

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];
const dimsOf = (s: ChartSpec): string[] => (s.path?.length ? s.path : [s.x]);

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The chart types this data can be drawn as, so the switcher never offers a chart that has nothing to show. */
export function availableTypes(spec: ChartSpec): ChartType[] {
  const out: ChartType[] = ['line', 'bar', 'area', 'scatter', 'pie', 'donut', 'funnel', 'waterfall', 'treemap', 'sunburst'];
  if (spec.color) out.push('heatmap'); // needs a second dimension
  if (dimsOf(spec).length >= 2) out.push('sankey'); // needs a flow between two dimensions
  if (!out.includes(spec.type)) out.push(spec.type);
  return out;
}

const fontFamily = 'Roboto, "Segoe UI", Arial, sans-serif';

function baseLayout(): Partial<Layout> {
  return {
    autosize: true,
    margin: { l: 56, r: 16, t: 16, b: 48 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: fontFamily, size: 12, color: '#6b7280' },
    hoverlabel: { bgcolor: '#111827', bordercolor: '#111827', font: { color: '#fff', family: fontFamily, size: 12 } },
    colorway: PALETTE,
  };
}

function cartesianLayout(spec: ChartSpec, type: ChartType): Partial<Layout> {
  const forceCategory = type === 'heatmap' || type === 'waterfall';
  const xType = forceCategory ? 'category' : spec.xType === 'time' ? 'date' : spec.xType === 'number' ? 'linear' : 'category';
  const hasLegend = !!spec.color && type !== 'heatmap' && type !== 'waterfall';
  return {
    ...baseLayout(),
    xaxis: { type: xType, title: { text: spec.x }, gridcolor: '#e5e8ee', automargin: true },
    yaxis: {
      title: { text: type === 'heatmap' ? (spec.color ?? '') : spec.y },
      gridcolor: '#e5e8ee',
      zerolinecolor: '#cfd6e4',
      automargin: true,
      rangemode: type === 'bar' || type === 'area' ? 'tozero' : 'normal',
      type: type === 'heatmap' ? 'category' : undefined,
    },
    barmode: 'group',
    showlegend: hasLegend,
    legend: { orientation: 'h', y: -0.28 },
    hovermode: type === 'scatter' || type === 'heatmap' ? 'closest' : 'x unified',
  } as Partial<Layout>;
}

function series(spec: ChartSpec): { name: string; rows: Row[] }[] {
  if (!spec.color) return [{ name: spec.y, rows: spec.data }];
  const groups = new Map<string, Row[]>();
  for (const r of spec.data) {
    const k = str(r[spec.color]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([name, rows]) => ({ name, rows }));
}

function cartesian(spec: ChartSpec, type: 'bar' | 'line' | 'area' | 'scatter'): unknown[] {
  return series(spec).map((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const trace: Record<string, unknown> = {
      x: s.rows.map((r) => r[spec.x]),
      y: s.rows.map((r) => num(r[spec.y])),
      name: s.name,
      marker: { color },
    };
    if (type === 'bar') {
      trace.type = 'bar';
    } else {
      trace.type = 'scatter';
      trace.mode = type === 'scatter' ? 'markers' : 'lines+markers';
      trace.line = { color, width: 2.6 };
      (trace.marker as Record<string, unknown>).size = type === 'scatter' ? 9 : 6;
      if (type === 'area') {
        trace.fill = spec.color ? 'tonexty' : 'tozeroy';
        trace.fillcolor = rgba(color, 0.22);
        if (spec.color) trace.stackgroup = 'one';
      }
    }
    return trace;
  });
}

// Treemap and sunburst take a tree: every ancestor gets the sum of its leaves.
function hierarchy(spec: ChartSpec) {
  const dims = dimsOf(spec);
  const nodes = new Map<string, { label: string; parent: string; value: number }>();
  for (const r of spec.data) {
    const v = num(r[spec.y]);
    if (v === null) continue;
    const parts = dims.map((d) => str(r[d]));
    for (let depth = 1; depth <= parts.length; depth++) {
      const id = parts.slice(0, depth).join(' / ');
      const node = nodes.get(id) ?? { label: parts[depth - 1], parent: depth > 1 ? parts.slice(0, depth - 1).join(' / ') : '', value: 0 };
      node.value += v;
      nodes.set(id, node);
    }
  }
  const all = [...nodes];
  return { ids: all.map(([id]) => id), labels: all.map(([, n]) => n.label), parents: all.map(([, n]) => n.parent), values: all.map(([, n]) => n.value) };
}

function sankey(spec: ChartSpec): unknown[] {
  const dims = dimsOf(spec);
  const index = new Map<string, number>();
  const labels: string[] = [];
  const nodeOf = (level: number, label: string) => {
    const key = `${level}|${label}`;
    let i = index.get(key);
    if (i === undefined) {
      i = labels.length;
      labels.push(label);
      index.set(key, i);
    }
    return i;
  };
  const links = new Map<string, { s: number; t: number; v: number }>();
  for (const r of spec.data) {
    const v = num(r[spec.y]);
    if (v === null) continue;
    const parts = dims.map((d) => str(r[d]));
    for (let l = 0; l < parts.length - 1; l++) {
      const s = nodeOf(l, parts[l]);
      const t = nodeOf(l + 1, parts[l + 1]);
      const key = `${s}->${t}`;
      const cur = links.get(key) ?? { s, t, v: 0 };
      cur.v += v;
      links.set(key, cur);
    }
  }
  const all = [...links.values()];
  return [
    {
      type: 'sankey',
      orientation: 'h',
      node: { label: labels, pad: 16, thickness: 18, color: labels.map((_, i) => PALETTE[i % PALETTE.length]), line: { width: 0 } },
      link: { source: all.map((l) => l.s), target: all.map((l) => l.t), value: all.map((l) => l.v) },
    },
  ];
}

export function buildFigure(spec: ChartSpec, type: ChartType): { data: Data[]; layout: Partial<Layout> } {
  const dims = dimsOf(spec);
  const rows = spec.data;
  const labels = rows.map((r) => str(r[dims[0]]));
  const values = rows.map((r) => num(r[spec.y]));

  switch (type) {
    case 'bar':
    case 'line':
    case 'area':
    case 'scatter':
      return { data: cartesian(spec, type) as Data[], layout: cartesianLayout(spec, type) };

    case 'pie':
    case 'donut':
      return {
        data: [
          {
            type: 'pie',
            labels,
            values,
            hole: type === 'donut' ? 0.5 : 0,
            sort: false,
            marker: { colors: PALETTE, line: { color: '#fff', width: 1.5 } },
            textinfo: 'label+percent',
          },
        ] as unknown as Data[],
        layout: { ...baseLayout(), margin: { l: 16, r: 16, t: 16, b: 16 }, showlegend: true, legend: { orientation: 'h', y: -0.1 } },
      };

    case 'funnel':
      return {
        data: [{ type: 'funnel', y: labels, x: values, marker: { color: PALETTE[0] }, textinfo: 'value+percent initial' }] as unknown as Data[],
        layout: { ...baseLayout(), margin: { l: 16, r: 16, t: 16, b: 16 }, yaxis: { automargin: true } },
      };

    case 'waterfall':
      return {
        data: [
          {
            type: 'waterfall',
            x: labels,
            y: values,
            measure: labels.map(() => 'relative'),
            connector: { line: { color: '#cfd6e4' } },
            increasing: { marker: { color: '#1a9d4b' } },
            decreasing: { marker: { color: '#c0392b' } },
            totals: { marker: { color: PALETTE[0] } },
          },
        ] as unknown as Data[],
        layout: cartesianLayout(spec, 'waterfall'),
      };

    case 'heatmap': {
      const xs = uniq(rows.map((r) => str(r[spec.x])));
      const cs = uniq(rows.map((r) => str(r[spec.color ?? ''])));
      const z: (number | null)[][] = cs.map(() => xs.map(() => null));
      for (const r of rows) {
        const v = num(r[spec.y]);
        if (v === null) continue;
        const ci = cs.indexOf(str(r[spec.color ?? '']));
        const xi = xs.indexOf(str(r[spec.x]));
        z[ci][xi] = (z[ci][xi] ?? 0) + v;
      }
      return {
        data: [{ type: 'heatmap', x: xs, y: cs, z, colorscale: [[0, '#eef2ff'], [1, '#0b2a8a']], hoverongaps: false }] as unknown as Data[],
        layout: cartesianLayout(spec, 'heatmap'),
      };
    }

    case 'treemap':
    case 'sunburst': {
      const h = hierarchy(spec);
      return {
        data: [{ type, ...h, branchvalues: 'total', textinfo: 'label+value', marker: { line: { width: 1, color: '#fff' } } }] as unknown as Data[],
        layout: { ...baseLayout(), margin: { l: 8, r: 8, t: 8, b: 8 } },
      };
    }

    case 'sankey':
      return { data: sankey(spec) as Data[], layout: { ...baseLayout(), margin: { l: 8, r: 8, t: 8, b: 8 } } };
  }
}
