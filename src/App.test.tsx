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

describe('AirMaven Verify app', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('live cache unavailable in unit test'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the verify pivot with claim queue, verdict, citations, and caveats', async () => {
    render(<App />);

    expect(screen.getByRole('main', { name: /AirMaven Verify OSINT 검증 상황판/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^관심지역$/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^데이터$/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /^화면$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /mocked situation map/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /주장 검증 대기열/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /F-35 격추 주장/i })).toBeInTheDocument();
    expect(screen.getByText(/False \/ Deceptive/i)).toBeInTheDocument();
    expect(screen.getAllByText(/공개 ADS-B 부재|무료 공개 위성/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /수집 상태/i })).toBeInTheDocument();
    expect(screen.queryByText(/AirMaven Lite/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /데모/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('switches region scenarios without live network access', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /^관심지역$/ }), 'west-sea-nll');

    expect(screen.getByRole('heading', { name: /^서해\/NLL 인근$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/서해 폐쇄 주장/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /주장 2/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('can switch back to the narrative scroll report', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /^화면$/ }), 'narrative');

    expect(screen.getByRole('heading', { name: /검증 소스 연계 매트릭스/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /주장 검증 대기열/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /근거 확인 이력/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('lets the analyst select another claim and updates the verification verdict panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /KADIZ 대량 진입/i }));

    expect(screen.getByRole('heading', { name: /KADIZ 대량 진입/i })).toBeInTheDocument();
    expect(screen.getAllByText(/공식 NOTAM 근거 없음|직접적인 공개 항적 증거 없음/).length).toBeGreaterThan(0);
  });
});
