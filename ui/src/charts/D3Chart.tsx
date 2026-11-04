import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ChartSpec } from '../types';
import { formatNumber, HEIGHT, PALETTE, type Row, toSeries } from './shared';

// D3 draws the basic charts by hand; the other chart types need Plotly.
export const supports = (spec: ChartSpec) => ['bar', 'line', 'scatter'].includes(spec.type);

const LEGEND_WIDTH = 150;
const margin = { top: 12, right: 16, bottom: 90, left: 76 };

const xScale = (spec: ChartSpec, width: number) => {
  const values = spec.data.map((d) => d[spec.x]);
  if (spec.xType === 'category') {
    const band = d3.scaleBand([...new Set(values.map(String))], [0, width]).padding(0.2);
    return { axis: d3.axisBottom(band), pos: (d: Row) => (band(String(d[spec.x])) ?? 0) + band.bandwidth() / 2, bandwidth: band.bandwidth() };
  }
  if (spec.xType === 'time') {
    const time = d3.scaleUtc(d3.extent(values, (v) => new Date(String(v))) as [Date, Date], [0, width]);
    return { axis: d3.axisBottom(time), pos: (d: Row) => time(new Date(String(d[spec.x]))), bandwidth: 0 };
  }
  const linear = d3.scaleLinear(d3.extent(values, Number) as [number, number], [0, width]).nice();
  return { axis: d3.axisBottom(linear), pos: (d: Row) => linear(Number(d[spec.x])), bandwidth: 0 };
};

const draw = (host: HTMLElement, spec: ChartSpec, outerWidth: number) => {
  const series = toSeries(spec);
  const colour = d3.scaleOrdinal<string, string>(series.map(([name]) => name), PALETTE);
  const width = outerWidth - margin.left - margin.right - (spec.color ? LEGEND_WIDTH : 0);
  const height = HEIGHT - margin.top - margin.bottom;
  const x = xScale(spec, width);

  // Bars are stacked like in the other renderers: each starts where the previous series at the same x ended.
  const ends = new Map<string, number>();
  const bars = spec.type === 'bar'
    ? spec.data.map((d) => {
        const key = String(d[spec.x]);
        const y0 = ends.get(key) ?? 0;
        const y1 = y0 + (Number(d[spec.y]) || 0);
        ends.set(key, y1);
        return { d, y0, y1 };
      })
    : [];
  const extent = spec.type === 'bar' ? bars.flatMap((b) => [b.y0, b.y1]) : spec.data.map((d) => Number(d[spec.y]));
  const y = d3.scaleLinear([Math.min(0, d3.min(extent) ?? 0), d3.max(extent) ?? 0], [height, 0]).nice();

  const fill = (d: Row) => colour(spec.color ? String(d[spec.color]) : spec.y);
  const tooltip = (d: Row) => [spec.color && String(d[spec.color]), `${spec.x}: ${String(d[spec.x])}`, `${spec.y}: ${Number(d[spec.y]).toLocaleString()}`].filter(Boolean).join('\n');

  const svg = d3.select(host).selectAll('svg').data([null]).join('svg').attr('width', outerWidth).attr('height', HEIGHT);
  svg.selectAll('*').remove();
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g')
    .call(d3.axisLeft(y).ticks(6).tickFormat((v) => formatNumber(Number(v))).tickSize(-width))
    .call((axis) => axis.select('.domain').remove())
    .selectAll('.tick line').attr('stroke', '#e5e7eb');
  const xAxis = g.append('g').attr('transform', `translate(0,${height})`).call(x.axis);
  if (spec.xType === 'category') xAxis.selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end');
  g.append('text').attr('x', width / 2).attr('y', height + margin.bottom - 8).attr('text-anchor', 'middle').attr('font-size', 12).text(spec.x);
  g.append('text').attr('transform', 'rotate(-90)').attr('x', -height / 2).attr('y', 14 - margin.left).attr('text-anchor', 'middle').attr('font-size', 12).text(spec.y);

  if (spec.type === 'bar') {
    g.selectAll('rect').data(bars).join('rect')
      .attr('x', (b) => x.pos(b.d) - x.bandwidth / 2).attr('width', x.bandwidth)
      .attr('y', (b) => y(Math.max(b.y0, b.y1))).attr('height', (b) => Math.abs(y(b.y0) - y(b.y1)))
      .attr('fill', (b) => fill(b.d))
      .append('title').text((b) => tooltip(b.d));
  } else {
    if (spec.type === 'line') {
      const line = d3.line<Row>().defined((d) => d[spec.y] !== null).x(x.pos).y((d) => y(Number(d[spec.y])));
      g.selectAll('path.series').data(series).join('path')
        .attr('class', 'series').attr('fill', 'none').attr('stroke-width', 2)
        .attr('stroke', ([name]) => colour(name)).attr('d', ([, rows]) => line(rows));
    }
    g.selectAll('circle').data(spec.data.filter((d) => d[spec.y] !== null)).join('circle')
      .attr('cx', x.pos).attr('cy', (d) => y(Number(d[spec.y])))
      .attr('r', spec.type === 'line' ? 3 : 4).attr('fill', fill).attr('fill-opacity', spec.type === 'scatter' ? 0.7 : 1)
      .append('title').text(tooltip);
  }

  if (spec.color) {
    const legend = svg.append('g').attr('transform', `translate(${outerWidth - LEGEND_WIDTH + 8},${margin.top})`);
    series.forEach(([name], i) => {
      const item = legend.append('g').attr('transform', `translate(0,${i * 18})`);
      item.append('rect').attr('width', 10).attr('height', 10).attr('fill', colour(name));
      item.append('text').attr('x', 16).attr('y', 9).attr('font-size', 12).text(name.length > 18 ? `${name.slice(0, 17)}…` : name).append('title').text(name);
    });
  }
};

export function Chart({ spec }: { spec: ChartSpec }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (host.current && width > 0) draw(host.current, spec, width);
  }, [spec, width]);
  return <div ref={host} />;
}
