import { expect } from '@playwright/test';
import { test } from '../../../src/fixture.js';

// Listed in the mock server's quarantine list (see ../mock-server.ts).
// The fixture must swallow the failure so the overall run exits 0.
test.describe('quarantined', () => {
  test('fails but is absorbed', () => {
    expect(1).toBe(2);
  });
});
