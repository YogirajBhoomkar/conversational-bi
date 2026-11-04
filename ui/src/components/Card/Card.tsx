import type { ReactNode } from 'react';
import './Card.css';

// The bordered card with a grey header strip used for the chart and the data table.
export default function Card({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      <div className="card__head">
        <b className="card__title">{title}</b>
        {meta}
      </div>
      {children}
    </div>
  );
}
