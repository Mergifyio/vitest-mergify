import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

export interface MergifyReporterOptions {
  apiUrl?: string;
  token?: string;
  /** Injected exporter for tests — bypasses CI and token checks. */
  exporter?: SpanExporter;
}

export interface TestSpanInfo {
  quarantined: boolean;
  absorbedError?: { name: string; message: string; stack: string };
}
