import { useMemo, useState, type MouseEvent } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import Plotly from 'plotly.js-dist-min';
import * as factoryModule from 'react-plotly.js/factory';
import type { ChartSpec } from '../../types';
import { CORE_TYPES, TYPE_LABEL, availableTypes, buildFigure, type ChartType } from '../../chartsUtil/buildFigure';
import Card from '../Card/Card';
import './ChartCard.css';

// react-plotly.js is CommonJS; depending on the bundler the factory is the module or its `default`.
const createPlotlyComponent = ((factoryModule as unknown as { default?: unknown }).default ?? factoryModule) as (p: unknown) => React.ComponentType<Record<string, unknown>>;
const Plot = createPlotlyComponent(Plotly);

const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

export default function ChartCard({ spec }: { spec: ChartSpec }) {
  const [type, setType] = useState<ChartType>(spec.type);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const available = useMemo(() => availableTypes(spec), [spec]);
  const core = CORE_TYPES.filter((t) => available.includes(t));
  const more = available.filter((t) => !core.includes(t));
  const figure = useMemo(() => buildFigure(spec, type), [spec, type]);

  const openMore = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);

  const switcher = (
    <div className="chart-seg" role="group" aria-label="Chart type">
      {core.map((t) => (
        <ButtonBase key={t} className={`chart-seg__btn${t === type ? ' is-on' : ''}`} aria-pressed={t === type} onClick={() => setType(t)}>
          {TYPE_LABEL[t]}
        </ButtonBase>
      ))}
      {more.length > 0 && (
        <>
          <ButtonBase className={`chart-seg__btn${more.includes(type) ? ' is-on' : ''}`} aria-haspopup="menu" onClick={openMore}>
            {more.includes(type) ? TYPE_LABEL[type] : 'More'}
            <ArrowDropDownIcon className="chart-seg__caret" />
          </ButtonBase>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            {more.map((t) => (
              <MenuItem
                key={t}
                dense
                selected={t === type}
                onClick={() => {
                  setType(t);
                  setAnchor(null);
                }}
              >
                {TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </div>
  );

  return (
    <Card title={spec.title || 'Chart'} meta={switcher}>
      <div className="chart-card__body">
        <Plot data={figure.data} layout={figure.layout} config={CONFIG} useResizeHandler style={{ width: '100%', height: '340px' }} />
      </div>
    </Card>
  );
}
