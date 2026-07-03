import { describe, expect, it } from 'vitest';
import { parseAnalystQuery } from './query';

describe('parseAnalystQuery', () => {
  it('infers region, modules, and anomaly focus from Korean analyst text', () => {
    const intent = parseAnalystQuery('대만해협 항적과 OSINT 이상신호를 근거 중심으로 확인해줘', 'seoul-airspace');

    expect(intent.regionId).toBe('taiwan-strait');
    expect(intent.focus).toBe('anomaly');
    expect(intent.modules).toEqual(expect.arrayContaining(['tracks', 'osint', 'fusion']));
  });

  it('falls back to all modules when the query has no explicit module terms', () => {
    const intent = parseAnalystQuery('지금 무엇을 볼 수 있어?', 'west-sea-nll');

    expect(intent.regionId).toBe('west-sea-nll');
    expect(intent.modules).toEqual(expect.arrayContaining(['tracks', 'ships', 'weather', 'osint', 'satellites', 'airspace', 'notices', 'fusion']));
  });

  it('prioritizes data-quality focus for source accuracy questions', () => {
    const intent = parseAnalystQuery('서해 NLL 데이터 공백과 신뢰도 한계를 설명해줘', 'taiwan-strait');

    expect(intent.regionId).toBe('west-sea-nll');
    expect(intent.focus).toBe('data-quality');
  });
});
