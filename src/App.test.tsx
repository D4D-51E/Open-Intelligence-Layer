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

describe('AirMaven Lite app', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('live cache unavailable in unit test'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the core MVP slices with citations and caveats', async () => {
    render(<App />);

    expect(screen.getByRole('main', { name: /공중 ISR 융합 상황판/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^관심지역$/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^데이터$/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /^화면$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /mocked situation map/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /확인 신호/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /수집 상태/i })).toBeInTheDocument();
    expect(screen.queryByText(/D4D T2 예비 프로토타입/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AirMaven Lite/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/의사결정 보조 전용/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /데모/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('switches region scenarios without live network access', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /^관심지역$/ }), 'west-sea-nll');

    expect(screen.getByRole('heading', { name: /^서해\/NLL 인근$/i })).toBeInTheDocument();
    expect(screen.queryByText(/GRAY09/i)).not.toBeInTheDocument();
    expect(screen.getByText(/표시 항적 0\/0/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('can switch back to the narrative scroll report', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /^화면$/ }), 'narrative');

    expect(screen.getByRole('heading', { name: /무료\/공개 API 계획/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/스냅샷 사용 불가/i)).toBeInTheDocument());
  });

  it('applies natural-language presets and analyst review state in the fusion copilot', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByRole('textbox', { name: /자연어 질의/i }));
    await user.type(screen.getByRole('textbox', { name: /자연어 질의/i }), '서해 NLL 데이터 공백과 출처 품질을 설명해줘');
    await user.click(screen.getByRole('button', { name: /적용/i }));

    expect(screen.getByRole('heading', { name: /^서해\/NLL 인근$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/합성 이벤트는 만들지 않습니다|융합 상황 요약/i).length).toBeGreaterThan(0);

    const reviewButtons = screen.queryAllByRole('button', { name: /^검토$/ });
    if (reviewButtons.length > 0) {
      await user.click(reviewButtons[0]);
      expect(screen.getAllByText(/검토 필요/i).length).toBeGreaterThan(0);
    }
  });

});
