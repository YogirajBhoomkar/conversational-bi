import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-basic-dist-min';
import type { ChartSpec } from '../types';
import { HEIGHT, PALETTE, toSeries } from './shared';

const AXIS_TYPE = { category: 'category', time: 'date', number: 'linear' } as const;

export function Chart({ spec }: { spec: ChartSpec }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const traces: Plotly.Data[] = toSeries(spec).map(([name, rows], i) => ({
      name,
      type: spec.type === 'bar' ? 'bar' : 'scatter',
      mode: spec.type === 'line' ? 'lines+markers' : spec.type === 'scatter' ? 'markers' : undefined,
      x: rows.map((d) => d[spec.x]) as Plotly.Datum[],
      y: rows.map((d) => d[spec.y]) as Plotly.Datum[],
      marker: { color: PALETTE[i % PALETTE.length] },
    }));
    Plotly.react(
      el,
      traces,
      {
        height: HEIGHT,
        barmode: 'stack',
        showlegend: Boolean(spec.color),
        margin: { t: 16, r: 16, b: 80, l: 70 },
        font: { family: 'inherit', size: 12 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        xaxis: { type: AXIS_TYPE[spec.xType], title: { text: spec.x }, tickangle: spec.xType === 'category' ? -35 : 0, automargin: true },
        yaxis: { title: { text: spec.y }, tickformat: '~s', automargin: true },
      },
      { displayModeBar: false, responsive: true },
    );
    return () => Plotly.purge(el);
  }, [spec]);
  return <div ref={host} />;
}
