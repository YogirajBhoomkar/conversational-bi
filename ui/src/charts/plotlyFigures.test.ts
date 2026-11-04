import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../types';
import { figureOf, supportsSpec } from './plotlyFigures';

const spec = (over: Partial<ChartSpec>): ChartSpec => ({ type: 'bar', title: 't', x: 'Region', y: 'Premium', xType: 'category', data: [], ...over });
const trace = (s: ChartSpec, i = 0) => figureOf(s).data[i] as any;

describe('bar, line, scatter and area', () => {
  const data = [
    { Year: 2023, Region: 'EMEA', Premium: 10 },
    { Year: 2023, Region: 'APAC', Premium: 5 },
    { Year: 2024, Region: 'EMEA', Premium: 12 },
  ];

  it('draws one trace per series, with the mode of each form', () => {
    const base = { x: 'Year', y: 'Premium', color: 'Region', data };
    expect(figureOf(spec({ ...base, type: 'bar' })).data).toHaveLength(2);
    expect(trace(spec({ ...base, type: 'bar' }))).toMatchObject({ type: 'bar', name: 'EMEA', x: [2023, 2024], y: [10, 12] });
    expect(trace(spec({ ...base, type: 'line' }))).toMatchObject({ type: 'scatter', mode: 'lines+markers' });
    expect(trace(spec({ ...base, type: 'scatter' }))).toMatchObject({ type: 'scatter', mode: 'markers' });
    expect(trace(spec({ ...base, type: 'area' }))).toMatchObject({ type: 'scatter', mode: 'lines', stackgroup: 'one' });
  });

  it('sets the axis type from xType and the form button that matches the chart', () => {
    const line = figureOf(spec({ type: 'line', xType: 'time', data: [{ Region: '2024-01', Premium: 1 }] }));
    expect(line.layout.xaxis?.type).toBe('date');
    expect(line.layout.updatemenus?.[0]).toMatchObject({ active: 1 });
    expect(figureOf(spec({ type: 'area', data })).layout.updatemenus?.[0]).toMatchObject({ active: 3 });
  });

  it('puts the axis type back whenever a form button is used, because a restyle resets it', () => {
    const buttons = (figureOf(spec({ type: 'bar', xType: 'category', data })).layout.updatemenus?.[0].buttons ?? []) as any[];
    expect(buttons.map((b) => b.label)).toEqual(['Bar', 'Line', 'Scatter', 'Area']);
    expect(buttons.every((b) => b.args[1]['xaxis.type'] === 'category')).toBe(true);
  });
});

describe('pie and donut', () => {
  const data = [{ Region: 'EMEA', Premium: 4 }, { Region: 'APAC', Premium: 3 }, { Region: 'EMEA', Premium: 6 }];

  it('adds up rows that repeat a slice', () => {
    expect(trace(spec({ type: 'pie', data }))).toMatchObject({ type: 'pie', labels: ['EMEA', 'APAC'], values: [10, 3], hole: 0 });
  });

  it('is a donut with a hole', () => {
    expect(trace(spec({ type: 'donut', data })).hole).toBe(0.5);
  });
});

describe('funnel and waterfall', () => {
  const data = [{ Region: 'A', Premium: 9 }, { Region: 'B', Premium: -2 }];

  it('keeps the funnel stages in the order the rows arrive', () => {
    expect(trace(spec({ type: 'funnel', data }))).toMatchObject({ type: 'funnel', y: ['A', 'B'], x: [9, -2] });
  });

  it('draws every waterfall step as a change', () => {
    expect(trace(spec({ type: 'waterfall', data }))).toMatchObject({ type: 'waterfall', x: ['A', 'B'], y: [9, -2], measure: ['relative', 'relative'] });
  });
});

describe('heatmap', () => {
  const data = [
    { Region: 'EMEA', Line: 'Marine', Premium: 1 },
    { Region: 'EMEA', Line: 'Marine', Premium: 2 },
    { Region: 'APAC', Line: 'Casualty', Premium: 5 },
  ];

  it('lays the series down the side and adds up repeated cells, leaving empty ones empty', () => {
    expect(trace(spec({ type: 'heatmap', color: 'Line', data }))).toMatchObject({ type: 'heatmap', x: ['EMEA', 'APAC'], y: ['Marine', 'Casualty'], z: [[3, null], [null, 5]] });
  });

  it('needs a series to draw', () => {
    expect(supportsSpec(spec({ type: 'heatmap', data }))).toBe(false);
    expect(supportsSpec(spec({ type: 'heatmap', color: 'Line', data }))).toBe(true);
  });
});

describe('treemap and sunburst', () => {
  const data = [
    { Region: 'EMEA', Line: 'Marine', Premium: 4 },
    { Region: 'EMEA', Line: 'Marine', Premium: 1 },
    { Region: 'EMEA', Line: 'Casualty', Premium: 3 },
    { Region: 'APAC', Line: 'Marine', Premium: 2 },
  ];
  const t = trace(spec({ type: 'treemap', path: ['Region', 'Line'], data }));
  const value = (id: string) => t.values[t.ids.indexOf(id)];

  it('makes a node for every prefix of the path', () => {
    expect(t.ids).toEqual(['EMEA', 'EMEA / Marine', 'EMEA / Casualty', 'APAC', 'APAC / Marine']);
    expect(t.parents).toEqual(['', 'EMEA', 'EMEA', '', 'APAC']);
    expect(t.labels[1]).toBe('Marine');
  });

  it('makes every parent worth exactly the sum of its children, which Plotly requires', () => {
    expect(value('EMEA / Marine')).toBe(5);
    expect(value('EMEA')).toBe(value('EMEA / Marine') + value('EMEA / Casualty'));
    expect(value('APAC')).toBe(value('APAC / Marine'));
  });

  it('is the same data for a sunburst', () => {
    expect(trace(spec({ type: 'sunburst', path: ['Region', 'Line'], data })).ids).toEqual(t.ids);
  });
});

describe('sankey', () => {
  const data = [
    { Region: 'EMEA', Line: 'Marine', Status: 'Signed', Count: 3 },
    { Region: 'EMEA', Line: 'Marine', Status: 'FOT', Count: 2 },
    { Region: 'APAC', Line: 'Signed', Status: 'Signed', Count: 4 }, // "Signed" is both a line (column 2) and a status (column 3)
  ];
  const t = trace(spec({ type: 'sankey', path: ['Region', 'Line', 'Status'], y: 'Count', data }));

  it('makes one node per name per column, so the same name in two columns is two nodes', () => {
    expect(t.node.label.filter((n: string) => n === 'Signed')).toHaveLength(2);
  });

  it('adds up rows that share a link', () => {
    const marine = t.node.label.indexOf('Marine');
    const emea = t.node.label.indexOf('EMEA');
    const at = t.link.source.findIndex((s: number, i: number) => s === emea && t.link.target[i] === marine);
    expect(t.link.value[at]).toBe(5);
  });

  it('draws one link per neighbouring pair of columns, in a visible colour', () => {
    expect(t.link.source).toHaveLength(t.link.value.length);
    expect(t.link.color.every((c: string) => c.startsWith('rgba(') && !c.startsWith('rgba(255, 255, 255'))).toBe(true);
  });

  it('needs at least two dimensions to draw', () => {
    expect(supportsSpec(spec({ type: 'sankey', path: ['Region'], data }))).toBe(false);
    expect(supportsSpec(spec({ type: 'sankey', data }))).toBe(false);
  });
});

describe('supportsSpec', () => {
  it('accepts the other types as they are', () => {
    for (const type of ['bar', 'line', 'scatter', 'area', 'pie', 'donut', 'funnel', 'waterfall', 'treemap', 'sunburst'] as const) expect(supportsSpec(spec({ type }))).toBe(true);
  });
});
