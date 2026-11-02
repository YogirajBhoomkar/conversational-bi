import { describe, expect, it } from 'vitest';
import { parseGenieChartJson } from './chartSpec';

const blob = (over: object = {}) =>
  JSON.stringify({
    type: 'column', title: 'FOT premium', x: 'Underwriting Year', y: 'FOT Premium USD', series: 'Region',
    data: [
      { 'Underwriting Year': 2023, Region: 'APAC', 'FOT Premium USD': 111081000 },
      { 'Underwriting Year': 2023, Region: 'EMEA', 'FOT Premium USD': 239040000 },
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

  it('keeps the table but draws nothing for an unsupported chart type', () => {
    const r = parseGenieChartJson(['c'], [[blob({ type: 'pie' })]])!;
    expect(r.chart).toBeNull();
    expect(r.rows).toHaveLength(2);
  });

  it('returns null for results that are not chart JSON', () => {
    expect(parseGenieChartJson(['a', 'b'], [['1', '2']])).toBeNull();
    expect(parseGenieChartJson(['c'], [['not json']])).toBeNull();
    expect(parseGenieChartJson(['c'], [[JSON.stringify({ x: 'a', y: 'b' })]])).toBeNull(); // no data array
  });
});
