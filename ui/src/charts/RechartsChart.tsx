import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartSpec } from '../types';
import { formatNumber, HEIGHT, PALETTE, toSeries } from './shared';

const formatMonth = (t: number) => new Date(t).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short' });

// Recharts wants one row per x value with a key per series.
const pivot = (spec: ChartSpec) => {
  const rows = new Map<string | number, Record<string, unknown>>();
  for (const [name, data] of toSeries(spec)) {
    for (const d of data) {
      const x = spec.xType === 'time' ? Date.parse(String(d[spec.x])) : String(d[spec.x]);
      rows.set(x, { ...rows.get(x), __x: x, [name]: d[spec.y] });
    }
  }
  return [...rows.values()];
};

export function Chart({ spec }: { spec: ChartSpec }) {
  const series = toSeries(spec);
  const category = spec.xType === 'category';
  const legend = spec.color ? <Legend verticalAlign="top" /> : null;

  if (spec.type === 'scatter') {
    return (
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey={spec.x} name={spec.x} tickFormatter={formatNumber} />
          <YAxis type="number" dataKey={spec.y} name={spec.y} tickFormatter={formatNumber} width={80} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
          {legend}
          {series.map(([name, data], i) => <Scatter key={name} name={name} data={data} fill={PALETTE[i % PALETTE.length]} />)}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis
        dataKey="__x"
        label={{ value: spec.x, position: 'insideBottom', offset: 6 }}
        {...(spec.xType === 'time'
          ? { type: 'number' as const, scale: 'time' as const, domain: ['dataMin', 'dataMax'], tickFormatter: formatMonth, height: 50 }
          : { angle: -35, textAnchor: 'end' as const, height: 90, interval: 0 })}
      />
      <YAxis tickFormatter={formatNumber} width={80} label={{ value: spec.y, angle: -90, position: 'insideLeft', offset: -4 }} />
      <Tooltip formatter={(v) => (typeof v === 'number' ? v.toLocaleString() : v)} labelFormatter={(l) => (category ? l : formatMonth(Number(l)))} />
      {legend}
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      {spec.type === 'line' ? (
        <LineChart data={pivot(spec)}>
          {axes}
          {series.map(([name], i) => <Line key={name} dataKey={name} stroke={PALETTE[i % PALETTE.length]} connectNulls isAnimationActive={false} />)}
        </LineChart>
      ) : (
        <BarChart data={pivot(spec)}>
          {axes}
          {series.map(([name], i) => <Bar key={name} dataKey={name} stackId="a" fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} />)}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
