import {
  type TracingContext,
  createTracing,
  envToBool,
  generateTestRunId,
  getRepoName,
  isInCI,
} from '@mergifyio/ci-core';
import { type Span, SpanStatusCode, context, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { QUARANTINED_ABSORBED_ANNOTATION, QUARANTINED_ANNOTATION } from './fixture.js';
import * as playwrightResource from './resources/playwright.js';
import { loadState } from './state-file.js';
import { buildCanonicalId, extractNamespace, toRelativePath } from './test-id.js';
import type { MergifyReporterOptions, TestSpanInfo } from './types.js';
import { DEFAULT_API_URL, LOG_PREFIX, getPlaywrightVersion, log, writeLine } from './utils.js';

function mapStatus(status: TestResult['status']): 'passed' | 'failed' | 'skipped' {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'skipped':
      return 'skipped';
    // failed, timedOut, interrupted all collapse into "failed"
    default:
      return 'failed';
  }
}

function normalizeAbsorbedError(raw: unknown): {
  name: string;
  message: string;
  stack: string;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const asString = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  return {
    name: asString(obj.name, 'Error'),
    message: asString(obj.message, ''),
    stack: asString(obj.stack, ''),
  };
}

function readAnnotations(test: TestCase): TestSpanInfo {
  const info: TestSpanInfo = { quarantined: false };
  for (const ann of test.annotations) {
    if (ann.type === QUARANTINED_ANNOTATION) {
      info.quarantined = true;
    } else if (ann.type === QUARANTINED_ABSORBED_ANNOTATION) {
      info.quarantined = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ann.description ?? '{}');
      } catch {
        parsed = {};
      }
      // OTel rejects undefined attribute values; normalize every field to a string.
      info.absorbedError = normalizeAbsorbedError(parsed);
    }
  }
  return info;
}

/** Pick the final (last) TestResult from a test's attempts. */
function finalResult(test: TestCase): TestResult | undefined {
  if (test.results.length === 0) return undefined;
  return test.results[test.results.length - 1];
}

export class MergifyReporter implements Reporter {
  private options: MergifyReporterOptions;
  private tracing: TracingContext | null = null;
  private sessionSpan: Span | undefined;
  private config: FullConfig | undefined;
  private rootSuite: Suite | undefined;
  private quarantinedCaught: string[] = [];
  private quarantineListSize = 0;
  private testRunId: string | undefined;
  private startedViaState = false;

  constructor(options?: MergifyReporterOptions) {
    this.options = options ?? {};
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.rootSuite = suite;

    const state = loadState();
    if (state) {
      this.testRunId = state.testRunId;
      this.quarantineListSize = state.quarantineList.length;
      this.startedViaState = true;
    } else {
      this.testRunId = generateTestRunId();
    }

    const token = this.options.token ?? process.env.MERGIFY_TOKEN;
    const apiUrl = this.options.apiUrl ?? process.env.MERGIFY_API_URL ?? DEFAULT_API_URL;
    const repoName = getRepoName();

    const enabled =
      isInCI() ||
      envToBool(process.env.PLAYWRIGHT_MERGIFY_ENABLE, false) ||
      !!this.options.exporter;

    if (!enabled) return;

    this.tracing = createTracing({
      token,
      repoName,
      apiUrl,
      testRunId: this.testRunId,
      frameworkAttributes: playwrightResource.detect(getPlaywrightVersion()),
      tracerName: '@mergifyio/playwright',
      exporter: this.options.exporter,
    });

    if (!this.tracing) {
      if (!token) {
        log('MERGIFY_TOKEN not set, skipping CI Insights reporting');
      } else if (!repoName) {
        log('Could not detect repository name, skipping CI Insights reporting');
      }
      return;
    }

    let parentContext = context.active();
    const traceparent = process.env.MERGIFY_TRACEPARENT;
    if (traceparent) {
      const propagator = new W3CTraceContextPropagator();
      parentContext = propagator.extract(
        context.active(),
        { traceparent },
        {
          get(c: Record<string, string>, key: string) {
            return c[key];
          },
          keys(c: Record<string, string>) {
            return Object.keys(c);
          },
        }
      );
    }

    this.sessionSpan = this.tracing.tracer.startSpan(
      'playwright session start',
      { attributes: { 'test.scope': 'session' } },
      parentContext
    );
  }

  private emitTestSpan(test: TestCase, result: TestResult): void {
    if (!this.tracing || !this.sessionSpan || !this.config) return;

    const rootDir = this.config.rootDir;
    const canonicalId = buildCanonicalId({
      filePath: test.location.file,
      rootDir,
      titlePath: test.titlePath(),
    });
    const namespace = extractNamespace({
      filePath: test.location.file,
      rootDir,
      titlePath: test.titlePath(),
    });
    const info = readAnnotations(test);
    if (info.quarantined && info.absorbedError) {
      this.quarantinedCaught.push(canonicalId);
    }

    const startTimeMs = result.startTime.getTime();
    const endTimeMs = startTimeMs + result.duration;

    const parentCtx = trace.setSpan(context.active(), this.sessionSpan);
    const status = mapStatus(result.status);
    const effectivelyFailed = status === 'failed' || !!info.absorbedError;

    const relFilePath = toRelativePath(test.location.file, rootDir);
    const projectName = test.parent.project()?.name ?? '';

    const span = this.tracing.tracer.startSpan(
      canonicalId,
      {
        attributes: {
          'test.scope': 'case',
          'test.case.result.status': status,
          'code.filepath': relFilePath,
          'code.function': test.title,
          'code.lineno': test.location.line,
          'code.namespace': namespace,
          'code.file.path': test.location.file,
          'code.line.number': test.location.line,
          'cicd.test.quarantined': info.quarantined,
          'cicd.test.retry_count': result.retry,
          'cicd.test.flaky': test.outcome() === 'flaky',
          'test.framework.project': projectName,
        },
        startTime: startTimeMs,
      },
      parentCtx
    );

    if (effectivelyFailed) {
      const err = info.absorbedError ?? extractError(result);
      if (err) {
        span.setAttributes({
          'exception.type': err.name,
          'exception.message': err.message,
          'exception.stacktrace': err.stack,
        });
      }
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end(endTimeMs);
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.rootSuite) {
      for (const test of this.rootSuite.allTests()) {
        const last = finalResult(test);
        if (last) this.emitTestSpan(test, last);
      }
    }

    if (this.sessionSpan) {
      this.sessionSpan.setStatus({
        code: result.status === 'passed' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      this.sessionSpan.end();
    }

    if (this.tracing) {
      try {
        await this.tracing.tracerProvider.forceFlush();
      } catch (err) {
        log(`Failed to flush spans: ${String(err)}`);
      }
      if (this.tracing.ownsExporter) {
        try {
          await this.tracing.tracerProvider.shutdown();
        } catch {
          // ignore
        }
      }
    }

    this.printReport();
  }

  private printReport(): void {
    if (!this.startedViaState && !this.tracing) return;

    writeLine();
    writeLine(`${LOG_PREFIX} Quarantine report:`);
    writeLine(`  Quarantined tests fetched: ${this.quarantineListSize}`);

    if (this.quarantinedCaught.length > 0) {
      writeLine(`  Quarantined tests caught (failures absorbed): ${this.quarantinedCaught.length}`);
      for (const name of this.quarantinedCaught) {
        writeLine(`    - ${name}`);
      }
    }

    const unused = this.quarantineListSize - this.quarantinedCaught.length;
    if (unused > 0) {
      writeLine(`  Unused quarantine entries: ${unused}`);
    }

    if (this.testRunId) {
      writeLine(`MERGIFY_TEST_RUN_ID=${this.testRunId}`);
    }
  }

  // Exposed for tests.
  getExporter() {
    return this.tracing?.exporter;
  }
}

/**
 * Playwright's TestError has no `name` field, so recover the thrown class
 * (AssertionError, TimeoutError, ...) from the first line of the stack or
 * message. Format is conventionally "<ErrorName>: <message>".
 */
function parseErrorName(stackOrMessage: string): string {
  const firstLine = stackOrMessage.split('\n', 1)[0] ?? '';
  const match = firstLine.match(/^([A-Z]\w*):/);
  return match ? match[1] : 'Error';
}

function extractError(
  result: TestResult
): { name: string; message: string; stack: string } | undefined {
  const first = result.errors[0] ?? result.error;
  if (!first) return undefined;
  const stack = first.stack ?? '';
  const message = first.message ?? '';
  return {
    name: parseErrorName(stack || message),
    message,
    stack,
  };
}

export default MergifyReporter;
