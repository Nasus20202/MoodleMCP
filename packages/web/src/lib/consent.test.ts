import { describe, expect, it } from 'vitest';

import { requestFields } from './consent';

describe('requestFields', () => {
  it('reads every parameter of the query', () => {
    expect(requestFields('?client_id=a&state=x%20y')).toEqual({ client_id: 'a', state: 'x y' });
  });

  it('is empty without a query', () => {
    expect(requestFields('')).toEqual({});
  });
});
