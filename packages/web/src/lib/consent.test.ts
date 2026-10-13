import { describe, expect, it } from 'vitest';

import { requestFields, signInLink } from './consent';

describe('requestFields', () => {
  it('reads every parameter of the query', () => {
    expect(requestFields('?client_id=a&state=x%20y')).toEqual({ client_id: 'a', state: 'x y' });
  });

  it('is empty without a query', () => {
    expect(requestFields('')).toEqual({});
  });
});

describe('signInLink', () => {
  it('points at the mobile launch page of the site', () => {
    expect(signInLink('https://moodle.example.edu/2025')).toContain(
      'https://moodle.example.edu/2025/admin/tool/mobile/launch.php?',
    );
  });
});
