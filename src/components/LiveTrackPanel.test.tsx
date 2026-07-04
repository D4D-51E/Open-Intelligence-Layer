import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LiveTrackPanel } from './LiveTrackPanel';
import type { TrackFusionContext } from '../lib/trackFusion';
import type { AircraftIdentity } from '../lib/aircraftIdentity';
import type { AirspaceMatch } from '../lib/noticeAirspace';
import type { ShipTrack, Track } from '../lib/types';

const OBSERVED_AT = '2026-07-04T00:00:00.000Z';

const commercialTrack: Track = {
  id: 'trk-c',
  source: 'adsb-cache',
  callsign: 'CES501',
  originCountry: 'CN',
  platformType: 'commercial',
  baselineCorridorKm: 25,
  points: [{ lat: 37.5, lon: 126.5, altitudeM: 11000, velocityMs: 230, headingDeg: 90, observedAt: OBSERVED_AT }],
};

const militaryTrack: Track = { ...commercialTrack, id: 'trk-m', callsign: 'MIL77', isMilitary: true };

const cargoShip: ShipTrack = {
  id: 'ais-440123456',
  source: 'ais-cache',
  name: 'HANARO',
  mmsi: '440123456',
  vesselType: 'cargo',
  points: [{ lat: 37.4, lon: 126.5, speedKnots: 12.3, courseDeg: 210, observedAt: OBSERVED_AT }],
};

const fusionContext: TrackFusionContext = {
  trackId: 'trk-m',
  callsign: 'MIL77',
  axes: [
    { kind: 'weather', present: true, label: '기상', detail: '운량 40%, 가시거리 12,000m, 돌풍 30km/h — 관측 양호' },
    { kind: 'anomaly', present: false, label: '이상 신호', detail: '연계된 이상 신호 없음' },
  ],
  citations: [],
  gaps: ['이상 신호: 연계된 이상 신호 없음'],
};

function renderPanel(overrides: Partial<Parameters<typeof LiveTrackPanel>[0]> = {}) {
  const onSelectTrack = vi.fn();
  render(
    <LiveTrackPanel
      regionName="수도권"
      tracks={[commercialTrack, militaryTrack]}
      selectedTrackId={undefined}
      onSelectTrack={onSelectTrack}
      fusionContext={null}
      fusionEvents={[]}
      timeline={[]}
      militaryCount={1}
      identity={null}
      activeAirspace={[]}
      ships={[]}
      {...overrides}
    />,
  );
  return { onSelectTrack };
}

describe('LiveTrackPanel', () => {
  it('renders live tracks and emphasizes military aircraft', () => {
    renderPanel();

    expect(screen.getByText('CES501')).toBeInTheDocument();
    expect(screen.getByText('MIL77')).toBeInTheDocument();
    expect(screen.getByText('군용')).toBeInTheDocument();
    expect(screen.getByText(/군용 1기/)).toBeInTheDocument();
  });

  it('calls onSelectTrack with the clicked track id', async () => {
    const user = userEvent.setup();
    const { onSelectTrack } = renderPanel();

    await user.click(screen.getByText('MIL77'));

    expect(onSelectTrack).toHaveBeenCalledWith('trk-m');
  });

  it('shows the per-track fusion context when a track is selected', () => {
    renderPanel({ selectedTrackId: 'trk-m', fusionContext });

    expect(screen.getByText(/운량 40%/)).toBeInTheDocument();
    expect(screen.getByText(/공개 ADS-B\/공개 소스 노출·융합 보조/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no live tracks', () => {
    renderPanel({ tracks: [], militaryCount: 0 });

    expect(screen.getByText(/노출된 실시간 항적이 없습니다/)).toBeInTheDocument();
  });

  it('renders the AIS vessel list below the tracks', () => {
    renderPanel({ ships: [cargoShip] });

    expect(screen.getByText(/Live Vessels/)).toBeInTheDocument();
    expect(screen.getByText('HANARO')).toBeInTheDocument();
    expect(screen.getByText('화물선')).toBeInTheDocument();
    expect(screen.getByText('12.3kn')).toBeInTheDocument();
  });

  it('shows a vessel empty state when there are no ships', () => {
    renderPanel({ ships: [] });

    expect(screen.getByText(/표시된 선박\(AIS\)이 없습니다/)).toBeInTheDocument();
  });

  it('renders the aircraft identity card and active airspace for the selected track', () => {
    const identity: AircraftIdentity = {
      callsign: 'RCH431',
      icao24: 'ae1234',
      callsignProgram: 'USAF Reach (AMC 수송)',
      operatorCandidates: ['USAF', '미 공군'],
      registrationCountry: 'United States',
      militaryLikely: true,
      typeCandidate: 'Boeing C-17 Globemaster III',
      notes: ['콜사인 프리픽스 기반 휴리스틱'],
    };
    const activeAirspace: AirspaceMatch[] = [{
      notice: {
        id: 'ntm-1',
        regionId: 'seoul-airspace',
        source: 'skylink-notam-cache',
        title: 'Danger area active',
        description: '',
        publishedAt: OBSERVED_AT,
        lat: 37.5,
        lon: 126.5,
        radiusKm: 40,
        severity: 'watch',
      },
      airspace: { noticeId: 'ntm-1', kind: 'DANGER', flMin: 180, flMax: 350, active: true },
      withinRadius: true,
      withinAltBand: true,
    }];

    renderPanel({ selectedTrackId: 'trk-m', identity, activeAirspace });

    expect(screen.getByText(/RCH431 식별/)).toBeInTheDocument();
    expect(screen.getByText(/USAF Reach/)).toBeInTheDocument();
    expect(screen.getByText(/Boeing C-17/)).toBeInTheDocument();
    expect(screen.getByText(/활성 공역/)).toBeInTheDocument();
    expect(screen.getByText(/위험구역/)).toBeInTheDocument();
  });
});
