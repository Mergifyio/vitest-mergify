import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/reporter.ts',
    'src/setup.ts',
    'src/teardown.ts',
    'src/fixture.ts',
    'src/config.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  deps: {
    neverBundle: [/^@playwright\//, /^@opentelemetry\//, /^@mergifyio\//],
  },
});
