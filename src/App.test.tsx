import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/SituationMap', () => ({
  SituationMap: ({ region, tracks }: { region: { name: string }; tracks: { callsign: string }[] }) => (
    <div role="img" aria-label={`${region.name} mocked situation map`}>
      {tracks.map((track) => <span key={track.callsign}>{track.callsign}</span>)}
    </div>
  )
}));

describe('AirMaven live-track fusion app', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('live cache unavailable in unit test'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the live-track fusion pivot without any claim-verification UI', async () => {
    render(<App />);

    expect(screen.getByRole('main', { name: /실시간 항적·다중소스 융합 상황판/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^관심지역$/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^데이터$/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /^화면$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /mocked situation map/i })).toBeInTheDocument();

    // LiveTrackPanel tabs are the new hero, not a claim queue.
    expect(screen.getByRole('tab', { name: /항적/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /융합/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /이력/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^군용$/ })).toBeInTheDocument();

    // Claim verification is gone.
    expect(screen.queryByText(/주장 검증 대기열/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /검증 브리핑/i })).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('switches region scenarios without live network access', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /^관심지역$/ }), 'west-sea-nll');

    expect(screen.getByRole('heading', { name: /^서해\/NLL 인근$/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('can switch to the narrative report with the multi-source matrix and safety footer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /^화면$/ }), 'narrative');

    expect(screen.getByRole('heading', { name: /다중소스 연계 매트릭스/i })).toBeInTheDocument();
    expect(screen.getByText(/식별·표적 지정·타격 권고·자동 교전 판단을 수행하지 않습니다/i)).toBeInTheDocument();
    expect(screen.queryByText(/주장 검증 대기열/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });
});
