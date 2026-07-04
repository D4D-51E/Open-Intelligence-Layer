import { Pause, Play } from 'lucide-react';

type TimelineControlsProps = {
  min: number;
  max: number;
  value: number;
  playing: boolean;
  label: string;
  onChange: (value: number) => void;
  onTogglePlay: () => void;
  disabled?: boolean;
};

export function TimelineControls({
  min,
  max,
  value,
  playing,
  label,
  onChange,
  onTogglePlay,
  disabled = false,
}: TimelineControlsProps) {
  return (
    <div className="timeline-controls">
      <button
        type="button"
        className="timeline-controls__play"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={playing ? '일시정지' : '재생'}
        aria-pressed={playing}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <input
        type="range"
        className="timeline-controls__range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="timeline-controls__label">{label}</span>
    </div>
  );
}
