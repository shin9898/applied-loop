import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  createHEvalSchedulePayloadV1,
  H_EVAL_JOB_REGISTRY,
} from "./h-eval-job-contract-v1";
import {
  createLoopJobQueue,
  decodeLoopJobPayload,
  defineLoopJobRegistry,
  type LoopJobClient,
} from "../state-machine";

const hash = (character: string) => character.repeat(64);
const policyVersion = "v1";
const NON_A3_TRACKED_PATH_COUNT = 549;
const NON_A3_TRACKED_CONTENT_AGGREGATE_SHA256 = "9e205fec0b4e74579828978d5a41371da0d10e02d2946d797b09b2bca2e6bfa9";
const A3_CHANGED_PATHS = [
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract-v1.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-contract.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-promotion.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-thresholds.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-v1.ts",
] as const;
const A3_DIRECTORY_PREFIX = "src/lib/loop-jobs/harness-evaluation/";
const A3_PRODUCTION_SOURCE_SHA256 = {
  "h-eval-policy-v1.ts": "0528199d975ecb0f3b405ea80b1891cdb978a010594d8c7f7603af5cb9808000",
  "h-eval-job-contract-v1.ts": "25a6bbc3bfd0ef30c70ee063c227e0352c6b0b76a2241e6fb206d61e1c6318ba",
} as const;
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"] as const;
const FORBIDDEN_A3_LOADER_IDENTIFIERS = new Set([
  "require",
  "createRequire",
  "global",
  "globalThis",
  "process",
  "module",
  "Deno",
  "Bun",
  "eval",
  "Function",
  "AsyncFunction",
]);

function periodHash(cadence: string, ordinal: number, start: number, end: number) {
  return createHash("sha256")
    .update(JSON.stringify(["h_eval_period_v1", policyVersion, cadence, ordinal, start, end]), "utf8")
    .digest("hex");
}

function identity() {
  return {
    policyVersion,
    cadence: "daily",
    scopeHash: hash("a"),
    periodHash: periodHash("daily", 7, 7_000, 8_000),
    periodOrdinal: 7,
    periodStartEpochMs: 7_000,
    periodEndEpochMs: 8_000,
  };
}

function assertFrozenDeeply(value: object) {
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") assertFrozenDeeply(nested);
  }
}

function directStaticSpecifiers(fileName: string, source: string): string[] {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".mjs")
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2017, true, scriptKind);
  const results: string[] = [];

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) {
      results.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      results.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return results.sort();
}

type RuntimeModuleEdge = Readonly<{
  kind: "static" | "dynamic_import" | "require";
  specifier?: string;
  computed: boolean;
}>;

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".mjs") || fileName.endsWith(".cjs") || fileName.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function literalModuleSpecifier(value: ts.Expression | undefined): string | undefined {
  if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) return value.text;
  return undefined;
}

function propertyNamed(expression: ts.Expression, name: string): boolean {
  return (ts.isPropertyAccessExpression(expression) && expression.name.text === name) ||
    (ts.isElementAccessExpression(expression) && literalModuleSpecifier(expression.argumentExpression) === name);
}

function createRequireFactoryBindings(file: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>(["createRequire"]);
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ((ts.isIdentifier(node.initializer) && bindings.has(node.initializer.text)) ||
            propertyNamed(node.initializer, "createRequire")) && !bindings.has(node.name.text)) {
        bindings.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return bindings;
}

function isCreateRequireFactoryCall(expression: ts.Expression, factoryBindings: ReadonlySet<string>): boolean {
  return (ts.isIdentifier(expression) && factoryBindings.has(expression.text)) ||
    propertyNamed(expression, "createRequire");
}

function isRequireReference(expression: ts.Expression, bindings: ReadonlySet<string>): boolean {
  return (ts.isIdentifier(expression) && bindings.has(expression.text)) || propertyNamed(expression, "require");
}

function isRequireResolverReference(expression: ts.Expression, bindings: ReadonlySet<string>): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "resolve" &&
    isRequireReference(expression.expression, bindings);
}

function createRequireBindings(file: ts.SourceFile, factoryBindings: ReadonlySet<string>): ReadonlySet<string> {
  const bindings = new Set<string>(["require"]);
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ((ts.isCallExpression(node.initializer) && isCreateRequireFactoryCall(node.initializer.expression, factoryBindings)) ||
            isRequireReference(node.initializer, bindings) ||
            isRequireResolverReference(node.initializer, bindings)) && !bindings.has(node.name.text)) {
        bindings.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return bindings;
}

function isRequireLikeCall(
  expression: ts.Expression,
  bindings: ReadonlySet<string>,
  factoryBindings: ReadonlySet<string>,
): boolean {
  if (isRequireReference(expression, bindings)) return true;
  if (isRequireResolverReference(expression, bindings)) return true;
  return ts.isCallExpression(expression) && isCreateRequireFactoryCall(expression.expression, factoryBindings);
}

function runtimeModuleEdges(fileName: string, source: string): RuntimeModuleEdge[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2017, true, scriptKindFor(fileName));
  const factoryBindings = createRequireFactoryBindings(file);
  const bindings = createRequireBindings(file, factoryBindings);
  const results: RuntimeModuleEdge[] = [];

  function push(kind: RuntimeModuleEdge["kind"], expression: ts.Expression | undefined) {
    const specifier = literalModuleSpecifier(expression);
    results.push(specifier === undefined ? { kind, computed: true } : { kind, specifier, computed: false });
  }

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) {
      results.push({ kind: "static", specifier: node.moduleSpecifier.text, computed: false });
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push("static", node.moduleReference.expression);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        push("dynamic_import", node.arguments[0]);
      } else if (isRequireLikeCall(node.expression, bindings, factoryBindings)) {
        push("require", node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return results;
}

function forbiddenA3LoaderSyntaxes(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2017, true, scriptKindFor(fileName));
  const factoryBindings = createRequireFactoryBindings(file);
  const requireBindings = createRequireBindings(file, factoryBindings);
  const forbidden: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && FORBIDDEN_A3_LOADER_IDENTIFIERS.has(node.text)) {
      forbidden.push(`forbidden_identifier:${node.text}`);
    }
    if (ts.isPropertyAccessExpression(node) &&
        (node.name.text === "require" || node.name.text === "createRequire")) {
      forbidden.push(`forbidden_property:${node.name.text}`);
    }
    if (ts.isElementAccessExpression(node) &&
        (literalModuleSpecifier(node.argumentExpression) === "require" ||
          literalModuleSpecifier(node.argumentExpression) === "createRequire")) {
      forbidden.push("forbidden_loader_element_access");
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      forbidden.push("import_equals_require");
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) forbidden.push("dynamic_import");
      if (isCreateRequireFactoryCall(node.expression, factoryBindings)) forbidden.push("create_require_factory");
      if (isRequireLikeCall(node.expression, requireBindings, factoryBindings)) forbidden.push("require_like");
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return forbidden.sort();
}

function canonicalEdges(edges: readonly RuntimeModuleEdge[]): RuntimeModuleEdge[] {
  return [...edges].sort((left, right) => {
    const leftKey = `${left.kind}\t${left.computed}\t${left.specifier ?? ""}`;
    const rightKey = `${right.kind}\t${right.computed}\t${right.specifier ?? ""}`;
    return leftKey.localeCompare(rightKey);
  });
}

function assertExactA3ProductionEdges(
  fileName: string,
  source: string,
  expectedSpecifiers: readonly string[],
): void {
  assert.deepEqual(
    canonicalEdges(runtimeModuleEdges(fileName, source)),
    canonicalEdges(expectedSpecifiers.map((specifier) => ({ kind: "static" as const, specifier, computed: false }))),
    "unexpected A3 module edge",
  );
  assert.deepEqual(forbiddenA3LoaderSyntaxes(fileName, source), [], "unexpected A3 module edge");
}

function assertExactA3ProductionByteSurface(fileName: string, sourceBytes: Uint8Array, expectedSha256: string): void {
  assert.equal(
    createHash("sha256").update(sourceBytes).digest("hex"),
    expectedSha256,
    `unexpected A3 production byte surface: ${fileName}`,
  );
}

function isAtOrBelow(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function localTargetCandidates(importer: string, specifier: string, sourceRoot: string): string[] {
  const candidate = specifier.startsWith("@/")
    ? resolve(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(join(importer, ".."), specifier)
      : undefined;
  if (!candidate) return [];
  const withoutExtension = candidate.replace(/\.(?:ts|tsx|js|mjs|cjs|mts|cts|json)$/, "");
  return [...new Set([
    candidate,
    withoutExtension,
    ...MODULE_EXTENSIONS.map((extension) => `${withoutExtension}${extension}`),
    resolve(candidate, "index"),
    resolve(withoutExtension, "index"),
    ...MODULE_EXTENSIONS.map((extension) => resolve(withoutExtension, `index${extension}`)),
  ])];
}

function resolvesIntoA3(importer: string, specifier: string, sourceRoot: string, a3Root: string): boolean {
  return localTargetCandidates(importer, specifier, sourceRoot).some((candidate) => isAtOrBelow(a3Root, candidate));
}

function gitLines(root: string, args: string[]): string[] {
  const output = execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  return output ? output.split("\n").filter(Boolean) : [];
}

function contentSha256(path: string): string {
  const stat = lstatSync(path);
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path), "utf8") : readFileSync(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertA3ChangedPathScope(root: string, a3Root: string): Promise<void> {
  const nonA3Tracked = gitLines(root, ["ls-files"])
    .filter((path) => !path.startsWith(A3_DIRECTORY_PREFIX))
    .sort();
  assert.equal(nonA3Tracked.length, NON_A3_TRACKED_PATH_COUNT, "unexpected non-A3 tracked path count");
  const aggregate = nonA3Tracked
    .map((path) => `${path}\t${contentSha256(join(root, path))}\n`)
    .join("");
  assert.equal(
    createHash("sha256").update(aggregate, "utf8").digest("hex"),
    NON_A3_TRACKED_CONTENT_AGGREGATE_SHA256,
    "unexpected non-A3 tracked content aggregate",
  );
  const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard"]);
  assert.equal(
    untracked.every((path) => (A3_CHANGED_PATHS as readonly string[]).includes(path)),
    true,
    "unexpected untracked path outside the A3 allowlist",
  );
  assert.deepEqual(
    (await sourceFiles(a3Root)).map((path) => relative(root, path)).sort(),
    [...A3_CHANGED_PATHS].sort(),
    "unexpected A3 source path",
  );
}

type A3DirectoryEntry = Readonly<{
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
}>;

function canonicalDirectoryEntries(entries: readonly A3DirectoryEntry[]): A3DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    return pathOrder !== 0 ? pathOrder : left.kind.localeCompare(right.kind);
  });
}

function assertExactA3DirectoryEntrySurface(entries: readonly A3DirectoryEntry[]): void {
  assert.deepEqual(
    canonicalDirectoryEntries(entries),
    canonicalDirectoryEntries(A3_CHANGED_PATHS.map((path) => ({ path, kind: "file" as const }))),
    "unexpected A3 directory entry surface",
  );
}

async function allA3DirectoryEntries(repoRoot: string, directory: string): Promise<A3DirectoryEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    const relativePath = relative(repoRoot, path);
    if (entry.isDirectory()) {
      return [{ path: relativePath, kind: "directory" as const }, ...(await allA3DirectoryEntries(repoRoot, path))];
    }
    return [{
      path: relativePath,
      kind: entry.isFile() ? "file" as const : entry.isSymbolicLink() ? "symlink" as const : "other" as const,
    }];
  }));
  return nested.flat();
}

async function assertExactA3DirectoryEntries(repoRoot: string, a3Root: string): Promise<void> {
  assertExactA3DirectoryEntrySurface(await allA3DirectoryEntries(repoRoot, a3Root));
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs|cjs|mts|cts)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

function recordingQueue() {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    loopJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data };
        rows.push(row);
        return row;
      },
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as LoopJobClient;
  const queue = createLoopJobQueue({
    client,
    registry: H_EVAL_JOB_REGISTRY,
    clock: {
      now: () => new Date("2026-08-23T00:00:00.000Z"),
      addMilliseconds: (date: Date, milliseconds: number) => new Date(date.getTime() + milliseconds),
      fromStorage: (value: string) => new Date(value),
    },
    randomBytes: () => new Uint8Array(16),
  });
  return { queue, rows };
}

test("A3-CG4-T1 dormant-harness-evaluate-identity-and-import-boundary", async (t) => {
  await t.test("constructs only the frozen five-field future payload without echoing invalid input", () => {
    const input = identity();
    const before = structuredClone(input);
    const valid = createHEvalSchedulePayloadV1(input);

    assert.deepEqual(input, before);
    assert.deepEqual(valid, {
      ok: true,
      payload: {
        hypothesis: "h_eval",
        cadence: "daily",
        scopeHash: hash("a"),
        periodHash: periodHash("daily", 7, 7_000, 8_000),
        policyVersion: "v1",
      },
    });
    assertFrozenDeeply(valid);
    if (valid.ok) {
      assert.deepEqual(Object.keys(valid.payload).sort(), ["cadence", "hypothesis", "periodHash", "policyVersion", "scopeHash"]);
    }

    const sentinel = "raw-metric-snapshot-secret";
    const invalid = { ...identity(), metricSnapshot: { secret: sentinel } };
    const first = createHEvalSchedulePayloadV1(invalid);
    const second = createHEvalSchedulePayloadV1(new Proxy(identity(), {
      ownKeys() {
        throw new Error(sentinel);
      },
    }));
    assert.deepEqual(first, { ok: false, code: "invalid_job_identity" });
    assert.deepEqual(second, { ok: false, code: "invalid_job_identity" });
    assert.notStrictEqual(first, second);
    assertFrozenDeeply(first);
    assertFrozenDeeply(second);
    assert.equal(JSON.stringify(first).includes(sentinel), false);
    assert.equal(JSON.stringify(second).includes(sentinel), false);
  });

  await t.test("proves the actual A2 projection with an in-memory recording client only", async () => {
    const payload = createHEvalSchedulePayloadV1(identity());
    assert.equal(payload.ok, true);
    if (!payload.ok) return;
    const { queue, rows } = recordingQueue();
    const first = await queue.enqueue({ kind: "harness_evaluate", payload: payload.payload, maxAttempts: 1 });
    const second = await queue.enqueue({ kind: "harness_evaluate", payload: payload.payload, maxAttempts: 1 });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].dedupeKey, rows[1].dedupeKey);

    const decoded = decodeLoopJobPayload(H_EVAL_JOB_REGISTRY, {
      kind: "harness_evaluate",
      payloadJson: rows[0].payloadJson as string,
      payloadHash: rows[0].payloadHash as string,
    });
    assert.deepEqual(decoded, { ok: true, payload: payload.payload });

    const changed = { ...payload.payload, cadence: "weekly" };
    const changedResult = await queue.enqueue({ kind: "harness_evaluate", payload: changed, maxAttempts: 1 });
    assert.equal(changedResult.ok, true);
    assert.notEqual(rows[0].dedupeKey, rows[2].dedupeKey);

    const scopeChanged = await queue.enqueue({
      kind: "harness_evaluate",
      payload: { ...payload.payload, scopeHash: hash("d") },
      maxAttempts: 1,
    });
    const periodChanged = await queue.enqueue({
      kind: "harness_evaluate",
      payload: { ...payload.payload, periodHash: hash("e") },
      maxAttempts: 1,
    });
    assert.equal(scopeChanged.ok, true);
    assert.equal(periodChanged.ok, true);
    assert.equal(new Set([rows[0].dedupeKey, rows[2].dedupeKey, rows[3].dedupeKey, rows[4].dedupeKey]).size, 4);

    const versionFixture = defineLoopJobRegistry({
      harness_evaluate: {
        version: "v1",
        fields: {
          hypothesis: { type: "enum", values: ["h_eval"] as const },
          cadence: { type: "enum", values: ["daily", "weekly", "intervention_7d", "intervention_14d", "monthly"] as const },
          scopeHash: { type: "hash" },
          periodHash: { type: "hash" },
          policyVersion: { type: "enum", values: ["v1", "v2"] as const },
        },
        dedupeFields: ["hypothesis", "cadence", "scopeHash", "periodHash", "policyVersion"] as const,
      },
    });
    const versionRows: Array<Record<string, unknown>> = [];
    const versionClient = {
      loopJob: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data };
          versionRows.push(row);
          return row;
        },
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as LoopJobClient;
    const versionQueue = createLoopJobQueue({
      client: versionClient,
      registry: versionFixture,
      clock: {
        now: () => new Date("2026-08-23T00:00:00.000Z"),
        addMilliseconds: (date: Date, milliseconds: number) => new Date(date.getTime() + milliseconds),
        fromStorage: (value: string) => new Date(value),
      },
      randomBytes: () => new Uint8Array(16),
    });
    await versionQueue.enqueue({ kind: "harness_evaluate", payload: payload.payload, maxAttempts: 1 });
    await versionQueue.enqueue({
      kind: "harness_evaluate",
      payload: { ...payload.payload, policyVersion: "v2" },
      maxAttempts: 1,
    });
    assert.notEqual(versionRows[0].dedupeKey, versionRows[1].dedupeKey);
  });

  await t.test("keeps production imports and runtime paths dormant through parsed static boundaries", async () => {
    const root = process.cwd();
    const sourceRoot = join(root, "src");
    const a3Root = join(sourceRoot, "lib/loop-jobs/harness-evaluation");
    const policyPath = join(a3Root, "h-eval-policy-v1.ts");
    const jobPath = join(a3Root, "h-eval-job-contract-v1.ts");
    const policyBytes = await readFile(policyPath);
    const jobBytes = await readFile(jobPath);
    const policySource = policyBytes.toString("utf8");
    const jobSource = jobBytes.toString("utf8");
    assertExactA3ProductionByteSurface(
      policyPath,
      policyBytes,
      A3_PRODUCTION_SOURCE_SHA256["h-eval-policy-v1.ts"],
    );
    assertExactA3ProductionByteSurface(
      jobPath,
      jobBytes,
      A3_PRODUCTION_SOURCE_SHA256["h-eval-job-contract-v1.ts"],
    );
    assert.throws(
      () => assertExactA3ProductionByteSurface(
        "policy-dynamic-constructor.ts",
        Buffer.from('const f = ({}).constructor.constructor as unknown as (source: string) => () => Promise<unknown>; void f(\'return import("node:fs")\')();', "utf8"),
        A3_PRODUCTION_SOURCE_SHA256["h-eval-policy-v1.ts"],
      ),
      /unexpected A3 production byte surface/,
    );
    assert.deepEqual(directStaticSpecifiers(join(a3Root, "h-eval-policy-v1.ts"), policySource), ["node:crypto"]);
    assert.deepEqual(directStaticSpecifiers(join(a3Root, "h-eval-job-contract-v1.ts"), jobSource), ["../state-machine", "node:crypto"]);
    assertExactA3ProductionEdges(join(a3Root, "h-eval-policy-v1.ts"), policySource, ["node:crypto"]);
    assertExactA3ProductionEdges(join(a3Root, "h-eval-job-contract-v1.ts"), jobSource, ["../state-machine", "node:crypto"]);
    assert.throws(
      () => assertExactA3ProductionEdges("policy-dynamic.ts", 'void import("./" + suffix);', ["node:crypto"]),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-literal-dynamic.ts", 'void import("node:crypto");', []),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-literal-require.ts", 'require("node:crypto");', []),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-import-equals.ts", 'import legacy = require("node:crypto");', ["node:crypto"]),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-require-alias.ts", 'const loader = require; loader("node:crypto");', []),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-create-require.ts", "const loader = createRequire(import.meta.url);", []),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-create-require-alias.ts", "const factory = createRequire; const loader = factory(import.meta.url); loader(\"./\" + suffix);", []),
      /unexpected A3 module edge/,
    );
    assert.throws(
      () => assertExactA3ProductionEdges("policy-computed-global-loader.ts", "const loader = globalThis[key]; loader(\"./\" + suffix);", []),
      /unexpected A3 module edge/,
    );
    const commentSeparatedImport = "@/lib/loop-jobs/harness-evaluation/h-eval-policy-v1";
    assert.deepEqual(
      directStaticSpecifiers("guard-fixture.ts", `import { evaluator } from /* separated comment */ "${commentSeparatedImport}";`),
      [commentSeparatedImport],
    );
    const fixturePath = join(sourceRoot, "lib/loop-jobs/worker-phase2.ts");
    const fixtureEdges = runtimeModuleEdges(fixturePath, `
      import { evaluator } from /* separated comment */ "${commentSeparatedImport}";
      export { evaluator } from "${commentSeparatedImport}";
      import legacy = require("${commentSeparatedImport}");
      void import("${commentSeparatedImport}.ts");
      require("${commentSeparatedImport}");
      module.require("${commentSeparatedImport}");
      const loader = createRequire(import.meta.url);
      loader("${commentSeparatedImport}");
      createRequire(import.meta.url)("./harness-evaluation/index");
      void import(target);
      loader(target);
    `);
    for (const edge of fixtureEdges) {
      if (edge.specifier === undefined || edge.specifier === "node:module") continue;
      assert.equal(resolvesIntoA3(fixturePath, edge.specifier, sourceRoot, a3Root), true, edge.specifier);
    }
    assert.equal(fixtureEdges.filter((edge) => edge.computed).length, 2);
    await assertA3ChangedPathScope(root, a3Root);
    await assertExactA3DirectoryEntries(root, a3Root);
    assert.throws(
      () => assertExactA3DirectoryEntrySurface([
        ...A3_CHANGED_PATHS.map((path) => ({ path, kind: "file" as const })),
        { path: "src/lib/loop-jobs/harness-evaluation/README.md", kind: "file" as const },
      ]),
      /unexpected A3 directory entry surface/,
    );

    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.equal(Object.values(packageJson.scripts).some((script) => script.includes("harness-evaluation")), false);

    const workerPhase2 = await readFile(join(sourceRoot, "lib/loop-jobs/worker-phase2.ts"), "utf8");
    assert.match(workerPhase2, /const productionRegistry = defineLoopJobRegistry\(\{\}\);/);
    assert.match(workerPhase2, /handlers: \{\}/);

    const externalExecutableSources = [
      ...(await sourceFiles(sourceRoot)).filter((path) => !path.endsWith(".test.ts") && !isAtOrBelow(a3Root, path)),
      ...(await sourceFiles(join(root, "scripts"))),
    ];
    for (const path of [...new Set(externalExecutableSources)]) {
      const source = await readFile(path, "utf8");
      for (const edge of runtimeModuleEdges(path, source)) {
        if (edge.computed || edge.specifier === undefined) continue;
        assert.equal(
          resolvesIntoA3(path, edge.specifier, sourceRoot, a3Root),
          false,
          `${relative(root, path)} imports A3 runtime via ${edge.kind}`,
        );
      }
    }
  });
});
