import { describe, expect, it } from 'vitest';
import { sourceStatusIsOperational } from './display';

describe('sourceStatusIsOperational', () => {
  it('counts only evidence-bearing source states as operational', () => {
    expect(sourceStatusIsOperational('live')).toBe(true);
    expect(sourceStatusIsOperational('cached')).toBe(true);
    expect(sourceStatusIsOperational('standby')).toBe(true);
    expect(sourceStatusIsOperational('empty')).toBe(false);
    expect(sourceStatusIsOperational('rate-limited')).toBe(false);
    expect(sourceStatusIsOperational('unsupported')).toBe(false);
    expect(sourceStatusIsOperational('disabled')).toBe(false);
    expect(sourceStatusIsOperational('unavailable')).toBe(false);
  });
});
