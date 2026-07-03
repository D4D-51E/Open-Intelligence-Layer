import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FusionCopilotPanel } from './FusionCopilotPanel';
import type { FusionEvent } from '../lib/types';

function event(): FusionEvent {
  return {
    id: 'fusion-test-overview',
    regionId: 'taiwan-strait',
    title: '대만해협 융합 상황 요약',
    summary: '공개 항적과 기상 스냅샷을 같은 AOI 기준으로 결합했습니다.',
    severity: 'info',
    confidence: 0.72,
    confidenceFactors: {
      sourceReliability: 0.68,
      freshness: 0.54,
      crossSourceAgreement: 0.5,
      missingDataPenalty: 0.1,
    },
    observedAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    modules: ['fusion', 'tracks', 'weather'],
    relatedIds: ['track-1'],
    citations: [
      {
        id: 'fusion-opensky',
        label: 'OpenSky 항적 1건',
        source: 'opensky-cache',
        confidence: 0.78,
        observedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    recommendedAction: '항적 최신 상태와 기상 출처를 독립 확인합니다.',
    reviewDefault: 'queued',
    safetyNote: '공개 출처 기반 분석관 검토용 큐입니다. 표적 지정이나 행동 권고로 사용하지 않습니다.',
  };
}

describe('FusionCopilotPanel', () => {
  it('renders compact provenance, safety caveat, citation freshness, and review workflow', async () => {
    const user = userEvent.setup();
    const onReviewChange = vi.fn();
    render(
      <FusionCopilotPanel
        query="대만해협 항적 출처 확인"
        presets={[]}
        fusionEvents={[event()]}
        reviewStates={{}}
        compact
        onQueryChange={vi.fn()}
        onRunQuery={vi.fn()}
        onPreset={vi.fn()}
        onReviewChange={onReviewChange}
      />,
    );

    expect(screen.getByText(/출처 68% · 최신성 54% · 교차 50% · 공백 10%/)).toBeInTheDocument();
    expect(screen.getByText(/검토용 · 비표적화/)).toBeInTheDocument();
    expect(screen.getByText(/OpenSky 항적 1건 · opensky-cache · 78%/)).toBeInTheDocument();
    expect(screen.getByText(/다음 확인:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^검토$/ }));
    expect(onReviewChange).toHaveBeenCalledWith('fusion-test-overview', 'needs_review');
  });
});
