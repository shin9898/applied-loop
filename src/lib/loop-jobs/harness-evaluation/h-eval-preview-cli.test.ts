import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

import { runHEvalPreviewCliV1 } from "./h-eval-preview-cli";

const encoder = new TextEncoder();
const hash = (character: string) => character.repeat(64);

function periodHash(cadence: string, ordinal: number, start: number, end: number): string {
  return createHash("sha256")
    .update(JSON.stringify(["h_eval_period_v1", "v1", cadence, ordinal, start, end]), "utf8")
    .digest("hex");
}

function request() {
  const jobIdentity = {
    policyVersion: "v1",
    cadence: "daily",
    scopeHash: hash("a"),
    periodHash: periodHash("daily", 1, 1_000, 2_000),
    periodOrdinal: 1,
    periodStartEpochMs: 1_000,
    periodEndEpochMs: 2_000,
  };
  return {
    schema: "h_eval_preview_request_v1",
    jobIdentity,
    evidence: {
      schema: "h_eval_evidence_v1",
      current: {
        identity: { ...jobIdentity },
        scheduler: { scheduledRunCount: 1, onTimeCompletedRunCount: 1, eventualIncompleteRunCount: 0 },
        usage: {
          attribution: "observed",
          budgetScope: "global",
          budgetWeekKeyHash: hash("c"),
          llmCalls: 0,
          freshInputTokens: 0,
        },
        findings: { duplicateFindingCount: 0, acceptedFindingCount: 0, ignoredFindingCount: 0 },
        integrity: { privacyViolationCount: 0, dataLossDetected: false },
      },
      previous: null,
    },
  };
}

async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield value;
}

function outputCollector() {
  let text = "";
  let writes = 0;
  return {
    output: {
      write(line: string, callback: (error: Error | null | undefined) => void): boolean {
        writes += 1;
        text += line;
        callback(null);
        return true;
      },
    },
    get text() {
      return text;
    },
    get writes() {
      return writes;
    },
  };
}

function unreadableInput(acquired: { count: number }): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      acquired.count += 1;
      throw new Error("input must not be acquired");
    },
  };
}

test("A4-CG4-T1 manual-argument-authorization", async () => {
  for (const args of [[], ["--stdin", "--stdin"], ["--stdin", "--unknown"], ["--unknown", "--stdin"], ["x"]]) {
    const acquired = { count: 0 };
    const collector = outputCollector();
    const status = await runHEvalPreviewCliV1({
      args,
      input: unreadableInput(acquired),
      output: collector.output,
    });
    assert.equal(acquired.count, 0);
    assert.equal(status, 1);
    assert.equal(collector.writes, 1);
    const result = JSON.parse(collector.text) as { code: string };
    assert.equal(result.code, args.length === 0 ? "preview_disabled" : "invalid_arguments");
  }
});

test("A4-CG5-T1 bounded-raw-stdin-and-json", async () => {
  const valid = encoder.encode(JSON.stringify(request()));
  const split = outputCollector();
  assert.equal(
    await runHEvalPreviewCliV1({
      args: ["--stdin"],
      input: chunks(valid.subarray(0, 17), valid.subarray(17)),
      output: split.output,
    }),
    0,
  );
  assert.equal((JSON.parse(split.text) as { code: string }).code, "evaluated");

  const acceptedDuplicateSchema = JSON.stringify(request()).replace(
    '"schema":"h_eval_preview_request_v1"',
    '"schema":"discarded_schema","schema":"h_eval_preview_request_v1"',
  );
  assert.match(acceptedDuplicateSchema, /"schema":"discarded_schema","schema":"h_eval_preview_request_v1"/);
  const acceptedDuplicateCollector = outputCollector();
  assert.equal(
    await runHEvalPreviewCliV1({
      args: ["--stdin"],
      input: chunks(encoder.encode(acceptedDuplicateSchema)),
      output: acceptedDuplicateCollector.output,
    }),
    0,
  );
  assert.equal((JSON.parse(acceptedDuplicateCollector.text) as { code: string }).code, "evaluated");

  const closedEnvelopeDuplicateSchema = JSON.stringify(request()).replace(
    '"schema":"h_eval_preview_request_v1"',
    '"schema":"h_eval_preview_request_v1","schema":"discarded_schema"',
  );
  assert.match(closedEnvelopeDuplicateSchema, /"schema":"h_eval_preview_request_v1","schema":"discarded_schema"/);
  const closedEnvelopeDuplicateCollector = outputCollector();
  assert.equal(
    await runHEvalPreviewCliV1({
      args: ["--stdin"],
      input: chunks(encoder.encode(closedEnvelopeDuplicateSchema)),
      output: closedEnvelopeDuplicateCollector.output,
    }),
    1,
  );
  assert.equal((JSON.parse(closedEnvelopeDuplicateCollector.text) as { code: string }).code, "invalid_request");

  const duplicateIdentityRequest = request();
  const invalidLastIdentity = { ...duplicateIdentityRequest.jobIdentity, scopeHash: "not-a-hash" };
  const validIdentityJson = JSON.stringify(duplicateIdentityRequest.jobIdentity);
  const invalidLastIdentityJson = JSON.stringify(invalidLastIdentity);
  const a3ValidationDuplicateIdentity = JSON.stringify(duplicateIdentityRequest).replace(
    `"jobIdentity":${validIdentityJson}`,
    `"jobIdentity":${validIdentityJson},"jobIdentity":${invalidLastIdentityJson}`,
  );
  assert.equal(
    a3ValidationDuplicateIdentity.includes(`"jobIdentity":${validIdentityJson},"jobIdentity":${invalidLastIdentityJson}`),
    true,
  );
  const a3ValidationDuplicateCollector = outputCollector();
  assert.equal(
    await runHEvalPreviewCliV1({
      args: ["--stdin"],
      input: chunks(encoder.encode(a3ValidationDuplicateIdentity)),
      output: a3ValidationDuplicateCollector.output,
    }),
    1,
  );
  assert.equal((JSON.parse(a3ValidationDuplicateCollector.text) as { code: string }).code, "invalid_job_identity");

  const padded = encoder.encode(`${JSON.stringify(request())}${" ".repeat(65_536 - valid.byteLength)}`);
  assert.equal(padded.byteLength, 65_536);
  const exactlyAtLimit = outputCollector();
  assert.equal(
    await runHEvalPreviewCliV1({ args: ["--stdin"], input: chunks(padded), output: exactlyAtLimit.output }),
    0,
  );

  const cases: Array<[string, AsyncIterable<Uint8Array>]> = [
    ["input_too_large", chunks(new Uint8Array(65_537))],
    ["input_too_large", chunks(new Uint8Array([0xff]), new Uint8Array(65_536))],
    ["invalid_json", chunks(new Uint8Array([0xff]), new Uint8Array(65_535))],
    ["invalid_json", chunks(new Uint8Array())],
    ["invalid_json", chunks(new Uint8Array([0xef, 0xbb, 0xbf, ...valid]))],
    ["invalid_json", chunks(encoder.encode("{"))],
    ["invalid_json", chunks(encoder.encode(`${JSON.stringify(request())} trailing`))],
    ["invalid_json", chunks(encoder.encode(`${JSON.stringify(request())}${JSON.stringify(request())}`))],
  ];
  for (const [code, input] of cases) {
    const collector = outputCollector();
    assert.equal(await runHEvalPreviewCliV1({ args: ["--stdin"], input, output: collector.output }), 1);
    assert.equal((JSON.parse(collector.text) as { code: string }).code, code);
  }

  const erroringInput: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      yield encoder.encode("{");
      throw new Error("stream failure");
    },
  };
  const errorCollector = outputCollector();
  assert.equal(
    await runHEvalPreviewCliV1({ args: ["--stdin"], input: erroringInput, output: errorCollector.output }),
    1,
  );
  assert.equal((JSON.parse(errorCollector.text) as { code: string }).code, "internal_error");
});

test("A4-CG6-T1 deterministic-one-line-cli-protocol", async () => {
  const valid = encoder.encode(JSON.stringify(request()));
  const collector = outputCollector();
  const status = await runHEvalPreviewCliV1({ args: ["--stdin"], input: chunks(valid), output: collector.output });
  assert.equal(status, 0);
  assert.equal(collector.writes, 1);
  assert.equal(
    collector.text,
    "{\"schema\":\"h_eval_preview_result_v1\",\"mode\":\"dormant_preview_only\",\"ok\":true,\"code\":\"evaluated\",\"automaticInterventionAllowed\":false,\"policy\":{\"verdict\":\"supported\",\"decisionStage\":\"provisional\",\"reasonCode\":\"eligible_window\"}}\n",
  );

  let throwWrites = 0;
  const thrown = await runHEvalPreviewCliV1({
    args: [],
    input: chunks(),
    output: {
      write() {
        throwWrites += 1;
        throw new Error("writer failure");
      },
    },
  });
  assert.equal(thrown, 1);
  assert.equal(throwWrites, 1);

  let callbackErrorWrites = 0;
  const callbackError = await runHEvalPreviewCliV1({
    args: [],
    input: chunks(),
    output: {
      write(_line, callback) {
        callbackErrorWrites += 1;
        callback(new Error("writer callback failure"));
        return true;
      },
    },
  });
  assert.equal(callbackError, 1);
  assert.equal(callbackErrorWrites, 1);

  let callbackThenThrowWrites = 0;
  const callbackThenThrow = await runHEvalPreviewCliV1({
    args: ["--stdin"],
    input: chunks(valid),
    output: {
      write(_line, callback) {
        callbackThenThrowWrites += 1;
        callback(null);
        throw new Error("writer throws after inline callback");
      },
    },
  });
  assert.equal(callbackThenThrow, 1);
  assert.equal(callbackThenThrowWrites, 1);

  let delayedWrites = 0;
  const delayed = await runHEvalPreviewCliV1({
    args: [],
    input: chunks(),
    output: {
      write(_line, callback) {
        delayedWrites += 1;
        queueMicrotask(() => callback(null));
        return false;
      },
    },
  });
  assert.equal(delayed, 1);
  assert.equal(delayedWrites, 1);

  const smoke = spawnSync("npm", ["run", "--silent", "harness:evaluate-preview", "--", "--stdin"], {
    cwd: process.cwd(),
    input: JSON.stringify(request()),
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(smoke.stderr, "");
  assert.equal(smoke.stdout, collector.text);
});
