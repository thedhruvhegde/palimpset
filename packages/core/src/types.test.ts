import { describe, expect, it } from 'vitest';
import { SEVERITY_ORDER } from './types.ts';

describe('ghost model', () => {
  it('orders severity from most to least exposing', () => {
    expect(SEVERITY_ORDER).toEqual(['revenant', 'wraith', 'shade', 'wisp']);
  });
});
