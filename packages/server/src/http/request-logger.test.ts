import { describe, expect, it } from 'vitest';

import { placementFrom } from './request-logger.ts';

describe('placementFrom', () => {
  it('reads the Smart Placement location', () => {
    expect(placementFrom(new Headers({ 'cf-placement': 'remote-LHR' }))).toBe('remote-LHR');
    expect(placementFrom(new Headers({ 'cf-placement': 'local-EWR' }))).toBe('local-EWR');
  });

  it('drops anything that is not a placement, so callers cannot write free text into logs', () => {
    expect(placementFrom(new Headers({ 'cf-placement': 'remote-LHR fake log line' }))).toBeUndefined();
    expect(placementFrom(new Headers({ 'cf-placement': 'remote-lhr' }))).toBeUndefined();
    expect(placementFrom(new Headers({ 'cf-placement': 'somewhere-LHR' }))).toBeUndefined();
  });

  it('is undefined without the header', () => {
    expect(placementFrom(new Headers())).toBeUndefined();
  });
});
