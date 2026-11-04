import { describe, expect, it } from 'vitest';
import { parseGenieChartJson, SUPPORTED_CHART_TYPES } from './chartSpec';

const blob = (over: object = {}) =>
  JSON.stringify({
    type: 'column', title: 'FOT premium', x: 'Underwriting Year', y: 'FOT Premium USD', series: 'Region',
    data: [
      { 'Underwriting Year': 2023, Region: 'APAC', 'FOT Premium USD': 111081000 },
      { 'Underwriting Year': 2023, Region: 'EMEA', 'FOT Premium USD': 239040000 },
    ],
    ...over,
  });

// Shapes Genie really sends for the types that take a list of dimensions (`path`) instead of `x`.
const flow = (over: object = {}) =>
  JSON.stringify({
    type: 'sankey', title: 'Placements', path: ['Region', 'Line of Business', 'Placement Status'], y: 'Placement Count',
    data: [
      { Region: 'APAC', 'Line of Business': 'Marine', 'Placement Status': 'Signed', 'Placement Count': 3 },
      { Region: 'EMEA', 'Line of Business': 'Casualty', 'Placement Status': 'FOT', 'Placement Count': '5' },
    ],
    ...over,
  });

describe('parseGenieChartJson', () => {
  it('turns a one-cell chart_json result into a table and a bar chart coloured by series', () => {
    const r = parseGenieChartJson(['chart_json'], [[blob()]])!;
    expect(r.columns).toEqual(['Underwriting Year', 'Region', 'FOT Premium USD']);
    expect(r.rows).toEqual([[2023, 'APAC', 111081000], [2023, 'EMEA', 239040000]]);
    expect(r.chart).toMatchObject({ type: 'bar', x: 'Underwriting Year', y: 'FOT Premium USD', color: 'Region', xType: 'category', title: 'FOT premium' });
    expect(r.chart!.data).toHaveLength(2);
  });

  it('maps line and scatter types', () => {
    expect(parseGenieChartJson(['c'], [[blob({ type: 'line' })]])!.chart!.type).toBe('line');
    expect(parseGenieChartJson(['c'], [[blob({ type: 'scatter' })]])!.chart).toMatchObject({ type: 'scatter', xType: 'number' });
  });

  it('uses a time axis for dated lines, sorted ascending, and coerces numeric strings', () => {
    const data = [{ m: '2024-03', v: '30' }, { m: '2024-01', v: '10' }];
    const chart = parseGenieChartJson(['c'], [[blob({ type: 'line', x: 'm', y: 'v', series: undefined, data })]])!.chart!;
    expect(chart.xType).toBe('time');
    expect(chart.data).toEqual([{ m: '2024-01', v: 10 }, { m: '2024-03', v: 30 }]);
  });

  it.each(['area', 'funnel', 'waterfall', 'pie', 'donut'])('draws %s from x and y', (type) => {
    expect(parseGenieChartJson(['c'], [[blob({ type, series: undefined })]])!.chart).toMatchObject({ type, x: 'Underwriting Year', y: 'FOT Premium USD' });
  });

  it('draws a heatmap from x, the series as the second dimension, and y', () => {
    expect(parseGenieChartJson(['c'], [[blob({ type: 'heatmap' })]])!.chart).toMatchObject({ type: 'heatmap', x: 'Underwriting Year', color: 'Region' });
    expect(parseGenieChartJson(['c'], [[blob({ type: 'heatmap', series: undefined })]])!.chart).toBeNull(); // nothing to put on the other axis
  });

  it.each(['sankey', 'treemap', 'sunburst'])('draws %s from a path of dimensions, with numbers coerced', (type) => {
    const chart = parseGenieChartJson(['c'], [[flow({ type })]])!.chart!;
    expect(chart).toMatchObject({ type, x: 'Region', y: 'Placement Count', path: ['Region', 'Line of Business', 'Placement Status'], xType: 'category' });
    expect(chart.data[1]['Placement Count']).toBe(5);
  });

  it('accepts a pie or donut that sends a one-dimension path instead of x', () => {
    const chart = parseGenieChartJson(['c'], [[flow({ type: 'donut', path: ['Region'] })]])!.chart!;
    expect(chart).toMatchObject({ type: 'donut', x: 'Region', path: ['Region'] });
  });

  it('needs two dimensions for a sankey', () => {
    expect(parseGenieChartJson(['c'], [[flow({ path: ['Region'] })]])!.chart).toBeNull();
  });

  it('keeps the table but draws nothing for an unsupported chart type', () => {
    const r = parseGenieChartJson(['c'], [[blob({ type: 'radar' })]])!;
    expect(r.chart).toBeNull();
    expect(r.rows).toHaveLength(2);
    expect(SUPPORTED_CHART_TYPES).not.toContain('radar');
  });

  it('returns null for results that are not chart JSON', () => {
    expect(parseGenieChartJson(['a', 'b'], [['1', '2']])).toBeNull();
    expect(parseGenieChartJson(['c'], [['not json']])).toBeNull();
    expect(parseGenieChartJson(['c'], [[JSON.stringify({ x: 'a', y: 'b' })]])).toBeNull(); // no data array
    expect(parseGenieChartJson(['c'], [[flow({ path: ['Nope'] })]])).toBeNull(); // a dimension that is not a column
  });
});
