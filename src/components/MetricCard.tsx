import type { ReactNode } from 'react';

export function MetricCard({ label, value, detail, tone = 'neutral', icon }: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'neutral' | 'watch' | 'warning' | 'good';
  icon?: ReactNode;
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__header">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
