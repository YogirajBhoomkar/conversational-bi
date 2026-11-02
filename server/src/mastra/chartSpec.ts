import type { ChartSpec } from '../contracts';

// Charts are built in code, never by an AI agent. Genie returns the chart description as JSON; we turn it into a library-neutral chart spec.
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(v) && !Number.isNaN(Date.parse(v));

export const buildChartSpec = (a: { type: ChartSpec['type']; x: string; y: string; color?: string; title: string; columns: string[]; rows: unknown[][] }): ChartSpec => {
  const { type, x, y, color, title, columns, rows } = a;
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
  return { type, title, x, y, ...(color ? { color } : {}), xType, data };
};

// Genie answers a chart request with a single `chart_json` cell: {type, title, x, y, series, data:[{...}]}.
// Returns the real table plus a chart spec (null when the chart type isn't supported, so the UI shows the table only).
// Returns null when the result isn't of that shape at all.
export const parseGenieChartJson = (columns: string[], rows: unknown[][]) => {
  if (columns.length !== 1 || rows.length !== 1 || typeof rows[0][0] !== 'string') return null;
  let j: any;
  try {
    j = JSON.parse(rows[0][0]);
  } catch {
    return null;
  }
  if (!j || !Array.isArray(j.data) || !j.data.length || typeof j.x !== 'string' || typeof j.y !== 'string') return null;
  const cols = Object.keys(j.data[0]);
  if (!cols.includes(j.x) || !cols.includes(j.y)) return null;
  const tableRows = j.data.map((d: Record<string, unknown>) => cols.map((c) => d[c] ?? null)) as unknown[][];

  const t = String(j.type ?? '').toLowerCase();
  const chartType: ChartSpec['type'] | null = t === 'column' || t === 'bar' ? 'bar' : t === 'line' ? 'line' : t === 'scatter' ? 'scatter' : null;
  const numericY = tableRows.every((r) => r[cols.indexOf(j.y)] === null || Number.isFinite(Number(r[cols.indexOf(j.y)])));
  if (!chartType || !numericY) {
    console.warn(`[chart] not drawing: type="${j.type}" numericY=${numericY}. Supported types: column, bar, line, scatter.`);
    return { columns: cols, rows: tableRows, chart: null };
  }
  const color = typeof j.series === 'string' && cols.includes(j.series) ? j.series : undefined;
  return {
    columns: cols,
    rows: tableRows,
    chart: buildChartSpec({ type: chartType, x: j.x, y: j.y, color, title: String(j.title ?? ''), columns: cols, rows: tableRows }),
  };
};
