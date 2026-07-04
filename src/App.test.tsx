import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

// maplibre-gl does not run in jsdom, so mock the globe with a lightweight stand-in.
vi.mock('./components/SituationRealGlobe', () => ({
  SituationRealGlobe: ({ tracks }: { tracks: { callsign: string }[] }) => (
    <div role="img" aria-label="mocked globe">
      {tracks.map((track) => <span key={track.callsign}>{track.callsign}</span>)}
    </div>
  ),
}));

describe('AirMaven fullscreen globe app', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline in unit test'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the fullscreen globe shell with HUD, filters, and the live track panel', () => {
    render(<App />);

    expect(screen.getByRole('main', { name: /실시간 항적 글로브/i })).toBeInTheDocument();
    expect(screen.getByText('AirMaven')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /mocked globe/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /유형/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /최소 고도/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /타임라인/ })).toBeInTheDocument();
    // live track panel hero is present
    expect(screen.getByRole('tab', { name: /항적/ })).toBeInTheDocument();
    // no legacy claim-verification UI
    expect(screen.queryByText(/주장 검증/)).not.toBeInTheDocument();
  });

  it('toggles timeline mode and shows the timeline controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('button', { name: /타임라인 OFF/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /타임라인/ }));
    expect(screen.getByRole('button', { name: /타임라인 ON/ })).toBeInTheDocument();
  });
});
