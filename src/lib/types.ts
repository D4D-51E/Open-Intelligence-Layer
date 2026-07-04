export type RegionId = 'global' | 'seoul-airspace' | 'taiwan-strait' | 'south-china-sea' | 'west-sea-nll';

export type Severity = 'info' | 'watch' | 'warning';

export type LiveSourceStatus = 'live' | 'cached' | 'standby' | 'empty' | 'rate-limited' | 'unsupported' | 'disabled' | 'unavailable';

export type Region = {
  id: RegionId;
  name: string;
  shortName: string;
  description: string;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
  bboxSource?: string;
  bboxSourceUrl?: string;
  bboxNote?: string;
};

export type TrackPoint = {
  lat: number;
  lon: number;
  altitudeM: number;
  velocityMs: number;
  headingDeg: number;
  observedAt: string;
};

export type Track = {
  id: string;
  source: 'opensky-cache' | 'adsb-cache';
  callsign: string;
  originCountry: string;
  platformType: 'commercial' | 'unknown' | 'cargo';
  points: TrackPoint[];
  baselineCorridorKm: number;
  notes?: string;
  isMilitary?: boolean;
  icao24?: string;
  registration?: string;
  typeCode?: string;
};

export type ShipTrackPoint = {
  lat: number;
  lon: number;
  speedKnots: number;
  courseDeg: number;
  observedAt: string;
};

export type ShipTrack = {
  id: string;
  source: 'ais-cache';
  name: string;
  mmsi?: string;
  vesselType: 'cargo' | 'tanker' | 'fishing' | 'unknown';
  points: ShipTrackPoint[];
  notes?: string;
};

export type WeatherSnapshot = {
  id: string;
  source: 'open-meteo-cache';
  regionId: RegionId;
  observedAt: string;
  temperatureC: number;
  windSpeedKmh: number;
  windGustKmh: number;
  visibilityM: number;
  cloudCoverPct: number;
  precipitationMm: number;
  weatherCode: number;
};

export type OsintItem = {
  id: string;
  source: 'gdelt-cache' | 'google-news-rss-cache';
  regionId: RegionId;
  title: string;
  url?: string;
  domain?: string;
  publishedAt: string;
  summary: string;
  tags: string[];
  confidence: number;
  clusterId?: string;
  clusterSize?: number;
  clusterSpanMinutes?: number;
  publisherCount?: number;
  clusterHeadline?: string;
};

export type SatellitePass = {
  id: string;
  source: 'celestrak-cache';
  name: string;
  noradId?: string;
  observedAt: string;
  lat: number;
  lon: number;
  groundTrack?: [number, number][];
  altitudeKm: number;
  direction: string;
  roleHint: 'public orbital awareness' | 'weather' | 'communications' | 'earth observation';
};

export type AirportContext = {
  id: string;
  source: 'ourairports-cache';
  ident: string;
  name: string;
  type: 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport' | 'closed' | 'unknown';
  lat: number;
  lon: number;
  elevationFt?: number;
  municipality?: string;
  isoCountry?: string;
  scheduledService?: boolean;
  url?: string;
};

export type AirRoute = {
  id: string;
  regionId: RegionId;
  source: 'ourairports-derived-route';
  name: string;
  description: string;
  points: [number, number][];
  corridorKm?: number;
  sourceUrl?: string;
};

export type AirspaceNotice = {
  id: string;
  regionId: RegionId;
  source: 'icao-notam-cache' | 'skylink-notam-cache' | 'osint-derived-notice';
  title: string;
  description: string;
  publishedAt: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  lat: number;
  lon: number;
  radiusKm: number;
  severity: Severity;
  url?: string;
};

export type AirspaceContext = {
  id: string;
  regionId: RegionId;
  source: 'icao-fir-cache';
  icaoCode: string;
  firName: string;
  state?: string;
  icaoRegion?: string;
  type?: string;
  lat: number;
  lon: number;
  observedAt: string;
};

export type OsintMapEvent = {
  id: string;
  regionId: RegionId;
  source: OsintItem['source'] | 'claim-review-cache' | 'nasa-firms-match' | 'osint-cluster-review';
  title: string;
  lat: number;
  lon: number;
  observedAt: string;
  confidence: number;
  relatedOsintId: string;
  domain?: string;
  url?: string;
  tags: string[];
};

export type SatelliteScene = {
  id: string;
  regionId: RegionId;
  source: 'copernicus-stac-cache' | 'landsat-scene-link' | 'commercial-imagery-link';
  provider: string;
  platform: string;
  productType?: string;
  observedAt: string;
  cloudCoverPct?: number;
  bbox?: [number, number, number, number];
  url?: string;
  summary: string;
};

export type ThermalAnomaly = {
  id: string;
  regionId: RegionId;
  source: 'nasa-firms-cache';
  provider: 'NASA FIRMS';
  lat: number;
  lon: number;
  observedAt: string;
  confidence?: number;
  brightnessKelvin?: number;
  frpMw?: number;
  satellite?: string;
  url?: string;
};

export type WatchZone = {
  id: string;
  regionId: RegionId;
  name: string;
  description: string;
  severity: Severity;
  polygon: [number, number][];
};

export type ReferenceLine = {
  id: string;
  regionId: RegionId;
  name: string;
  description: string;
  source: string;
  sourceUrl: string;
  points: [number, number][];
};

export type FusionReviewStatus = 'queued' | 'needs_review' | 'confirmed' | 'dismissed';

export type TimelineEvent = {
  id: string;
  regionId: RegionId;
  time: string;
  type: 'track' | 'ship' | 'weather' | 'osint' | 'osint-event' | 'satellite' | 'satellite-scene' | 'thermal' | 'airport' | 'route' | 'notice' | 'airspace' | 'fusion' | 'anomaly' | 'claim' | 'evidence';
  title: string;
  description: string;
  severity: Severity;
  relatedIds: string[];
};

export type Citation = {
  id: string;
  label: string;
  source: string;
  url?: string;
  observedAt?: string;
  confidence: number;
};

export type Anomaly = {
  id: string;
  type: 'zone_approach' | 'route_deviation' | 'weather_risk' | 'osint_correlation' | 'activity_spike';
  severity: Severity;
  title: string;
  description: string;
  confidence: number;
  relatedTrackIds: string[];
  relatedOsintIds: string[];
  citations: Citation[];
};

export type QueryModule = 'tracks' | 'ships' | 'weather' | 'osint' | 'satellites' | 'airspace' | 'notices' | 'fusion';

export type QueryIntent = {
  raw: string;
  regionId?: RegionId;
  modules: QueryModule[];
  focus: 'overview' | 'anomaly' | 'activity' | 'data-quality';
};

export type FusionEvent = {
  id: string;
  regionId: RegionId;
  title: string;
  summary: string;
  severity: Severity;
  confidence: number;
  confidenceFactors: {
    sourceReliability: number;
    freshness: number;
    crossSourceAgreement: number;
    missingDataPenalty: number;
  };
  observedAt: string;
  createdAt: string;
  modules: QueryModule[];
  relatedIds: string[];
  citations: Citation[];
  recommendedAction: string;
  reviewDefault: FusionReviewStatus;
  safetyNote: string;
};

export type Briefing = {
  headline: string;
  situationSummary: string;
  keyFindings: string[];
  recommendedNextChecks: string[];
  caveats: string[];
  citations: Citation[];
  generatedBy: 'deterministic-template' | 'openai-precomputed';
};

export type Scenario = {
  region: Region;
  tracks: Track[];
  ships: ShipTrack[];
  weather: WeatherSnapshot | null;
  osint: OsintItem[];
  osintEvents: OsintMapEvent[];
  satellites: SatellitePass[];
  satelliteScenes?: SatelliteScene[];
  thermalAnomalies?: ThermalAnomaly[];
  airports: AirportContext[];
  airRoutes: AirRoute[];
  notices: AirspaceNotice[];
  airspaceContexts: AirspaceContext[];
  fusionEvents: FusionEvent[];
  sourceStatus?: Record<string, LiveSourceStatus>;
  sourceReasons?: Record<string, string>;
  sourceUpdatedAt?: Record<string, string>;
  watchZones: WatchZone[];
  referenceLines: ReferenceLine[];
  timeline: TimelineEvent[];
};
