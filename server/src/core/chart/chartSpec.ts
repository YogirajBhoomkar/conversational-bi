import type { ChartSpec } from '../../contracts';

// Charts are built in code, never by an AI agent. Genie returns the chart description as JSON; we turn it into a library-neutral chart spec.
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(v) && !Number.isNaN(Date.parse(v));

// The type names Genie can send, and the chart each one is drawn as.
const TYPE_OF: Record<string, ChartSpec['type']> = {
  column: 'bar', bar: 'bar', line: 'line', scatter: 'scatter', area: 'area', pie: 'pie', donut: 'donut',
  funnel: 'funnel', waterfall: 'waterfall', heatmap: 'heatmap', treemap: 'treemap', sunburst: 'sunburst', sankey: 'sankey',
};
export const SUPPORTED_CHART_TYPES = Object.keys(TYPE_OF);

export const buildChartSpec = (a: { type: ChartSpec['type']; x: string; y: string; color?: string; path?: string[]; title: string; columns: string[]; rows: unknown[][] }): ChartSpec => {
  const { type, x, y, color, path, title, columns, rows } = a;
  const xi = columns.indexOf(x);
  const xType: ChartSpec['xType'] = type === 'scatter' ? 'number' : type === 'line' && rows.every((row) => isDate(row[xi])) ? 'time' : 'category';
  // Genie can return numbers as strings; coerce the numeric axes so every chart library plots them correctly.
  const data = rows.map((row) => {
    const o: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      o[c] = c === y || (xType === 'number' && c === x) ? (row[i] === null ? null : Number(row[i])) : row[i];
    });
    return o;
  });
  if (xType === 'time') data.sort((p, q) => Date.parse(String(p[x])) - Date.parse(String(q[x])));
  return { type, title, x, y, ...(color ? { color } : {}), ...(path ? { path } : {}), xType, data };
};

// Genie answers a chart request with a single `chart_json` cell: {type, title, x, y, series, data:[{...}]}.
// Charts that show a hierarchy, a share or a flow (pie, donut, treemap, sunburst, sankey) send `path`, a list of dimensions, instead of `x`.
// Returns the real table plus a chart spec (null when there is nothing worth drawing, so the UI shows the table only;
// `skipped` then says why when Genie sent a chart the app cannot draw).
// Returns null when the result isn't of that shape at all.
export const parseGenieChartJson = (columns: string[], rows: unknown[][]) => {
  if (columns.length !== 1 || rows.length !== 1 || typeof rows[0][0] !== 'string') return null;
  let j: any;
  try {
    j = JSON.parse(rows[0][0]);
  } catch {
    return null;
  }
  const path: string[] | undefined = Array.isArray(j?.path) && j.path.length && j.path.every((d: unknown) => typeof d === 'string') ? j.path : undefined;
  const dims = path ?? (typeof j?.x === 'string' ? [j.x] : []);
  if (!j || !Array.isArray(j.data) || !j.data.length || typeof j.y !== 'string' || !dims.length) return null;
  const cols = Object.keys(j.data[0]);
  if (!cols.includes(j.y) || !dims.every((d) => cols.includes(d))) return null;
  const tableRows = j.data.map((d: Record<string, unknown>) => cols.map((c) => d[c] ?? null)) as unknown[][];

  const color = typeof j.series === 'string' && cols.includes(j.series) ? j.series : undefined;
  const type = TYPE_OF[String(j.type ?? '').toLowerCase()];
  // A flow needs at least two dimensions and a heatmap needs a second one (the series); otherwise there is nothing to draw.
  const complete = type && dims.length >= (type === 'sankey' ? 2 : 1) && (type !== 'heatmap' || color);
  const numericY = tableRows.every((r) => r[cols.indexOf(j.y)] === null || Number.isFinite(Number(r[cols.indexOf(j.y)])));
  // A single data point has nothing to compare against: the answer and the table say it better than a chart.
  if (tableRows.length < 2) return { columns: cols, rows: tableRows, chart: null };
  if (!complete || !numericY) {
    const skipped = !type ? `type "${j.type}" is not supported` : !numericY ? 'the values are not numbers' : 'the dimensions it needs are missing';
    return { columns: cols, rows: tableRows, chart: null, skipped };
  }
  return {
    columns: cols,
    rows: tableRows,
    chart: buildChartSpec({ type, x: dims[0], y: j.y, color, path, title: String(j.title ?? ''), columns: cols, rows: tableRows }),
  };
};
