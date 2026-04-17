import { expect } from '@playwright/test';
import { test } from '../../../src/fixture.js';

test('passes cleanly', () => {
  expect(1 + 1).toBe(2);
});
