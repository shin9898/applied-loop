import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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
const NON_A4_A5_TRACKED_PATH_COUNT = 544;
const NON_A4_A5_TRACKED_CONTENT_AGGREGATE_SHA256 = "04029cc452fca91924a78a4980e7a8478646416da4e068cb17637d3f6e7581c9";
const H_EVAL_ALLOWED_PATHS = [
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract-v1.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-contract.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-promotion.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-thresholds.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-policy-v1.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-preview-v1.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-preview-cli.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-preview-main.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-preview-v1.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-preview-cli.test.ts",
  "src/lib/loop-jobs/harness-evaluation/h-eval-preview-dormancy.test.ts",
] as const;
const H_EVAL_DIRECTORY_PREFIX = "src/lib/loop-jobs/harness-evaluation/";
const A5_ALLOWED_NON_H_EVAL_PATHS = [
  "package.json",
  "prisma/migrations/20260823145705_harness_usage_evidence/migration.sql",
  "prisma/schema.prisma",
  "scripts/collect-harness.mjs",
  "scripts/plan-harness-usage-backfill.ts",
  "src/app/api/harness-runs/route.ts",
  "src/lib/harness-run-ingestion.test.ts",
  "src/lib/harness-run-ingestion.ts",
  "src/lib/harness-usage-backfill.test.ts",
  "src/lib/harness-usage-backfill.ts",
  "src/lib/harness-usage-evidence.test.ts",
  "src/lib/harness-usage-evidence.ts",
  "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
] as const;
const A5_NON_ACTIVATION_PRODUCTION_PATHS = [
  "scripts/collect-harness.mjs",
  "scripts/plan-harness-usage-backfill.ts",
  "src/app/api/harness-runs/route.ts",
  "src/lib/harness-run-ingestion.ts",
  "src/lib/harness-usage-backfill.ts",
  "src/lib/harness-usage-evidence.ts",
] as const;
const A3_PRODUCTION_SOURCE_SHA256 = {
  "h-eval-policy-v1.ts": "0528199d975ecb0f3b405ea80b1891cdb978a010594d8c7f7603af5cb9808000",
  "h-eval-job-contract-v1.ts": "25a6bbc3bfd0ef30c70ee063c227e0352c6b0b76a2241e6fb206d61e1c6318ba",
} as const;
const A3_IMMUTABLE_POLICY_TEST_SHA256 = {
  "h-eval-policy-contract.test.ts": "12c3155542283213fa1657047ce1a4806d60c0b56bce99cac5c34b3649f905d2",
  "h-eval-policy-promotion.test.ts": "e269b18778a3f45780e6920ae5f1132958a3bc4ab12faea77492501414483948",
  "h-eval-policy-thresholds.test.ts": "98a0f263aa0b9f907ad1514f908db3d6dcc795703af5a0e617dc62c55c175989",
} as const;
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"] as const;
const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const BASELINE_CSS_ASSET_EDGE_MANIFEST = [
  {
    importer: "src/app/layout.tsx",
    kind: "static",
    specifier: "./globals.css",
    target: "src/app/globals.css",
  },
  {
    importer: "src/app/layout.tsx",
    kind: "static",
    specifier: "./atlas-living.css",
    target: "src/app/atlas-living.css",
  },
  {
    importer: "src/components/terminal-panel.tsx",
    kind: "static",
    specifier: "xterm/css/xterm.css",
    packageSuffix: "xterm/css/xterm.css",
  },
] as const;
const BASELINE_ABSENT_EXTERNAL_PACKAGE_MANIFEST = [
  {
    importer: "scripts/test-shift-enter.mjs",
    kind: "static",
    specifier: "@xterm/headless",
  },
] as const;
const BASELINE_PINNED_COMPUTED_DYNAMIC_IMPORT = {
  importer: "scripts/rewrite-gates.mjs",
  kind: "dynamic_import",
  target: "src/lib/headless-llm.ts",
} as const;
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

type LiteralRuntimeModuleEdge = Readonly<{
  kind: RuntimeModuleEdge["kind"];
  specifier: string;
  computed: false;
}>;

function runtimeCompilerOptions(repoRoot: string): ts.CompilerOptions {
  const configurationPath = join(repoRoot, "tsconfig.json");
  const configuration = ts.readConfigFile(configurationPath, ts.sys.readFile);
  assert.equal(configuration.error, undefined, "unable to read committed tsconfig.json");
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, repoRoot, undefined, configurationPath);
  assert.deepEqual(parsed.errors, [], "unable to parse committed tsconfig.json");
  return parsed.options;
}

function canonicalResolvedRuntimeModule(
  specifier: string,
  importer: string,
  compilerOptions: ts.CompilerOptions,
): string | undefined {
  const resolution = ts.resolveModuleName(specifier, importer, compilerOptions, ts.sys).resolvedModule;
  if (!resolution) return undefined;
  const canonical = realpathSync(resolution.resolvedFileName);
  const state = lstatSync(canonical);
  assert.equal(state.isFile() && !state.isSymbolicLink(), true, `runtime import target is not a canonical file: ${specifier}`);
  return canonical;
}

function exceptionKey(importer: string, kind: RuntimeModuleEdge["kind"], specifier: string): string {
  return `${importer}\u0000${kind}\u0000${specifier}`;
}

function assertExactRewriteGatesComputedImport(
  repoRoot: string,
  a4Root: string,
  importer: string,
  source: string,
): void {
  const file = parsedSourceFile(importer, source);
  const pathImport = file.statements.find(
    (statement): statement is ts.ImportDeclaration => ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "node:path",
  );
  const pathBindings = pathImport?.importClause?.namedBindings;
  assert.equal(pathBindings && ts.isNamedImports(pathBindings), true, "rewrite-gates must use named node:path bindings");
  if (!pathBindings || !ts.isNamedImports(pathBindings)) return;
  assert.deepEqual(
    pathBindings.elements.map((element) => [element.propertyName?.text ?? element.name.text, element.name.text]),
    [["dirname", "dirname"], ["resolve", "resolve"]],
    "rewrite-gates must use unaliased dirname and resolve bindings",
  );

  function topLevelConstInitializer(name: string): ts.Expression {
    const matches: ts.VariableDeclaration[] = [];
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) matches.push(declaration);
      }
    }
    assert.equal(matches.length, 1, `rewrite-gates must have one top-level const ${name}`);
    if (matches.length !== 1) throw new Error(`missing ${name}`);
    return matches[0].initializer!;
  }

  const scriptDirectory = topLevelConstInitializer("SCRIPT_DIR");
  const repoDirectory = topLevelConstInitializer("REPO_ROOT");
  assert.equal(scriptDirectory.getText(file), "dirname(fileURLToPath(import.meta.url))");
  assert.equal(repoDirectory.getText(file), "resolve(SCRIPT_DIR, \"..\")");

  const computedImports: ts.CallExpression[] = [];
  const reassignedBindings: string[] = [];
  const bindingDeclarations = new Map<string, number>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        literalModuleSpecifier(node.arguments[0]) === undefined) {
      computedImports.push(node);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) && (node.left.text === "SCRIPT_DIR" || node.left.text === "REPO_ROOT" || node.left.text === "resolve")) {
      reassignedBindings.push(node.left.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        (node.name.text === "SCRIPT_DIR" || node.name.text === "REPO_ROOT" || node.name.text === "resolve")) {
      bindingDeclarations.set(node.name.text, (bindingDeclarations.get(node.name.text) ?? 0) + 1);
      if (node.name.text === "resolve") reassignedBindings.push("resolve");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.deepEqual(reassignedBindings, [], "rewrite-gates computed import bindings must remain immutable and unshadowed");
  assert.equal(bindingDeclarations.get("SCRIPT_DIR"), 1, "rewrite-gates must not shadow SCRIPT_DIR");
  assert.equal(bindingDeclarations.get("REPO_ROOT"), 1, "rewrite-gates must not shadow REPO_ROOT");
  assert.equal(bindingDeclarations.get("resolve") ?? 0, 0, "rewrite-gates must not shadow resolve");
  assert.equal(computedImports.length, 1, "rewrite-gates must contain exactly one computed dynamic import");
  const computedImport = computedImports[0];
  assert.equal(computedImport.parent.kind === ts.SyntaxKind.AwaitExpression, true, "rewrite-gates import must be awaited");
  assert.equal(computedImport.arguments.length, 1);
  const target = computedImport.arguments[0];
  assert.equal(ts.isCallExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === "resolve", true);
  if (!ts.isCallExpression(target)) return;
  assert.equal(target.arguments.length, 2);
  assert.equal(target.arguments[0].getText(file), "REPO_ROOT");
  assert.equal(target.arguments[1].getText(file), '"src/lib/headless-llm.ts"');

  const expectedTarget = resolve(repoRoot, BASELINE_PINNED_COMPUTED_DYNAMIC_IMPORT.target);
  const targetState = lstatSync(expectedTarget);
  assert.equal(targetState.isFile() && !targetState.isSymbolicLink(), true, "rewrite-gates computed target must be a regular file");
  assert.equal(realpathSync(expectedTarget), expectedTarget, "rewrite-gates computed target must be canonical");
  assert.equal(isAtOrBelow(a4Root, expectedTarget), false, "rewrite-gates computed target must stay outside A4");
}

function computedGlobalLoaderFindings(fileName: string, source: string): string[] {
  const file = parsedSourceFile(fileName, source);
  const aliases = new Set<string>();
  const findings: string[] = [];

  function unwrap(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    }
    return current;
  }

  function isHostGlobal(expression: ts.Expression): boolean {
    const unwrapped = unwrap(expression);
    return ts.isIdentifier(unwrapped) && (unwrapped.text === "global" || unwrapped.text === "globalThis");
  }

  function isComputedHostLoader(expression: ts.Expression): boolean {
    const unwrapped = unwrap(expression);
    return ts.isElementAccessExpression(unwrapped) && isHostGlobal(unwrapped.expression) &&
      literalModuleSpecifier(unwrapped.argumentExpression) === undefined;
  }

  function addBindingAliases(name: ts.BindingName): boolean {
    if (ts.isIdentifier(name)) {
      if (aliases.has(name.text)) return false;
      aliases.add(name.text);
      return true;
    }
    return name.elements.reduce((changed, element) => {
      if (!ts.isBindingElement(element)) return changed;
      return addBindingAliases(element.name) || changed;
    }, false);
  }

  function isAliasReference(expression: ts.Expression): boolean {
    const unwrapped = unwrap(expression);
    return ts.isIdentifier(unwrapped) && aliases.has(unwrapped.text);
  }

  let changed = true;
  while (changed) {
    changed = false;
    function collectAliases(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (isComputedHostLoader(node.initializer) || isAliasReference(node.initializer)) {
          changed = addBindingAliases(node.name) || changed;
        }
        if (ts.isObjectBindingPattern(node.name) && isHostGlobal(node.initializer)) {
          for (const element of node.name.elements) {
            if (element.propertyName && ts.isComputedPropertyName(element.propertyName) &&
                literalModuleSpecifier(element.propertyName.expression) === undefined) {
              changed = addBindingAliases(element.name) || changed;
            }
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left) && (isComputedHostLoader(node.right) || isAliasReference(node.right))) {
        if (!aliases.has(node.left.text)) {
          aliases.add(node.left.text);
          changed = true;
        }
      }
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(file);
  }

  function isComputedHostLoaderCall(expression: ts.Expression): boolean {
    const unwrapped = unwrap(expression);
    if (isComputedHostLoader(unwrapped)) return true;
    return ts.isPropertyAccessExpression(unwrapped) && ["call", "apply", "bind"].includes(unwrapped.name.text) &&
      isComputedHostLoader(unwrapped.expression);
  }

  function visitCalls(node: ts.Node): void {
    if (ts.isCallExpression(node) &&
        (isComputedHostLoaderCall(node.expression) || isAliasReference(node.expression))) {
      findings.push(node.getText(file));
    }
    ts.forEachChild(node, visitCalls);
  }

  function visitComputedGlobalAccesses(node: ts.Node): void {
    if (ts.isElementAccessExpression(node) && isComputedHostLoader(node)) findings.push(node.getText(file));
    ts.forEachChild(node, visitComputedGlobalAccesses);
  }

  visitComputedGlobalAccesses(file);
  visitCalls(file);
  return findings;
}

function assertComputedRuntimeEdgesFailClosed(
  repoRoot: string,
  a4Root: string,
  importer: string,
  importerRelative: string,
  source: string,
): boolean {
  const computedEdges = runtimeModuleEdges(importer, source).filter((edge) => edge.computed);
  const computedGlobalLoaders = computedGlobalLoaderFindings(importer, source);
  if (computedEdges.length === 0 && computedGlobalLoaders.length === 0) return false;
  const exactPinnedException = importerRelative === BASELINE_PINNED_COMPUTED_DYNAMIC_IMPORT.importer &&
    computedEdges.length === 1 && computedEdges[0].kind === BASELINE_PINNED_COMPUTED_DYNAMIC_IMPORT.kind &&
    computedGlobalLoaders.length === 0;
  if (!exactPinnedException) {
    throw new Error(`unexpected computed runtime edge in ${importerRelative}`);
  }
  assertExactRewriteGatesComputedImport(repoRoot, a4Root, importer, source);
  return true;
}

function assertCssManifestEdge(
  repoRoot: string,
  a4Root: string,
  importer: string,
  importerRelative: string,
  edge: LiteralRuntimeModuleEdge,
): string | undefined {
  const entry = BASELINE_CSS_ASSET_EDGE_MANIFEST.find((candidate) => candidate.importer === importerRelative &&
    candidate.kind === edge.kind && candidate.specifier === edge.specifier);
  if (!entry) return undefined;
  if ("target" in entry) {
    const target = resolve(repoRoot, entry.target);
    const targetState = lstatSync(target);
    assert.equal(targetState.isFile() && !targetState.isSymbolicLink(), true, `CSS target must be a regular file: ${entry.target}`);
    assert.equal(realpathSync(target), target, `CSS target must be canonical: ${entry.target}`);
    assert.equal(isAtOrBelow(a4Root, target), false, "CSS target must stay outside A4");
  } else {
    const importerRequire = createRequire(pathToFileURL(importer).href);
    const resolvedAsset = realpathSync(importerRequire.resolve(edge.specifier));
    const canonicalNodeModules = realpathSync(join(repoRoot, "node_modules"));
    const targetState = lstatSync(resolvedAsset);
    assert.equal(targetState.isFile() && !targetState.isSymbolicLink(), true, "package CSS target must be a regular canonical file");
    assert.equal(isAtOrBelow(canonicalNodeModules, resolvedAsset), true, "package CSS target must stay below node_modules");
    assert.equal(relative(canonicalNodeModules, resolvedAsset).split(sep).join("/"), entry.packageSuffix);
    assert.equal(isAtOrBelow(a4Root, resolvedAsset), false, "package CSS target must stay outside A4");
  }
  return exceptionKey(importerRelative, edge.kind, edge.specifier);
}

function assertAbsentPackageManifestEdge(
  importer: string,
  importerRelative: string,
  edge: LiteralRuntimeModuleEdge,
): string | undefined {
  const entry = BASELINE_ABSENT_EXTERNAL_PACKAGE_MANIFEST.find((candidate) => candidate.importer === importerRelative &&
    candidate.kind === edge.kind && candidate.specifier === edge.specifier);
  if (!entry) return undefined;
  const importerRequire = createRequire(pathToFileURL(importer).href);
  assert.throws(() => importerRequire.resolve(edge.specifier), { code: "MODULE_NOT_FOUND" });
  return exceptionKey(importerRelative, edge.kind, edge.specifier);
}

function classifyLiteralExternalRuntimeEdge(
  repoRoot: string,
  a4Root: string,
  compilerOptions: ts.CompilerOptions,
  importer: string,
  importerRelative: string,
  edge: LiteralRuntimeModuleEdge,
): "node_builtin" | "typescript_resolved" | "baseline_css_asset" | "baseline_absent_external_package" {
  if (edge.specifier.startsWith("node:")) {
    assert.equal(NODE_BUILTINS.has(edge.specifier.slice("node:".length)), true, `unknown node builtin: ${edge.specifier}`);
    return "node_builtin";
  }
  const resolved = canonicalResolvedRuntimeModule(edge.specifier, importer, compilerOptions);
  if (resolved) {
    assert.equal(isAtOrBelow(a4Root, resolved), false, `${importerRelative} resolves into A4 via ${edge.kind}`);
    return "typescript_resolved";
  }
  const css = assertCssManifestEdge(repoRoot, a4Root, importer, importerRelative, edge);
  if (css !== undefined) return "baseline_css_asset";
  const absent = assertAbsentPackageManifestEdge(importer, importerRelative, edge);
  if (absent !== undefined) return "baseline_absent_external_package";
  throw new Error(`unclassified unresolved runtime edge ${edge.kind}:${edge.specifier} from ${importerRelative}`);
}

async function assertExternalRuntimeEdgesFailClosed(root: string, sourceRoot: string, a4Root: string): Promise<void> {
  const compilerOptions = runtimeCompilerOptions(root);
  const sources = [
    ...(await sourceFiles(sourceRoot)).filter((path) => !path.endsWith(".test.ts") && !isAtOrBelow(a4Root, path)),
    ...(await sourceFiles(join(root, "scripts"))),
  ];
  const observedCss: string[] = [];
  const observedAbsentPackages: string[] = [];
  const observedComputed: string[] = [];
  for (const importer of [...new Set(sources)].sort()) {
    const source = await readFile(importer, "utf8");
    const importerRelative = relative(root, importer).split(sep).join("/");
    if (assertComputedRuntimeEdgesFailClosed(root, a4Root, importer, importerRelative, source)) {
      observedComputed.push(importerRelative);
    }
    for (const edge of runtimeModuleEdges(importer, source)) {
      if (edge.computed || edge.specifier === undefined) continue;
      const literalEdge: LiteralRuntimeModuleEdge = { kind: edge.kind, specifier: edge.specifier, computed: false };
      const classification = classifyLiteralExternalRuntimeEdge(
        root,
        a4Root,
        compilerOptions,
        importer,
        importerRelative,
        literalEdge,
      );
      if (classification === "baseline_css_asset") observedCss.push(exceptionKey(importerRelative, edge.kind, edge.specifier));
      if (classification === "baseline_absent_external_package") {
        observedAbsentPackages.push(exceptionKey(importerRelative, edge.kind, edge.specifier));
      }
    }
  }
  assert.deepEqual(
    observedCss.sort(),
    BASELINE_CSS_ASSET_EDGE_MANIFEST.map((entry) => exceptionKey(entry.importer, entry.kind, entry.specifier)).sort(),
    "CSS exception manifest drift",
  );
  assert.deepEqual(
    observedAbsentPackages.sort(),
    BASELINE_ABSENT_EXTERNAL_PACKAGE_MANIFEST.map((entry) => exceptionKey(entry.importer, entry.kind, entry.specifier)).sort(),
    "absent-package exception manifest drift",
  );
  assert.deepEqual(observedComputed.sort(), [BASELINE_PINNED_COMPUTED_DYNAMIC_IMPORT.importer]);
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

type JsonDataRecord = Record<string, unknown>;

function isOrdinaryDataObject(value: unknown): value is JsonDataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && "value" in descriptor);
  });
}

class UniqueJsonMemberScanner {
  #offset = 0;

  constructor(private readonly text: string) {}

  scanDocument(): void {
    this.skipWhitespace();
    this.scanValue();
    this.skipWhitespace();
    if (this.#offset !== this.text.length) throw new Error("unexpected JSON suffix");
  }

  private current(): string | undefined {
    return this.text[this.#offset];
  }

  private consume(expected: string): void {
    if (this.current() !== expected) throw new Error(`expected JSON token ${expected}`);
    this.#offset += 1;
  }

  private skipWhitespace(): void {
    while (this.current() === " " || this.current() === "\t" || this.current() === "\n" || this.current() === "\r") {
      this.#offset += 1;
    }
  }

  private scanValue(): void {
    this.skipWhitespace();
    switch (this.current()) {
      case "{":
        this.scanObject();
        return;
      case "[":
        this.scanArray();
        return;
      case "\"":
        this.scanString();
        return;
      case "t":
        this.scanLiteral("true");
        return;
      case "f":
        this.scanLiteral("false");
        return;
      case "n":
        this.scanLiteral("null");
        return;
      default:
        this.scanNumber();
    }
  }

  private scanObject(): void {
    this.consume("{");
    this.skipWhitespace();
    if (this.current() === "}") {
      this.#offset += 1;
      return;
    }
    const memberNames = new Set<string>();
    while (true) {
      this.skipWhitespace();
      const key = this.scanString();
      if (memberNames.has(key)) throw new Error("duplicate JSON member");
      memberNames.add(key);
      this.skipWhitespace();
      this.consume(":");
      this.scanValue();
      this.skipWhitespace();
      if (this.current() === "}") {
        this.#offset += 1;
        return;
      }
      this.consume(",");
    }
  }

  private scanArray(): void {
    this.consume("[");
    this.skipWhitespace();
    if (this.current() === "]") {
      this.#offset += 1;
      return;
    }
    while (true) {
      this.scanValue();
      this.skipWhitespace();
      if (this.current() === "]") {
        this.#offset += 1;
        return;
      }
      this.consume(",");
    }
  }

  private scanString(): string {
    this.consume("\"");
    let decoded = "";
    while (true) {
      const character = this.current();
      if (character === undefined) throw new Error("unterminated JSON string");
      this.#offset += 1;
      if (character === "\"") return decoded;
      if (character.charCodeAt(0) < 0x20) throw new Error("control character in JSON string");
      if (character !== "\\") {
        decoded += character;
        continue;
      }
      const escape = this.current();
      if (escape === undefined) throw new Error("unterminated JSON escape");
      this.#offset += 1;
      switch (escape) {
        case "\"": decoded += "\""; break;
        case "\\": decoded += "\\"; break;
        case "/": decoded += "/"; break;
        case "b": decoded += "\b"; break;
        case "f": decoded += "\f"; break;
        case "n": decoded += "\n"; break;
        case "r": decoded += "\r"; break;
        case "t": decoded += "\t"; break;
        case "u": {
          const hex = this.text.slice(this.#offset, this.#offset + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("invalid JSON unicode escape");
          decoded += String.fromCharCode(Number.parseInt(hex, 16));
          this.#offset += 4;
          break;
        }
        default:
          throw new Error("invalid JSON escape");
      }
    }
  }

  private scanLiteral(literal: string): void {
    if (this.text.slice(this.#offset, this.#offset + literal.length) !== literal) {
      throw new Error("invalid JSON literal");
    }
    this.#offset += literal.length;
  }

  private scanNumber(): void {
    const start = this.#offset;
    if (this.current() === "-") {
      this.#offset += 1;
      const digitAfterMinus = this.current();
      if (!digitAfterMinus || digitAfterMinus < "0" || digitAfterMinus > "9") {
        throw new Error("invalid JSON number");
      }
    }
    if (this.current() === "0") {
      this.#offset += 1;
    } else {
      const first = this.current();
      if (!first || first < "1" || first > "9") throw new Error("invalid JSON number");
      this.#offset += 1;
      while (true) {
        const digit = this.current();
        if (!digit || digit < "0" || digit > "9") break;
        this.#offset += 1;
      }
    }
    if (this.current() === ".") {
      this.#offset += 1;
      const firstFraction = this.current();
      if (!firstFraction || firstFraction < "0" || firstFraction > "9") throw new Error("invalid JSON fraction");
      while (true) {
        const digit = this.current();
        if (!digit || digit < "0" || digit > "9") break;
        this.#offset += 1;
      }
    }
    if (this.current() === "e" || this.current() === "E") {
      this.#offset += 1;
      if (this.current() === "+" || this.current() === "-") this.#offset += 1;
      const firstExponent = this.current();
      if (!firstExponent || firstExponent < "0" || firstExponent > "9") throw new Error("invalid JSON exponent");
      while (true) {
        const digit = this.current();
        if (!digit || digit < "0" || digit > "9") break;
        this.#offset += 1;
      }
    }
    if (this.#offset === start) throw new Error("invalid JSON number");
  }
}

function parseUniquePackageJsonV1(rawBytes: Uint8Array, parseJson: (text: string) => unknown): JsonDataRecord {
  if (rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf) {
    throw new Error("package JSON BOM is forbidden");
  }
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
  new UniqueJsonMemberScanner(text).scanDocument();
  const parsed = parseJson(text);
  if (!isOrdinaryDataObject(parsed) || !isOrdinaryDataObject(parsed.scripts)) {
    throw new Error("package JSON root and scripts must be ordinary data objects");
  }
  return parsed;
}

function cloneJsonToNullPrototype(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => cloneJsonToNullPrototype(item));
  if (!isOrdinaryDataObject(value)) throw new Error("non-JSON package member");
  const copy = Object.create(null) as JsonDataRecord;
  for (const key of Object.keys(value)) copy[key] = cloneJsonToNullPrototype(value[key]);
  return copy;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("non-JSON primitive");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isOrdinaryDataObject(value)) throw new Error("non-JSON object");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function packageBaselineSha256(packageJson: JsonDataRecord): string {
  const baseline = cloneJsonToNullPrototype(packageJson) as JsonDataRecord;
  const scripts = baseline.scripts;
  if (!isOrdinaryDataObject(scripts)) throw new Error("package JSON scripts must be an object");
  delete scripts["harness:evaluate-preview"];
  delete scripts["harness:plan-usage-backfill"];
  return createHash("sha256").update(canonicalJson(baseline), "utf8").digest("hex");
}

function assertExactPreviewPackageException(rawBytes: Uint8Array): void {
  let parseCount = 0;
  const packageJson = parseUniquePackageJsonV1(rawBytes, (text) => {
    parseCount += 1;
    return JSON.parse(text);
  });
  assert.equal(parseCount, 1, "package JSON must take one semantic parse path");
  const scripts = packageJson.scripts;
  assert.equal(isOrdinaryDataObject(scripts), true, "package JSON scripts must be a data object");
  if (!isOrdinaryDataObject(scripts)) return;
  assert.equal(
    scripts["harness:evaluate-preview"],
    "tsx src/lib/loop-jobs/harness-evaluation/h-eval-preview-main.ts",
    "unexpected preview script value",
  );
  assert.equal(
    Object.keys(scripts).filter((key) => key.includes("evaluate-preview")).length,
    1,
    "unexpected preview-script alias",
  );
  assert.equal(
    scripts["harness:plan-usage-backfill"],
    "tsx scripts/plan-harness-usage-backfill.ts",
    "unexpected A5 backfill-plan script value",
  );
  assert.equal(
    Object.keys(scripts).filter((key) => key.includes("usage-backfill")).length,
    1,
    "unexpected backfill-plan script alias",
  );
  assert.equal(
    packageBaselineSha256(packageJson),
    "20cd7ae015277d2b5a0ee0b01f4bcae1e632a082f4f1f02198dab776aad00ca1",
    "unexpected package baseline after deleting the sole preview script",
  );
}

async function assertA4ChangedPathScope(root: string, a3Root: string): Promise<void> {
  const nonA4A5Tracked = gitLines(root, ["ls-files"])
    .filter(
      (path) => !path.startsWith(H_EVAL_DIRECTORY_PREFIX)
        && !(A5_ALLOWED_NON_H_EVAL_PATHS as readonly string[]).includes(path),
    )
    .sort();
  assert.equal(
    nonA4A5Tracked.length,
    NON_A4_A5_TRACKED_PATH_COUNT,
    "unexpected non-A4/A5 tracked path count",
  );
  const aggregate = nonA4A5Tracked
    .map((path) => `${path}\t${contentSha256(join(root, path))}\n`)
    .join("");
  assert.equal(
    createHash("sha256").update(aggregate, "utf8").digest("hex"),
    NON_A4_A5_TRACKED_CONTENT_AGGREGATE_SHA256,
    "unexpected non-A4/A5 tracked content aggregate",
  );
  const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard"]);
  assert.equal(
    untracked.every(
      (path) => (H_EVAL_ALLOWED_PATHS as readonly string[]).includes(path)
        || (A5_ALLOWED_NON_H_EVAL_PATHS as readonly string[]).includes(path),
    ),
    true,
    "unexpected untracked path outside the A3/A4/A5 allowlist",
  );
  const discoveredA5Paths = [
    ...gitLines(root, ["ls-files"]),
    ...untracked,
  ]
    .filter((path) => (A5_ALLOWED_NON_H_EVAL_PATHS as readonly string[]).includes(path))
    .sort();
  assert.deepEqual(discoveredA5Paths, [...A5_ALLOWED_NON_H_EVAL_PATHS].sort());
  assert.deepEqual(
    (await sourceFiles(a3Root)).map((path) => relative(root, path)).sort(),
    [...H_EVAL_ALLOWED_PATHS].sort(),
    "unexpected A4 source path",
  );
  for (const path of A5_NON_ACTIVATION_PRODUCTION_PATHS) {
    const source = await readFile(join(root, path), "utf8");
    assert.doesNotMatch(
      source,
      /(?:loop:worker|worker-phase[12]|createLoopJobQueue|defineLoopJobRegistry|\bLoopJob\b)/,
      path,
    );
  }
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
    canonicalDirectoryEntries(H_EVAL_ALLOWED_PATHS.map((path) => ({ path, kind: "file" as const }))),
    "unexpected A3/A4 directory entry surface",
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

function parsedSourceFile(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, scriptKindFor(fileName));
}

function identifierCount(file: ts.SourceFile, name: string): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === name) count += 1;
    ts.forEachChild(node, visit);
  }
  visit(file);
  return count;
}

function assertNoForbiddenA4RuntimeSurface(fileName: string, source: string): void {
  const file = parsedSourceFile(fileName, source);
  const forbidden = new Set([
    "process", "require", "createRequire", "module", "global", "globalThis", "Deno", "Bun", "eval",
    "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "fetch", "XMLHttpRequest",
    "WebSocket", "EventSource", "Worker", "SharedWorker", "importScripts", "navigator", "console", "Buffer",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask",
  ]);
  const forbiddenProperties = new Set([
    "pipe", "on", "once", "emit", "end", "destroy", "read", "resume", "pause", "setEncoding", "unpipe",
    "constructor",
  ]);
  const findings: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) findings.push(`identifier:${node.text}`);
    if (ts.isPropertyAccessExpression(node) && forbiddenProperties.has(node.name.text)) {
      findings.push(`forbidden_property:${node.name.text}`);
    }
    if (ts.isElementAccessExpression(node) && literalModuleSpecifier(node.argumentExpression) &&
        forbiddenProperties.has(literalModuleSpecifier(node.argumentExpression)!)) {
      findings.push(`forbidden_element:${literalModuleSpecifier(node.argumentExpression)}`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) findings.push("dynamic_import");
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.deepEqual(findings, [], `forbidden A4 runtime surface in ${fileName}`);
}

function assertExactPreviewMainAdapter(source: string): void {
  const file = parsedSourceFile("h-eval-preview-main.ts", source);
  const forbiddenIdentifiers = new Set([
    "require", "createRequire", "module", "global", "globalThis", "Deno", "Bun", "eval", "Function",
    "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "fetch", "XMLHttpRequest", "WebSocket",
    "EventSource", "Worker", "SharedWorker", "importScripts", "navigator", "console", "Buffer", "setTimeout",
    "setInterval", "clearTimeout", "clearInterval", "queueMicrotask",
  ]);
  const forbiddenMainFindings: string[] = [];
  function inspectMainSurface(node: ts.Node): void {
    if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) forbiddenMainFindings.push(node.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      forbiddenMainFindings.push("dynamic_import");
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "constructor") {
      forbiddenMainFindings.push("constructor");
    }
    if (ts.isElementAccessExpression(node) && literalModuleSpecifier(node.argumentExpression) === "constructor") {
      forbiddenMainFindings.push("constructor");
    }
    ts.forEachChild(node, inspectMainSurface);
  }
  inspectMainSurface(file);
  assert.deepEqual(forbiddenMainFindings, [], "preview main must not access ambient loaders or globals");
  assert.equal(file.statements.length, 4, "preview main must contain only its adapter statements");
  const [processStatement, cliStatement, mainStatement, terminalStatement] = file.statements;
  assert.equal(ts.isImportDeclaration(processStatement), true, "preview main must begin with its process import");
  assert.equal(ts.isImportDeclaration(cliStatement), true, "preview main must import its CLI runner second");
  assert.equal(ts.isFunctionDeclaration(mainStatement), true, "preview main must declare one async main function");
  assert.equal(ts.isExpressionStatement(terminalStatement), true, "preview main must terminate with void main()");
  if (!ts.isImportDeclaration(processStatement) || !ts.isImportDeclaration(cliStatement) ||
      !ts.isFunctionDeclaration(mainStatement) || !ts.isExpressionStatement(terminalStatement)) return;

  assert.equal(
    ts.isStringLiteral(processStatement.moduleSpecifier) && processStatement.moduleSpecifier.text === "node:process",
    true,
    "preview main must import process from node:process",
  );
  const processClause = processStatement.importClause;
  assert.equal(
    processClause?.isTypeOnly === false && processClause.name?.text === "process" &&
      processClause.namedBindings === undefined,
    true,
    "preview main must use the process default import only",
  );
  assert.equal(
    ts.isStringLiteral(cliStatement.moduleSpecifier) && cliStatement.moduleSpecifier.text === "./h-eval-preview-cli",
    true,
    "preview main must import its runner from the exact CLI path",
  );
  const cliClause = cliStatement.importClause;
  const cliBinding = cliClause?.namedBindings;
  assert.equal(
    cliClause?.isTypeOnly === false && cliClause.name === undefined && cliBinding && ts.isNamedImports(cliBinding) &&
      cliBinding.elements.length === 1 &&
      cliBinding.elements[0].name.text === "runHEvalPreviewCliV1" &&
      cliBinding.elements[0].propertyName === undefined,
    true,
    "preview main must name-import the CLI runner exactly once",
  );
  assert.equal(identifierCount(file, "process"), 5, "preview main must have one import binding and four process uses");
  assert.equal(identifierCount(file, "runHEvalPreviewCliV1"), 2, "preview main must call its runner exactly once");

  assert.equal(mainStatement.name?.text, "main", "preview main function must be named main");
  assert.equal(mainStatement.modifiers?.length, 1, "preview main function must have only its async modifier");
  assert.equal(mainStatement.modifiers?.[0]?.kind, ts.SyntaxKind.AsyncKeyword, "preview main function must be async");
  assert.equal(mainStatement.parameters.length, 0, "preview main function must not accept capabilities or arguments");
  assert.equal(mainStatement.type?.getText(file), "Promise<void>", "preview main must return Promise<void>");
  const mainBody = mainStatement.body;
  assert.notEqual(mainBody, undefined, "preview main must have a body");
  if (!mainBody) return;
  assert.equal(mainBody.statements.length, 1, "preview main body must contain only its awaited runner assignment");
  const assignmentStatement = mainBody.statements[0];
  assert.equal(ts.isExpressionStatement(assignmentStatement), true, "preview main body must be the runner assignment");
  if (!assignmentStatement || !ts.isExpressionStatement(assignmentStatement) ||
      !ts.isBinaryExpression(assignmentStatement.expression)) return;
  const assignment = assignmentStatement.expression;
  assert.equal(assignment.operatorToken.kind, ts.SyntaxKind.EqualsToken, "preview main must use a simple exitCode assignment");
  assert.equal(
    ts.isPropertyAccessExpression(assignment.left) && ts.isIdentifier(assignment.left.expression) &&
      assignment.left.expression.text === "process" && assignment.left.name.text === "exitCode",
    true,
    "preview main must assign only process.exitCode",
  );
  assert.equal(ts.isAwaitExpression(assignment.right), true, "preview runner assignment must be awaited");
  if (!ts.isAwaitExpression(assignment.right) || !ts.isCallExpression(assignment.right.expression)) return;
  const call = assignment.right.expression;
  assert.equal(ts.isIdentifier(call.expression) && call.expression.text === "runHEvalPreviewCliV1", true);
  assert.equal(call.arguments.length, 1);
  const argument = call.arguments[0];
  assert.equal(ts.isObjectLiteralExpression(argument), true);
  if (!ts.isObjectLiteralExpression(argument)) return;
  const properties = argument.properties.filter(ts.isPropertyAssignment);
  assert.equal(properties.length, argument.properties.length, "preview main argument must contain only property assignments");
  assert.deepEqual(properties.map((property) => property.name.getText(file)), ["args", "input", "output"]);
  const [args, input, output] = properties;
  assert.equal(args.initializer.getText(file), "process.argv.slice(2)");
  assert.equal(input.initializer.getText(file), "process.stdin");
  assert.equal(output.initializer.getText(file), "process.stdout");
  assert.equal(
    ts.isVoidExpression(terminalStatement.expression) && ts.isCallExpression(terminalStatement.expression.expression) &&
      ts.isIdentifier(terminalStatement.expression.expression.expression) &&
      terminalStatement.expression.expression.expression.text === "main" &&
      terminalStatement.expression.expression.arguments.length === 0,
    true,
    "preview main must terminate with the sole void main() invocation",
  );
}

function assertExactPreviewCliShape(source: string): void {
  const file = parsedSourceFile("h-eval-preview-cli.ts", source);
  assert.deepEqual(directStaticSpecifiers("h-eval-preview-cli.ts", source), ["./h-eval-preview-v1"]);
  assertNoForbiddenA4RuntimeSurface("h-eval-preview-cli.ts", source);
  const imports = file.statements.filter(ts.isImportDeclaration);
  assert.equal(imports.length, 1, "preview CLI must have one import");
  const importClause = imports[0]?.importClause;
  const importBindings = importClause?.namedBindings;
  assert.equal(
    importClause?.isTypeOnly === false && importClause.name === undefined && importBindings &&
      ts.isNamedImports(importBindings) && importBindings.elements.length === 1 &&
      importBindings.elements[0].name.text === "runHEvalPreviewV1" && importBindings.elements[0].propertyName === undefined,
    true,
    "preview CLI must use the unaliased named kernel import only",
  );
  let forAwaitCount = 0;
  let kernelCallCount = 0;
  let writerCallCount = 0;
  let canonicalInputLoop = false;
  let canonicalKernelCall = false;
  let canonicalWriterCall = false;
  let writeAccessCount = 0;
  function visit(node: ts.Node): void {
    if (ts.isForOfStatement(node) && node.awaitModifier) {
      forAwaitCount += 1;
      canonicalInputLoop ||= ts.isIdentifier(node.expression) && node.expression.text === "input";
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "runHEvalPreviewV1") {
      kernelCallCount += 1;
      canonicalKernelCall ||= node.arguments.length === 1 && node.arguments[0].getText(file) === "bounded.value";
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "write" && ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "output") {
      writerCallCount += 1;
      assert.equal(node.arguments.length, 2, "preview writer must have exactly line and callback arguments");
      canonicalWriterCall ||= node.arguments.length === 2 && node.arguments[0].getText(file) === "serializedLine" &&
        node.arguments[1].getText(file) === "finish";
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "write") writeAccessCount += 1;
    if (ts.isElementAccessExpression(node) && literalModuleSpecifier(node.argumentExpression) === "write") writeAccessCount += 1;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(forAwaitCount, 1, "preview CLI must have one for-await input scan");
  assert.equal(kernelCallCount, 1, "preview CLI must invoke the kernel once");
  assert.equal(writerCallCount, 1, "preview CLI must invoke one output writer");
  assert.equal(writeAccessCount, 1, "preview CLI must have its sole output writer");
  assert.equal(canonicalInputLoop, true, "preview CLI must iterate only its injected input capability");
  assert.equal(canonicalKernelCall, true, "preview CLI must pass only bounded.value to its kernel");
  assert.equal(canonicalWriterCall, true, "preview CLI must write exactly serializedLine through finish");
  assert.equal(identifierCount(file, "runHEvalPreviewV1"), 2, "preview CLI must call its imported kernel exactly once");

  const reader = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "readBoundedPreviewInputV1");
  const writer = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "writeOnePreviewResultV1");
  assert.notEqual(reader, undefined, "preview input reader must exist");
  assert.notEqual(writer, undefined, "preview writer must exist");
  if (!reader || !writer) return;
  assert.equal(reader.parameters.length, 1, "preview input reader must have one injected capability");
  assert.equal(writer.parameters.length, 2, "preview writer must have only output and result capabilities");
  const [inputParameter] = reader.parameters;
  const [outputParameter, resultParameter] = writer.parameters;
  if (!inputParameter || !outputParameter || !resultParameter) return;
  assert.equal(
    ts.isIdentifier(inputParameter.name) && inputParameter.name.text === "input" &&
      inputParameter.dotDotDotToken === undefined && inputParameter.questionToken === undefined &&
      inputParameter.initializer === undefined,
    true,
    "preview reader must receive only its input capability",
  );
  assert.equal(
    ts.isIdentifier(outputParameter.name) && outputParameter.name.text === "output" &&
      ts.isIdentifier(resultParameter.name) && resultParameter.name.text === "result" &&
      writer.parameters.every((parameter) => parameter.dotDotDotToken === undefined &&
        parameter.questionToken === undefined && parameter.initializer === undefined),
    true,
    "preview writer must receive only output and result capabilities",
  );
  if (reader?.body) {
    let inputUses = 0;
    function countInput(node: ts.Node): void {
      if (ts.isIdentifier(node) && node.text === "input") inputUses += 1;
      ts.forEachChild(node, countInput);
    }
    countInput(reader.body);
    assert.equal(inputUses, 1, "preview reader must use input only as the for-await iterable");
  }
  if (writer?.body) {
    let outputUses = 0;
    function countOutput(node: ts.Node): void {
      if (ts.isIdentifier(node) && node.text === "output") outputUses += 1;
      ts.forEachChild(node, countOutput);
    }
    countOutput(writer.body);
    assert.equal(outputUses, 1, "preview writer must use output only for its one direct write");
  }
}

function assertExactPreviewKernelFlow(source: string): void {
  const file = parsedSourceFile("h-eval-preview-v1.ts", source);
  assert.deepEqual(
    directStaticSpecifiers("h-eval-preview-v1.ts", source),
    ["./h-eval-job-contract-v1", "./h-eval-policy-v1"],
  );
  assertNoForbiddenA4RuntimeSurface("h-eval-preview-v1.ts", source);
  const calls = new Map<string, ts.CallExpression[]>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        ["createHEvalSchedulePayloadV1", "evaluateHEvalPolicyV1", "fenceAndProjectHEvalPolicyResultV1"].includes(node.expression.text)) {
      const existing = calls.get(node.expression.text) ?? [];
      existing.push(node);
      calls.set(node.expression.text, existing);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const scheduleCall = calls.get("createHEvalSchedulePayloadV1");
  const evaluatorCall = calls.get("evaluateHEvalPolicyV1");
  const fenceCall = calls.get("fenceAndProjectHEvalPolicyResultV1");
  assert.equal(scheduleCall?.length, 1, "preview kernel must call the schedule validator once");
  assert.equal(evaluatorCall?.length, 1, "preview kernel must call the evaluator once");
  assert.equal(fenceCall?.length, 1, "preview kernel must call its fence once");
  if (!scheduleCall || !evaluatorCall || !fenceCall) return;
  assert.equal(scheduleCall[0].arguments.length, 1);
  assert.equal(scheduleCall[0].arguments[0].getText(file), "jobIdentity");
  assert.equal(evaluatorCall[0].arguments.length, 1);
  assert.equal(evaluatorCall[0].arguments[0].getText(file), "evidence");
  assert.equal(fenceCall[0].arguments.length, 2);
  assert.equal(fenceCall[0].arguments[0].getText(file), "scheduled.payload");
  assert.equal(fenceCall[0].arguments[1].getText(file), "policyResult");
}

async function assertOrdinaryFixtureDirectory(path: string): Promise<void> {
  const state = await lstat(path);
  assert.equal(state.isDirectory() && !state.isSymbolicLink(), true, `fixture directory must be ordinary: ${path}`);
}

async function assertFixtureDestinationAbsent(path: string): Promise<void> {
  await assert.rejects(lstat(path), { code: "ENOENT" });
}

async function assertFixturePreflight(
  root: string,
  source: string,
  destination: string,
  expectedSourceHash: string,
): Promise<void> {
  await assertOrdinaryFixtureDirectory(root);
  await assertOrdinaryFixtureDirectory(source);
  await assertOrdinaryFixtureDirectory(dirname(destination));
  assert.equal(
    createHash("sha256").update(await readFile(join(source, "runtime.txt"))).digest("hex"),
    expectedSourceHash,
    "fixture source fingerprint drift",
  );
  await assertFixtureDestinationAbsent(destination);
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
    await assertA4ChangedPathScope(root, a3Root);
    await assertExactA3DirectoryEntries(root, a3Root);
    assert.throws(
      () => assertExactA3DirectoryEntrySurface([
        ...H_EVAL_ALLOWED_PATHS.map((path) => ({ path, kind: "file" as const })),
        { path: "src/lib/loop-jobs/harness-evaluation/README.md", kind: "file" as const },
      ]),
      /unexpected A3\/A4 directory entry surface/,
    );

    assertExactPreviewPackageException(await readFile(join(root, "package.json")));

    const workerPhase2 = await readFile(join(sourceRoot, "lib/loop-jobs/worker-phase2.ts"), "utf8");
    assert.match(workerPhase2, /const productionRegistry = defineLoopJobRegistry\(\{\}\);/);
    assert.match(workerPhase2, /handlers: \{\}/);

    await assertExternalRuntimeEdgesFailClosed(root, sourceRoot, a3Root);
  });
});

test("A4-CG7-T1 A3-A4-coexistence-and-dormancy-boundaries", async (t) => {
  const root = process.cwd();
  const a4Root = join(root, "src/lib/loop-jobs/harness-evaluation");

  await t.test("pins every immutable A3 production and policy-test byte surface", async () => {
    for (const [fileName, expectedSha256] of Object.entries(A3_PRODUCTION_SOURCE_SHA256)) {
      assertExactA3ProductionByteSurface(fileName, await readFile(join(a4Root, fileName)), expectedSha256);
    }
    for (const [fileName, expectedSha256] of Object.entries(A3_IMMUTABLE_POLICY_TEST_SHA256)) {
      assertExactA3ProductionByteSurface(fileName, await readFile(join(a4Root, fileName)), expectedSha256);
    }
    assert.throws(
      () => assertExactA3ProductionByteSurface("one-byte-mutation.ts", Buffer.from("x"),
        A3_PRODUCTION_SOURCE_SHA256["h-eval-policy-v1.ts"]),
      /unexpected A3 production byte surface/,
    );
  });

  await t.test("keeps the A4 graph manual, narrow, and free of runtime activation surfaces", async () => {
    const previewKernel = await readFile(join(a4Root, "h-eval-preview-v1.ts"), "utf8");
    const previewCli = await readFile(join(a4Root, "h-eval-preview-cli.ts"), "utf8");
    const previewMain = await readFile(join(a4Root, "h-eval-preview-main.ts"), "utf8");
    assertExactPreviewKernelFlow(previewKernel);
    assertExactPreviewCliShape(previewCli);
    assertExactPreviewMainAdapter(previewMain);
  });

  await t.test("rejects computed loaders, A4 activation edges, and non-canonical main or CLI shapes", async () => {
    const previewCli = await readFile(join(a4Root, "h-eval-preview-cli.ts"), "utf8");
    const previewMain = await readFile(join(a4Root, "h-eval-preview-main.ts"), "utf8");
    assert.throws(
      () => assertExactPreviewCliShape(previewCli.replace("for await (const chunk of input)", "input.pipe(output);\n    for await (const chunk of input)")),
      /forbidden A4 runtime surface/,
    );
    assert.throws(
      () => assertExactPreviewCliShape(previewCli.replace("for await (const chunk of input)", "output.pipe(input);\n    for await (const chunk of input)")),
      /forbidden A4 runtime surface/,
    );
    assert.throws(
      () => assertExactPreviewCliShape(previewCli.replace("output.write(serializedLine, finish)", "output.write(input as unknown as string, finish)")),
      /serializedLine through finish/,
    );
    assert.throws(
      () => assertExactPreviewCliShape(`${previewCli}\nvoid import(target);`),
      /forbidden A4 runtime surface/,
    );
    assert.throws(
      () => assertExactPreviewCliShape(previewCli.replace(
        'import { runHEvalPreviewV1 } from "./h-eval-preview-v1";',
        'import unused, { runHEvalPreviewV1 } from "./h-eval-preview-v1";',
      )),
      /unaliased named kernel import only/,
    );
    assert.throws(
      () => assertExactPreviewCliShape(`${previewCli}\nconst unusedSink = { write() {} }; unusedSink.write();`),
      /sole output writer/,
    );
    for (const forbiddenCliSuffix of ["console.log(\"x\");", "void process.env;", "void Buffer;", "require(target);"]) {
      assert.throws(
        () => assertExactPreviewCliShape(`${previewCli}\n${forbiddenCliSuffix}`),
        /forbidden A4 runtime surface/,
      );
    }
    assert.throws(
      () => assertExactPreviewMainAdapter(previewMain.replace("process.stdout", "process.stderr")),
      /process.stdout/,
    );
    assert.throws(
      () => assertExactPreviewMainAdapter(previewMain.replace(
        'import process from "node:process";',
        'import process, { nextTick } from "node:process";',
      )),
      /default import only/,
    );
    assert.throws(
      () => assertExactPreviewMainAdapter(previewMain.replace(
        "  process.exitCode",
        "  void setTimeout;\n  process.exitCode",
      )),
      /ambient loaders or globals|main body must contain only its awaited runner assignment/,
    );
    assert.throws(
      () => assertExactPreviewMainAdapter(`${previewMain}\nvoid process.env;`),
      /adapter statements|four process uses/,
    );
    assert.throws(
      () => assertExactPreviewMainAdapter(`${previewMain}\nvoid globalThis["process"];`),
      /ambient loaders or globals/,
    );
    for (const malformedArgExpression of ["process.argv", "process.argv.slice(1)", "process.argv.slice(2, 3)"]) {
      assert.throws(
        () => assertExactPreviewMainAdapter(previewMain.replace("process.argv.slice(2)", malformedArgExpression)),
        /process.argv.slice\(2\)/,
      );
    }

    const fixtureImporter = join(root, "scripts", "a4-negative-edge-fixture.mjs");
    for (const source of [
      "void import(target);",
      "require(target);",
      "const loader = require; loader(target);",
      "const factory = createRequire; const loader = factory(import.meta.url); loader(target);",
      "module.require(target);",
      "globalThis[key](target);",
      "const loader = globalThis[key]; loader(target);",
      "const { [key]: loader } = globalThis; loader(target);",
      "const loader = (0, globalThis[key]); loader(target);",
      "Reflect.apply(globalThis[key], undefined, [target]);",
    ]) {
      assert.throws(
        () => assertComputedRuntimeEdgesFailClosed(root, a4Root, fixtureImporter, "scripts/a4-negative-edge-fixture.mjs", source),
        /unexpected computed runtime edge/,
      );
    }

    const literalA4Edge = runtimeModuleEdges(
      fixtureImporter,
      'import "@/lib/loop-jobs/harness-evaluation/h-eval-preview-v1";',
    )[0];
    assert.equal(literalA4Edge.computed, false);
    if (literalA4Edge.computed || literalA4Edge.specifier === undefined) return;
    const literalEdge: LiteralRuntimeModuleEdge = {
      kind: literalA4Edge.kind,
      specifier: literalA4Edge.specifier,
      computed: false,
    };
    assert.throws(
      () => classifyLiteralExternalRuntimeEdge(
        root,
        a4Root,
        runtimeCompilerOptions(root),
        fixtureImporter,
        "scripts/a4-negative-edge-fixture.mjs",
        literalEdge,
      ),
      /resolves into A4/,
    );
  });

  await t.test("rejects duplicate package JSON members before its one semantic parse", () => {
    const duplicateFixtures = [
      Buffer.from('{"scripts":{},"scripts":{}}', "utf8"),
      Buffer.from('{"scr\\u0069pts":{},"scripts":{}}', "utf8"),
      Buffer.from('{"scripts":{"harness:evaluate-preview":"x","harness:evaluate-preview":"y"}}', "utf8"),
      Buffer.from('{"scripts":{"harness:evaluate-preview":"x","harness:evaluate-pre\\u0076iew":"y"}}', "utf8"),
      Buffer.from('{"scripts":{},"nested":{"x":1,"x":2}}', "utf8"),
      Buffer.from('{"scripts":{},"items":[{"x":1,"x":2}]}', "utf8"),
    ];
    for (const raw of duplicateFixtures) {
      let parseCount = 0;
      assert.throws(() => parseUniquePackageJsonV1(raw, (text) => {
        parseCount += 1;
        return JSON.parse(text);
      }), /duplicate JSON member/);
      assert.equal(parseCount, 0);
    }

    const escaped = duplicateFixtures[1];
    const escapeOffset = escaped.indexOf(Buffer.from("\\u", "utf8"));
    assert.equal(escapeOffset >= 0, true);
    assert.equal(escaped[escapeOffset], 0x5c);
    assert.equal(escaped[escapeOffset + 1], 0x75);

    for (const raw of [
      Buffer.from('{"scripts":{"literal":"{\\"x\\":1,\\"x\\":2}"}}', "utf8"),
      Buffer.from('{"one":{"x":1},"two":{"x":2},"scripts":{}}', "utf8"),
    ]) {
      let parseCount = 0;
      assert.doesNotThrow(() => parseUniquePackageJsonV1(raw, (text) => {
        parseCount += 1;
        return JSON.parse(text);
      }));
      assert.equal(parseCount, 1);
    }

    const lastWins = Buffer.from(
      '{"scripts":{"harness:evaluate-preview":"bad"},"scripts":{"harness:evaluate-preview":"good"}}',
      "utf8",
    );
    assert.equal((JSON.parse(lastWins.toString("utf8")) as { scripts: Record<string, string> }).scripts["harness:evaluate-preview"], "good");
    let lastWinsParseCount = 0;
    assert.throws(() => parseUniquePackageJsonV1(lastWins, (text) => {
      lastWinsParseCount += 1;
      return JSON.parse(text);
    }), /duplicate JSON member/);
    assert.equal(lastWinsParseCount, 0);

    const malformedMinus = Buffer.from('{"scripts":{},"malformed":-}', "utf8");
    let malformedMinusParseCount = 0;
    assert.throws(() => parseUniquePackageJsonV1(malformedMinus, (text) => {
      malformedMinusParseCount += 1;
      return JSON.parse(text);
    }), /invalid JSON number/);
    assert.equal(malformedMinusParseCount, 0);

    const trailingArgument = Buffer.from(
      (readFileSync(join(root, "package.json"), "utf8")).replace(
        "tsx src/lib/loop-jobs/harness-evaluation/h-eval-preview-main.ts",
        "tsx src/lib/loop-jobs/harness-evaluation/h-eval-preview-main.ts --",
      ),
      "utf8",
    );
    assert.throws(() => assertExactPreviewPackageException(trailingArgument), /unexpected preview script value/);
    assert.throws(
      () => parseUniquePackageJsonV1(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), JSON.parse),
      /BOM/,
    );
    assertExactPreviewPackageException(readFileSync(join(root, "package.json")));
  });

  await t.test("proves the disposable local-link preflight fails closed before a link mutation", async (subtest) => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "a4-preflight-"));
    subtest.after(async () => {
      await rm(fixtureRoot, { recursive: true, force: true });
    });
    const source = join(fixtureRoot, "source");
    const destinations = join(fixtureRoot, "destinations");
    const destination = join(destinations, "runtime");
    await mkdir(source);
    await mkdir(destinations);
    await writeFile(join(source, "runtime.txt"), "first", "utf8");
    const expectedHash = createHash("sha256").update("first", "utf8").digest("hex");
    await assertFixturePreflight(fixtureRoot, source, destination, expectedHash);

    await writeFile(join(source, "runtime.txt"), "changed", "utf8");
    await assert.rejects(
      assertFixturePreflight(fixtureRoot, source, destination, expectedHash),
      /fixture source fingerprint drift/,
    );
    await assertFixtureDestinationAbsent(destination);

    const realAncestor = join(fixtureRoot, "real-ancestor");
    const symlinkedAncestor = join(fixtureRoot, "symlinked-ancestor");
    await mkdir(realAncestor);
    await symlink(realAncestor, symlinkedAncestor, "dir");
    await assert.rejects(
      assertFixturePreflight(fixtureRoot, source, join(symlinkedAncestor, "runtime"),
        createHash("sha256").update("changed", "utf8").digest("hex")),
      /fixture directory must be ordinary/,
    );
    await assertFixtureDestinationAbsent(join(realAncestor, "runtime"));

    await mkdir(destination);
    await assert.rejects(symlink(source, destination, "dir"), { code: "EEXIST" });
    assert.equal((await lstat(destination)).isDirectory(), true);
    await assertFixtureDestinationAbsent(join(destination, "source"));
  });
});
