import type { TimelineEvent } from '../lib/types';
import { eventTypeLabel } from '../lib/display';

type TimelineProps = {
  events: TimelineEvent[];
  eyebrow?: string;
  title?: string;
  emptyMessage?: string;
};

export function Timeline({
  events,
  eyebrow = '타임라인',
  title = '융합 이벤트 스트림',
  emptyMessage = '표시할 이벤트가 없습니다.',
}: TimelineProps) {
  return (
    <section className="panel timeline-panel">
      <div className="panel__header">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <div className="timeline">
        {events.length === 0 ? (
          <p className="timeline__empty">{emptyMessage}</p>
        ) : events.map((event) => (
          <article className={`timeline__item timeline__item--${event.severity}`} key={event.id}>
            <time>{new Date(event.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
            <div>
              <strong>{event.title}</strong>
              <p>{event.description}</p>
              <small>{eventTypeLabel(event.type)} · {event.relatedIds.join(', ')}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
