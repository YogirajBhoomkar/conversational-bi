import { useEffect, useRef, useState } from 'react';
import type { ChartSpec } from '../types';
import { HEIGHT } from './shared';
import { figureOf, supportsSpec } from './plotlyFigures';

// Plotly draws every chart type the server sends, as long as the spec has what its type needs.
export const supports = supportsSpec;

// Plotly is about 4.6 MB, so it is loaded the first time a chart is drawn instead of with the page.
type PlotlyApi = (typeof import('plotly.js-dist-min'))['default'];
let plotly: Promise<PlotlyApi> | undefined;
const loadPlotly = () =>
  (plotly ??= import('plotly.js-dist-min')
    .then((module) => module.default)
    .catch((error) => {
      plotly = undefined; // do not keep the failure here; the browser itself remembers it until the page is reloaded
      throw error;
    }));

export function Chart({ spec }: { spec: ChartSpec }) {
  const host = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stale = false;
    setFailed(false);
    loadPlotly()
      .then(async (Plotly) => {
        if (stale) return;
        const { data, layout } = figureOf(spec);
        await Plotly.react(
          el,
          data,
          { height: HEIGHT, font: { family: 'inherit', size: 12 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', ...layout },
          { displayModeBar: false, responsive: true },
        );
        if (!stale) setDrawn(true);
      })
      .catch((error) => {
        console.error('[chart] could not draw:', error);
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [spec]);

  // Release Plotly's resources only when the chart goes away, not on every update.
  useEffect(() => {
    const el = host.current;
    return () => {
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el)).catch(() => undefined); // nothing to release if Plotly never loaded
    };
  }, []);

  return (
    <>
      {failed ? (
        <p className="status">The chart could not be loaded. Reload the page to try again. The data is in the table below.</p>
      ) : (
        !drawn && <p className="status">Loading chart…</p>
      )}
      <div ref={host} role="img" aria-label={`${spec.type} chart: ${spec.title}`} />
    </>
  );
}
