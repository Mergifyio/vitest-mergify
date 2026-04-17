export { mergifyFixture, test } from './fixture.js';
export { MergifyReporter } from './reporter.js';
export { withMergify } from './config.js';
export type { MergifyReporterOptions } from './types.js';
export type { TestCaseError, TestCaseResult, TestRunSession } from '@mergifyio/ci-core';

// Default export: the reporter class, so `reporter: ['@mergifyio/playwright']` works too.
export { MergifyReporter as default } from './reporter.js';
