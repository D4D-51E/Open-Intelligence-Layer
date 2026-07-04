import { demoClaimEvidence, claimsForRegion } from './claims';
import { osintSourceCatalog } from './osintSources';
import type {
  EvidenceItem,
  EvidenceStance,
  OsintItem,
  OsintMapEvent,
  RegionId,
  Scenario,
  Severity,
  TimelineEvent,
  VerificationCase,
  VerificationClaim,
  VerificationVerdict,
  VerificationVerdictLabel,
} from './types';

const MILLISECONDS = {
  minute: 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

const claimTypeWeights: Record<VerificationClaim['claimType'], {
  supports: number;
  contradicts: number;
  context: number;
  thermalSupport: number;
  trackSupport: number;
  osintSupport: number;
  osintContradiction: number;
  trackAsContradictionGapMultiplier: number;
}> = {
  aircraft_shootdown: {
    supports: 0.92,
    contradicts: 1.22,
    context: 0.88,
    thermalSupport: 0.55,
    trackSupport: 0.95,
    osintSupport: 1.02,
    osintContradiction: 1.22,
    trackAsContradictionGapMultiplier: 0.56,
  },
  base_strike: {
    supports: 1.2,
    contradicts: 1.0,
    context: 0.85,
    thermalSupport: 1.45,
    trackSupport: 0.48,
    osintSupport: 1.12,
    osintContradiction: 1.16,
    trackAsContradictionGapMultiplier: 0.52,
  },
  airspace_closure: {
    supports: 1.0,
    contradicts: 1.0,
    context: 1.0,
    thermalSupport: 0.34,
    trackSupport: 1.22,
    osintSupport: 1.05,
    osintContradiction: 1.08,
    trackAsContradictionGapMultiplier: 0.62,
  },
  drone_loss: {
    supports: 0.98,
    contradicts: 1.0,
    context: 0.88,
    thermalSupport: 0.9,
    trackSupport: 0.68,
    osintSupport: 1.08,
    osintContradiction: 1.07,
    trackAsContradictionGapMultiplier: 0.54,
  },
  satellite_claim: {
    supports: 1.15,
    contradicts: 0.95,
    context: 0.86,
    thermalSupport: 1.28,
    trackSupport: 0.6,
    osintSupport: 1.06,
    osintContradiction: 1.03,
    trackAsContradictionGapMultiplier: 0.58,
  },
  force_movement: {
    supports: 1.08,
    contradicts: 1.0,
    context: 0.95,
    thermalSupport: 0.4,
    trackSupport: 1.02,
    osintSupport: 1.1,
    osintContradiction: 1.0,
    trackAsContradictionGapMultiplier: 0.66,
  },
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function percent(value: number) {
  return Math.round(value * 100);
}

function toIsoMs(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : NaN;
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize('NFKC');
}

function tokenize(value: string) {
  const normalized = normalizeText(value).replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  const stop = new Set(['the', 'a', 'an', 'of', 'and', '또', '및', '그리고', 'from', 'to', 'in', 'on', 'at', '로', '과', '와']);
  return normalized
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stop.has(token));
}

function intersectionSize(a: Set<string>, b: Set<string>) {
  let size = 0;
  for (const token of a) {
    if (b.has(token)) size += 1;
  }
  return size;
}

function cosineApprox(aTokens: string[], bTokens: string[]) {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  const matches = intersectionSize(aSet, bSet);
  return matches / Math.max(1, Math.sqrt(aSet.size * bSet.size));
}

function containsAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

function clampKm(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (v: number) => v * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toConfidence(value?: number) {
  if (!Number.isFinite(value as number)) return 0.5;
  return clamp01(Number(value));
}

function evidence(
  claim: VerificationClaim,
  suffix: string,
  item: Omit<EvidenceItem, 'id' | 'claimId' | 'relatedIds'> & { relatedIds?: string[] },
): EvidenceItem {
  return {
    ...item,
    id: `ev-${claim.id}-${suffix}`,
    claimId: claim.id,
    relatedIds: item.relatedIds ?? [],
  };
}

function stanceSeverity(stance: EvidenceStance): Severity {
  if (stance === 'contradicts') return 'warning';
  if (stance === 'supports') return 'watch';
  return 'info';
}

function parseClaimWindow(claim: VerificationClaim) {
  const rawStart = toIsoMs(claim.timeWindowStart);
  const rawEnd = toIsoMs(claim.timeWindowEnd);
  const claimCenter = toIsoMs(claim.claimedAt);
  const fallbackStart = Number.isFinite(claimCenter) ? claimCenter - 3 * MILLISECONDS.hour : NaN;
  const fallbackEnd = Number.isFinite(claimCenter) ? claimCenter + 3 * MILLISECONDS.hour : NaN;
  const startAt = Number.isFinite(rawStart) ? rawStart : fallbackStart;
  const endAt = Number.isFinite(rawEnd) ? rawEnd : fallbackEnd;
  const normalizedStart = Math.min(startAt, endAt);
  const normalizedEnd = Math.max(startAt, endAt);

  return {
    startAt: normalizedStart,
    endAt: normalizedEnd,
    claimedAt: Number.isFinite(claimCenter) ? claimCenter : normalizedStart,
    radiusKm: claim.geoRadiusKm > 0 ? claim.geoRadiusKm : 120,
    radiusBufferKm: claim.geoBufferKm ?? 25,
    fallbackUsed: !Number.isFinite(rawStart) || !Number.isFinite(rawEnd),
  };
}

function isInWindow(observedAt: string, startAt: number, endAt: number) {
  const value = toIsoMs(observedAt);
  if (!Number.isFinite(value) || !Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return { inWindow: true, score: 0.24, deltaMinutes: null };
  }
  const timeMargin = Math.max(30 * MILLISECONDS.minute, (endAt - startAt) * 0.45);
  const middle = startAt + (endAt - startAt) / 2;
  const deltaMinutes = Math.abs(value - middle) / MILLISECONDS.minute;
  const score = clamp01(1 - Math.max(0, Math.abs(value - middle)) / (timeMargin || 1));
  return { inWindow: value >= startAt && value <= endAt, score, deltaMinutes };
}

function distanceKmToClaim(claim: VerificationClaim, lat: number, lon: number) {
  return haversineKm(claim.claimedLocation.lat, claim.claimedLocation.lon, lat, lon);
}

function distanceScore(distanceKm: number, claim: VerificationClaim, marginBoost = 0) {
  const radius = claim.geoRadiusKm + marginBoost + (claim.geoBufferKm ?? 0);
  if (!Number.isFinite(distanceKm) || !Number.isFinite(radius) || radius <= 0) return 0;
  return clamp01(1 - distanceKm / (radius * 3));
}

function matchesClaimKeywords(text: string, claim: VerificationClaim) {
  const normalized = normalizeText(text);
  return claim.keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function osintSourceReliability(source: OsintItem['source']) {
  if (source === 'gdelt-cache') return 0.83;
  return 0.72;
}

function classifyStanceFromText(value: string, claimType: VerificationClaim['claimType']): EvidenceStance {
  const lower = normalizeText(value);
  const supportTokens = ['confirm', 'confirmed', '확인', '인용', 'verified', 'evidence', '공식', 'statement', 'release', 'issued', 'announce', '승인', '증거'];
  const contradictionTokens = ['denial', 'denied', 'debunk', 'false', '허위', '조작', 'fact-check', '가짜', '오보', '반박', '부인', '정정'];

  if (containsAny(lower, contradictionTokens)) return 'contradicts';
  if (containsAny(lower, supportTokens)) return 'supports';

  const rumorTokens = ['rumor', '반복', '유출', '의심', 'unconfirmed', '확인되지'];
  const rumorAsContext = containsAny(lower, rumorTokens);
  if (claimType === 'aircraft_shootdown' && rumorAsContext) return 'context';
  return 'context';
}

function buildMapEvent(overrides: {
  id: string;
  regionId: RegionId;
  source: OsintMapEvent['source'];
  title: string;
  lat: number;
  lon: number;
  observedAt: string;
  confidence: number;
  relatedOsintId: string;
  domain?: string;
  url?: string;
  tags?: string[];
}): OsintMapEvent {
  return {
    ...overrides,
    tags: [...new Set(overrides.tags ?? [])],
  };
}

type ClaimEvidenceBundle = {
  evidence: EvidenceItem[];
  mapEvents: OsintMapEvent[];
};

type OsintCluster = {
  id: string;
  items: OsintItem[];
  tokens: Set<string>[];
  score: number;
  spanMinutes: number;
  publisherCount: number;
  stance: EvidenceStance;
  confidence: number;
  summary: string;
  latestAt: string;
};

function buildOsintClusters(claim: VerificationClaim, osintItems: OsintItem[], window: ReturnType<typeof parseClaimWindow>): OsintCluster[] {
  const windowed = osintItems
    .filter((item) => window.fallbackUsed || claimsByWindow(item.publishedAt, window.startAt, window.endAt))
    .filter((item) => matchesClaimKeywords(`${item.title} ${item.summary} ${item.tags.join(' ')}`, claim));

  const normalized = windowed
    .map((item) => ({
      item,
      tokens: new Set(tokenize(`${item.title} ${item.summary} ${item.domain ?? ''} ${item.source}`)),
      publishedAt: toIsoMs(item.publishedAt),
    }))
    .filter((record) => Number.isFinite(record.publishedAt))
    .sort((a, b) => a.publishedAt - b.publishedAt);

  if (normalized.length === 0) return [];

  const clusters: {
    id: string;
    items: OsintItem[];
    tokens: Set<string>[];
    firstAt: number;
    lastAt: number;
    seenPublishers: Set<string>;
    stanceCounts: { supports: number; contradicts: number; context: number };
  }[] = [];

  for (const record of normalized) {
    let matched = null as null | typeof clusters[number];
    const maxGapMinutes = 90;

    for (const cluster of clusters) {
      const timeGap = Math.abs(record.publishedAt - cluster.lastAt) / MILLISECONDS.minute;
      if (timeGap > maxGapMinutes) continue;
      const existingTokens = new Set<string>([...cluster.tokens.flatMap((set) => [...set])]);
      const score = cosineApprox([...existingTokens], [...record.tokens]);
      if (score >= 0.2) {
        matched = cluster;
        break;
      }
    }

    if (!matched) {
      clusters.push({
        id: `claim-${claim.id}-cluster-${clusters.length + 1}`,
        items: [record.item],
        tokens: [record.tokens],
        firstAt: record.publishedAt,
        lastAt: record.publishedAt,
        seenPublishers: new Set([normalizeText(record.item.domain ?? 'unknown')]),
        stanceCounts: {
          supports: 0,
          contradicts: 0,
          context: 0,
        },
      });
      continue;
    }

    matched.items.push(record.item);
    matched.tokens.push(record.tokens);
    matched.lastAt = Math.max(matched.lastAt, record.publishedAt);
    matched.firstAt = Math.min(matched.firstAt, record.publishedAt);
    matched.seenPublishers.add(normalizeText(record.item.domain ?? 'unknown'));
  }

  return clusters
    .map((cluster) => {
      const allText = `${cluster.items.map((item) => `${item.title} ${item.summary}`).join(' ')}`.toLowerCase();
      const stance = classifyStanceFromText(allText, claim.claimType);
      const sourceConf = cluster.items.reduce((sum, item) => sum + osintSourceReliability(item.source), 0) / cluster.items.length;
      const avgConf = cluster.items.reduce((sum, item) => sum + toConfidence(item.confidence), 0) / cluster.items.length;
      const spanMinutes = Math.max(0, Math.round((cluster.lastAt - cluster.firstAt) / MILLISECONDS.minute));
      const publisherCount = new Set(cluster.seenPublishers).size;
      const clusterTokens = new Set<string>([...cluster.tokens.flatMap((set) => [...set])]);
      const keywordOverlap = Math.max(0.2, Math.min(1, clusterTokens.size / 8));
      const stanceBoost = stance === 'supports' ? 1.08 : stance === 'contradicts' ? 1.16 : 0.96;
      const recencyScore = Math.max(0.22, isInWindow(
        cluster.lastAt.toString(),
        window.startAt,
        window.endAt,
      ).score);
      const score = clamp01(sourceConf * 0.26 + avgConf * 0.38 + keywordOverlap * 0.18 + clamp01(publisherCount / 6) * 0.08 + recencyScore * 0.1);
      const weighted = clamp01(score * stanceBoost);
      return {
        id: cluster.id,
        items: cluster.items,
        tokens: cluster.tokens,
        spanMinutes,
        publisherCount,
        stance,
        confidence: weighted,
        summary: `같은 주제/시간대 클러스터(건수 ${cluster.items.length}, 출처 ${publisherCount}, span ${spanMinutes}분)`,
        latestAt: new Date(cluster.lastAt).toISOString(),
        score: weighted,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function claimsByWindow(publishedAt: string, startAt: number, endAt: number) {
  const parsed = toIsoMs(publishedAt);
  return !Number.isFinite(parsed) || parsed < startAt - 12 * MILLISECONDS.hour || parsed > endAt + 12 * MILLISECONDS.hour ? false : true;
}

function buildClusterEvidence(
  claim: VerificationClaim,
  clusters: OsintCluster[],
  window: ReturnType<typeof parseClaimWindow>,
  weights: typeof claimTypeWeights[VerificationClaim['claimType']],
): { evidence: EvidenceItem[]; mapEvents: OsintMapEvent[] } {
  if (clusters.length === 0) return { evidence: [], mapEvents: [] };

  const evidenceList: EvidenceItem[] = [];
  const mapEvents: OsintMapEvent[] = [];

  for (const cluster of clusters.slice(0, 4)) {
    const clusterItem = cluster.items[0];
    const effectiveConfidence = clamp01(
      cluster.confidence
      * (cluster.stance === 'supports' ? weights.osintSupport : cluster.stance === 'contradicts' ? weights.osintContradiction : weights.context),
    );
    const stance: EvidenceStance = cluster.stance;
    const tagCount = `cluster ${cluster.items.length}`;

    evidenceList.push(evidence(claim, `osint-cluster-${cluster.id}`, {
      category: 'news',
      stance,
      title: `OSINT 클러스터 (${cluster.id})`,
      summary: `${cluster.summary}. ${cluster.items.slice(0, 2).map((item) => item.title).join(' · ')}`,
      source: clusterItem.source,
      confidence: effectiveConfidence,
      observedAt: cluster.latestAt,
      url: clusterItem.url,
      caveat: '같은 시간대·주제군의 보도군집을 하나의 신호 단위로 정렬한 값이며, 단정적 사실 확정값은 아닙니다.',
      relatedIds: cluster.items.map((item) => item.id),
    }));

    if (stance !== 'gap') {
      mapEvents.push(buildMapEvent({
        id: `cluster-review-${cluster.id}`,
        regionId: claim.regionId,
        source: 'osint-cluster-review',
        title: `OSINT 클러스터 점검 포인트 (${cluster.items.length}건)`,
        lat: claim.claimedLocation.lat,
        lon: claim.claimedLocation.lon,
        observedAt: cluster.latestAt,
        confidence: effectiveConfidence,
        relatedOsintId: clusterItem.id,
        domain: clusterItem.domain,
        url: clusterItem.url,
        tags: [...new Set([
          'osint-cluster-review',
          'osint-cluster',
          `cluster-size-${cluster.items.length}`,
          'not-geocoded',
          tagCount,
        ])],
      }));
    }
  }

  return { evidence: evidenceList, mapEvents };
}

function buildTrackEvidence(
  claim: VerificationClaim,
  scenario: Scenario,
  window: ReturnType<typeof parseClaimWindow>,
  weights: typeof claimTypeWeights[VerificationClaim['claimType']],
): ClaimEvidenceBundle {
  const matchingTracks = scenario.tracks.flatMap((track) => {
    const last = track.points.at(-1);
    if (!last) return [];
    const isRecent = isInWindow(last.observedAt, window.startAt, window.endAt);
    const distance = distanceKmToClaim(claim, last.lat, last.lon);
    const distScore = distanceScore(distance, claim);
    const timeScore = isRecent.score;
    const finalScore = (distScore * 0.55 + timeScore * 0.45) * toConfidence(track.points.at(-1)?.observedAt ? 1 : 0.4);
    if (finalScore < 0.2) return [];
    const stance: EvidenceStance = claim.claimType === 'aircraft_shootdown' ? 'context' : 'supports';
    return [{
      track,
      lastPoint: last,
      score: finalScore * (stance === 'supports' ? weights.trackSupport : weights.context),
      item: evidence(claim, `track-${track.id}`, {
        category: 'track',
        stance,
        title: `${track.callsign} 공개 항적 단일 지점`,
        summary: `최근 공개 항적이 주장 지점으로부터 ${Math.round(distance)}km 거리이며, 관측시각은 ${last.observedAt}입니다.`,
        source: track.source,
        confidence: clamp01(finalScore * (stance === 'supports' ? weights.trackSupport : weights.context)),
        observedAt: last.observedAt,
        relatedIds: [track.id],
        caveat: claim.claimType === 'aircraft_shootdown'
          ? '군/민간 항적 특성이 섞여 있어 항적 존재 자체가 격추 주장 지지를 뜻하지 않습니다.'
          : '해당 항적은 공개 항공기/공개 송신 장치 기반 맥락입니다.',
      }),
    }];
  });

  const sorted = matchingTracks.sort((a, b) => b.score - a.score);
  const mapEvents = sorted
    .filter((record) => record.score >= 0.35)
    .slice(0, 2)
      .map((record, index) => buildMapEvent({
        id: `match-track-${claim.id}-${index + 1}`,
        regionId: claim.regionId,
        source: 'claim-review-cache',
        title: `항적 매칭 포인트 ${index + 1}`,
        lat: record.lastPoint.lat,
        lon: record.lastPoint.lon,
        observedAt: record.lastPoint.observedAt,
        confidence: record.score,
        relatedOsintId: `track-${record.track.id}`,
        tags: ['claim-track-match', 'claim-track', 'not-geocoded'],
      }));

  return {
    evidence: sorted.slice(0, 6).map((entry) => entry.item),
    mapEvents,
  };
}

function buildThermalEvidence(
  claim: VerificationClaim,
  scenario: Scenario,
  window: ReturnType<typeof parseClaimWindow>,
  weights: typeof claimTypeWeights[VerificationClaim['claimType']],
): ClaimEvidenceBundle {
  const anomalies = scenario.thermalAnomalies ?? [];
  const matched = anomalies
    .map((thermal) => {
      const temporal = isInWindow(thermal.observedAt, window.startAt, window.endAt);
      const distanceKm = distanceKmToClaim(claim, thermal.lat, thermal.lon);
      const dScore = distanceScore(distanceKm, claim, claim.geoBufferKm ?? 0);
      const heat = thermal.frpMw == null ? 0.2 : clamp01(thermal.frpMw / 250);
      const conf = toConfidence(thermal.confidence);
      const final = (temporal.score * 0.43 + dScore * 0.37 + heat * 0.2) * conf;
      const stance: EvidenceStance = claim.claimType === 'base_strike' ? 'supports' : 'context';
      return {
        thermal,
        temporal,
        distanceKm,
        score: clamp01(final * (stance === 'supports' ? weights.thermalSupport : 0.72)),
        stance,
      };
    })
    .filter((item) => item.score >= 0.28)
    .sort((a, b) => b.score - a.score);

  if (matched.length === 0) {
    if (claim.claimType === 'base_strike') {
      return {
        evidence: [
          evidence(claim, 'thermal-gap', {
            category: 'thermal',
            stance: 'gap',
            title: 'NASA FIRMS 열 이상 후보 없음',
            summary: '현재 AOI에서 주장 창(window) 기준으로 확인 가능한 대형 열 이상 후보가 없습니다. 이는 폭발 부정 근거가 아니라 감시 공백으로 취급합니다.',
            source: 'NASA FIRMS',
            confidence: 0.62,
            caveat: '소형 폭발/분산형 연소, 보고 지연, 구름 및 궤도 관측 제약 때문에 부재는 반증이 아닙니다.',
          }),
        ],
        mapEvents: [],
      };
    }
    return { evidence: [], mapEvents: [] };
  }

  const top = matched.slice(0, 3);
  return {
    evidence: top.map((match, index) => {
      const thermal = match.thermal;
      const distanceLabel = Number.isFinite(match.distanceKm) ? `${Math.round(match.distanceKm)}km` : '거리 미상';
      return evidence(claim, `thermal-${thermal.id}-${index + 1}`, {
        category: 'thermal',
        stance: match.stance,
        title: 'NASA FIRMS 열 이상 매칭',
        summary: `${thermal.satellite ?? 'VIIRS/MODIS'} · FRP ${thermal.frpMw ?? '-'}MW · 주장 지점 대비 ${distanceLabel} · ${match.temporal.inWindow ? '시간창 정합' : '시간창 인접'}으로 정렬.`,
        source: 'NASA FIRMS',
        confidence: match.score,
        observedAt: thermal.observedAt,
        url: thermal.url,
        caveat: '열 이상은 원인(격추/폭격/산불)을 완전 판별하지 못하는 보조 신호입니다.',
        relatedIds: [thermal.id],
      });
    }),
    mapEvents: top.map((match, index) => buildMapEvent({
      id: `nasa-firms-match-${claim.id}-${index + 1}`,
      regionId: claim.regionId,
      source: 'nasa-firms-match',
      title: `NASA FIRMS 매칭 포인트 ${index + 1}`,
      lat: match.thermal.lat,
      lon: match.thermal.lon,
      observedAt: match.thermal.observedAt,
      confidence: match.score,
      relatedOsintId: match.thermal.id,
      tags: ['nasa-firms-match', 'thermal', `distance-${Math.round(match.distanceKm)}`],
      url: match.thermal.url,
      domain: 'NASA FIRMS',
    })),
  };
}

function scenarioEvidence(claim: VerificationClaim, scenario: Scenario): ClaimEvidenceBundle {
  const item: ClaimEvidenceBundle = {
    evidence: [],
    mapEvents: [],
  };
  const scenarioTime = scenario.weather?.observedAt ?? scenario.timeline.at(-1)?.time ?? new Date().toISOString();
  const window = parseClaimWindow(claim);
  const weights = claimTypeWeights[claim.claimType];

  for (const [index, seed] of (demoClaimEvidence[claim.id] ?? []).entries()) {
    item.evidence.push(evidence(claim, `seed-${index + 1}`, {
      ...seed,
      confidence: clamp01(seed.confidence * weights.context),
    }));
  }

  const claimRelevantOsint = scenario.osint
    .map((osint) => ({ ...osint }))
    .filter((osint) => isInWindow(osint.publishedAt, window.startAt, window.endAt).inWindow || matchesClaimKeywords(`${osint.title} ${osint.summary}`, claim));

  const clusters = buildOsintClusters(claim, claimRelevantOsint, window);
  const clusterResult = buildClusterEvidence(claim, clusters, window, weights);
  item.evidence.push(...clusterResult.evidence);
  item.mapEvents.push(...clusterResult.mapEvents);

  const trackResult = buildTrackEvidence(claim, scenario, window, weights);
  item.evidence.push(...trackResult.evidence);
  item.mapEvents.push(...trackResult.mapEvents);

  const thermalResult = buildThermalEvidence(claim, scenario, window, weights);
  item.evidence.push(...thermalResult.evidence);
  item.mapEvents.push(...thermalResult.mapEvents);

  if (scenario.satelliteScenes?.length) {
    for (const scene of scenario.satelliteScenes.slice(0, 3)) {
      item.evidence.push(evidence(claim, `scene-${scene.id}`, {
        category: 'satellite_scene',
        stance: 'context',
        title: `${scene.provider} 장면 메타데이터`,
        summary: `${scene.platform}${scene.cloudCoverPct == null ? '' : ` · 운량 ${scene.cloudCoverPct}%`} · ${scene.summary}`,
        source: scene.source,
        confidence: clamp01((scene.cloudCoverPct ?? 0) > 70 ? 0.46 : 0.68),
        observedAt: scene.observedAt,
        url: scene.url,
        relatedIds: [scene.id],
        caveat: 'MVP는 장면 존재·시각·운량만 표시하며 자동 피해 판독은 하지 않습니다.',
      }));
    }
  } else if (claim.claimType === 'base_strike') {
    item.evidence.push(evidence(claim, 'scene-gap', {
      category: 'satellite_scene',
      stance: 'gap',
      title: '공개 위성 장면 메타데이터 없음',
      summary: 'Copernicus/Landsat 장면 메타데이터가 주장 창에서 현재 수집되지 않았습니다.',
      source: 'Copernicus STAC / Landsat',
      confidence: clamp01(0.63 * weights.context),
      caveat: '무료 공개 위성은 재방문 주기·운량·해상도 제약이 큽니다.',
    }));
  }

  if (scenario.notices.length > 0) {
    item.evidence.push(evidence(claim, 'notam', {
      category: 'notam',
      stance: claim.claimType === 'airspace_closure' ? 'supports' : 'context',
      title: `공개 NOTAM ${scenario.notices.length}건`,
      summary: scenario.notices.slice(0, 2).map((notice) => notice.title).join(' · '),
      source: 'ICAO NOTAM cache',
      confidence: clamp01((claim.claimType === 'airspace_closure' ? 0.84 : 0.61) * (claim.claimType === 'airspace_closure' ? weights.supports : weights.context)),
      observedAt: scenario.notices[0]?.publishedAt,
      relatedIds: scenario.notices.map((notice) => notice.id),
      caveat: 'NOTAM은 공역 상태 근거이며, 군사 충돌 본체 증거를 바로 대체하지 못합니다.',
    }));
  } else if (claim.claimType === 'airspace_closure') {
    item.evidence.push(evidence(claim, 'notam-gap', {
      category: 'notam',
      stance: 'gap',
      title: '공식 NOTAM 근거 없음',
      summary: '현재 AOI의 공식 공개 NOTAM에서 공역 폐쇄를 직접 뒷받침할 실시간 근거가 부족합니다.',
      source: 'ICAO NOTAM cache',
      confidence: 0.54,
      caveat: 'NOTAM API 연동이 계정/endpoint 정책에 따라 제한될 수 있습니다.',
    }));
  }

  if (scenario.weather) {
    item.evidence.push(evidence(claim, 'weather', {
      category: 'weather',
      stance: 'context',
      title: '관측 가능성 기상 맥락',
      summary: `운량 ${scenario.weather.cloudCoverPct}%, 시정 ${scenario.weather.visibilityM.toLocaleString()}m, 강수 ${scenario.weather.precipitationMm}mm입니다.`,
      source: scenario.weather.source,
      confidence: clamp01(0.66 * weights.context),
      observedAt: scenario.weather.observedAt,
      relatedIds: [scenario.weather.id],
    }));
  }

  const statementSource = scenarioTime;
  const claimKeywordMatches = claim.keywords.filter((keyword) => keyword.length > 2);
  if (claimKeywordMatches.length > 0 && scenario.osint.length === 0 && claim.claimType === 'aircraft_shootdown') {
    item.evidence.push(evidence(claim, 'keyword-gap', {
      category: 'news',
      stance: 'gap',
      title: '주장 키워드 직접 매칭 OSINT 빈약',
      summary: `현재 AOI 기준으로 '${claimKeywordMatches.join(', ')}'과 교집합되는 기사/보도량이 부족합니다.`,
      source: 'claim-keyword-gap',
      confidence: 0.53,
      observedAt: statementSource,
      caveat: '국영 보도·지역어로 전달된 주장은 추적되지 않을 수 있습니다.',
    }));
  }

  const commercial = osintSourceCatalog.find((source) => source.id === 'commercial-imagery');
  if (commercial && (claim.claimType === 'base_strike' || claim.claimType === 'aircraft_shootdown')) {
    item.evidence.push(evidence(claim, 'commercial-imagery-needed', {
      category: 'commercial_imagery',
      stance: 'gap',
      title: '고해상도 상용 위성 확인 필요',
      summary: commercial.verdictUse,
      source: commercial.name,
      confidence: 0.78,
      url: commercial.url,
      caveat: commercial.caveat,
    }));
  }

  if (!item.evidence.some((entry) => entry.category === 'media_forensics' || entry.category === 'factcheck')) {
    item.evidence.push(evidence(claim, 'media-forensics-gap', {
      category: 'media_forensics',
      stance: 'gap',
      title: '이미지·영상 포렌식 미확인',
      summary: '키프레임 역검색, EXIF, 생성형 영상 의심 신호가 아직 수동으로 확인되지 않았습니다.',
      source: 'media forensics checklist',
      confidence: 0.62,
      caveat: 'AI 탐지기는 보조 신호일 뿐 단독 판정 근거가 아닙니다.',
    }));
  }

  if (!item.evidence.some((entry) => entry.stance === 'context' || entry.stance === 'supports')) {
    item.evidence.push(evidence(claim, 'context-gap', {
      category: 'source_gap',
      stance: 'gap',
      title: '검증 가능한 공개 근거가 제한적',
      summary: '현재 보유 데이터로는 직접 지지/반박이 모두 한정적입니다. 추가 공식 발표·위성·항적 수집이 필요합니다.',
      source: 'AirMaven Verify',
      confidence: 0.54,
      observedAt: scenarioTime,
    }));
  }

  item.evidence.push(...sourceGapEvidence(claim, scenario, window.fallbackUsed));

  return item;
}

function sourceGapEvidence(claim: VerificationClaim, scenario: Scenario, fallbackWindow = false) {
  const status = scenario.sourceStatus ?? {};
  const reasons = scenario.sourceReasons ?? {};
  const gaps = Object.entries(status).filter(([, value]) => ['empty', 'rate-limited', 'unsupported', 'disabled', 'unavailable'].includes(value));

  return gaps.slice(0, 8).map(([source, value]) => evidence(claim, `gap-${source}`, {
    category: 'source_gap',
    stance: 'gap',
    title: `${source} 수집 상태: ${value}${fallbackWindow ? '(창 확장)' : ''}`,
    summary: reasons[source] ?? '공개 소스가 현재 검증 근거를 제공하지 못했습니다.',
    source: 'source-status',
    confidence: (value === 'empty' ? 0.7 : 0.62) * 0.98,
    observedAt: scenario.sourceUpdatedAt?.[source],
    caveat: '데이터 공백은 반박 근거가 아니라 검증 한계로 표시합니다.',
  }));
}

function sumByStance(evidenceItems: EvidenceItem[], stance: EvidenceStance) {
  return evidenceItems
    .filter((item) => item.stance === stance)
    .reduce((sum, item) => sum + item.confidence, 0);
}

function verdictSummary(label: VerificationVerdictLabel, confidence: number) {
  const pct = percent(confidence);
  const labels: Record<VerificationVerdictLabel, string> = {
    confirmed: `공개 근거가 다수 일치해 확인 가능성이 높습니다. 신뢰도 ${pct}%.`,
    likely_true: `공개 근거가 대체로 주장을 지지하지만 추가 확인이 필요합니다. 신뢰도 ${pct}%.`,
    plausible_unverified: `주장은 가능하지만 직접 확증 근거가 부족합니다. 신뢰도 ${pct}%.`,
    inconclusive: `공개 근거가 부족하거나 공백이 커서 결론을 보류합니다. 신뢰도 ${pct}%.`,
    likely_false: `공식/팩트체크/교차 근거가 주장과 충돌합니다. 신뢰도 ${pct}%.`,
    false: `강한 반박 근거가 주장과 다수 충돌하여 허위 가능성이 매우 높습니다. 신뢰도 ${pct}%.`,
  };
  return labels[label];
}

function buildVerdict(claim: VerificationClaim, evidenceItems: EvidenceItem[]) {
  const supportScore = sumByStance(evidenceItems, 'supports');
  const contradictScore = sumByStance(evidenceItems, 'contradicts');
  const gapScore = sumByStance(evidenceItems, 'gap');
  const contextScore = sumByStance(evidenceItems, 'context');
  const supportingEvidenceIds = evidenceItems.filter((item) => item.stance === 'supports').map((item) => item.id);
  const contradictingEvidenceIds = evidenceItems.filter((item) => item.stance === 'contradicts').map((item) => item.id);
  const gapEvidenceIds = evidenceItems.filter((item) => item.stance === 'gap').map((item) => item.id);

  let label: VerificationVerdictLabel = 'inconclusive';
  if (contradictScore >= 1.8 && supportScore < 0.75) label = 'false';
  else if (contradictScore >= 1.05 && supportScore < 1.0) label = 'likely_false';
  else if (supportScore >= 2.05 && contradictScore < 0.8) label = 'confirmed';
  else if (supportScore >= 1.1 && contradictScore < 0.9) label = 'likely_true';
  else if (supportScore > 0.35 || contextScore >= 1.8) label = 'plausible_unverified';

  const decisive = Math.max(supportScore, contradictScore, 0.4);
  const uncertainty = gapScore * 0.12 + (supportScore > 0 && contradictScore > 0 ? 0.15 : 0);
  const confidence = clamp01(0.43 + decisive * 0.18 - uncertainty);

  const defaultCaveats = [
    '공개 ADS-B 부재는 군용기 부재나 사건 부재의 증거가 아닙니다.',
    '무료 공개 위성은 해상도, 재방문 주기, 구름·시간 지연의 한계가 있습니다.',
    '이 판정은 표적 지정·작전 지시가 아니라 분석관 검토용 OSINT 근거 요약입니다.',
  ];
  const caveats = [...new Set([
    ...defaultCaveats,
    ...evidenceItems.map((item) => item.caveat).filter((value): value is string => Boolean(value)),
  ])].slice(0, 8);

  const nextChecks = [
    claim.claimType === 'base_strike'
      ? 'NASA FIRMS + Copernicus 장면 타임라인을 같은 창으로 재조회하고 고해상도 이미지 tasking 후보를 좁힙니다.'
      : '주장 시각 전후 공식 발표·국방기관·항로 단서와 동일 시간축을 다시 정렬합니다.',
    claim.claimType === 'aircraft_shootdown'
      ? 'tail/callsign/항적·부재 기록, 공식 손실/확인 보도, 항전 활동 로그를 별도 수집해 교차합니다.'
      : '다수 출처의 동일 보도문을 추적해 동일 주장 반복인지 1차 확산인지 분리합니다.',
    'OSINT 단일 채널이 아니라 서로 다른 지역/언어 출처의 교차 시각화 타임라인을 검토합니다.',
    '필요 시 소셜 영상은 프레임 단위 역검색·촬영 위치·원본 업로드 계정의 공개 기록을 재확인합니다.',
  ];

  return {
    label,
    confidence,
    summary: verdictSummary(label, confidence),
    supportingEvidenceIds,
    contradictingEvidenceIds,
    gapEvidenceIds,
    caveats,
    nextChecks,
  };
}

export function buildVerificationCases(scenario: Scenario): VerificationCase[] {
  return claimsForRegion(scenario.region.id)
    .map((claim) => {
      const bundle = scenarioEvidence(claim, scenario);
      const evidenceItems = bundle.evidence;
      const uniqueMapEvents = bundle.mapEvents.filter((value, index, self) => self.findIndex((item) => item.id === value.id) === index);

      return {
        claim,
        evidence: evidenceItems,
        verdict: buildVerdict(claim, evidenceItems),
        derivedMapEvents: uniqueMapEvents,
      };
    })
    .sort((a, b) => {
      const priority = { warning: 2, watch: 1, info: 0 } satisfies Record<Severity, number>;
      return priority[b.claim.priority] - priority[a.claim.priority]
        || b.verdict.gapEvidenceIds.length - a.verdict.gapEvidenceIds.length
        || a.claim.title.localeCompare(b.claim.title, 'ko');
    });
}

export function buildClaimMapEvents(cases: VerificationCase[]): OsintMapEvent[] {
  const base = cases.map(({ claim, verdict }) => ({
    id: `claim-map-${claim.id}`,
    regionId: claim.regionId,
    source: 'claim-review-cache' as const,
    title: `CLAIM · ${claim.shortTitle}`,
    lat: claim.claimedLocation.lat,
    lon: claim.claimedLocation.lon,
    observedAt: claim.claimedAt,
    confidence: verdict.confidence,
    relatedOsintId: claim.id,
    domain: 'AirMaven Verify',
    url: claim.sourceUrls[0],
    tags: ['claim', claim.claimType, verdict.label, 'review-point'],
  }));

  const derived = cases.flatMap((item) => item.derivedMapEvents ?? []);
  const dedupe = new Map<string, OsintMapEvent>();
  for (const event of [...base, ...derived]) {
    dedupe.set(event.id, event);
  }

  return [...dedupe.values()];
}

export function buildVerificationTimeline(cases: VerificationCase[]): TimelineEvent[] {
  return cases.flatMap((verificationCase) => [
    {
      id: `tl-${verificationCase.claim.id}`,
      regionId: verificationCase.claim.regionId,
      time: verificationCase.claim.claimedAt,
      type: 'claim' as const,
      title: verificationCase.claim.shortTitle,
      description: verificationCase.verdict.summary,
      severity: verificationCase.claim.priority,
      relatedIds: [verificationCase.claim.id],
    },
    ...verificationCase.evidence.slice(0, 6).map((item) => ({
      id: `tl-${item.id}`,
      regionId: verificationCase.claim.regionId,
      time: item.observedAt ?? verificationCase.claim.createdAt,
      type: 'evidence' as const,
      title: item.title,
      description: `${item.source} · ${item.stance} · ${item.summary}`,
      severity: stanceSeverity(item.stance),
      relatedIds: [verificationCase.claim.id, ...item.relatedIds],
    })),
  ]).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}
