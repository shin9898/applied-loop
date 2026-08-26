import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1,
  assessHCycleActivationReadinessV1,
  type HCycleActivationReadinessInputV1,
} from "./h-cycle-activation-readiness-v1";

type AuthorityLikeInputKey = Extract<
  keyof HCycleActivationReadinessInputV1,
  "authorization" | "approvalState" | "operatorIdentity"
>;

const inputTypeHasNoAuthorityField: AuthorityLikeInputKey extends never ? true : never = true;

const completeInput: HCycleActivationReadinessInputV1 = {
  schema: "h_cycle_activation_readiness_v1",
  targetDatabaseBinding: "externally_attested",
  schedulerBinding: "externally_attested",
  activationFloorWeekKey: "2026-W33",
  disableUninstallEvidence: "accepted",
  workerOperationalEvidence: "accepted",
  manualObservationEvidence: "at_least_two_observed",
};

const incompleteInput: HCycleActivationReadinessInputV1 = {
  schema: "h_cycle_activation_readiness_v1",
  targetDatabaseBinding: "missing",
  schedulerBinding: "missing",
  activationFloorWeekKey: null,
  disableUninstallEvidence: "missing",
  workerOperationalEvidence: "missing",
  manualObservationEvidence: "none",
};

const invalidOffResult = {
  ok: false,
  featureState: "off",
  code: "invalid_activation_readiness_input",
} as const;

test("A8C0-CG1-T1 closed feature-off input boundary", () => {
  assert.equal(inputTypeHasNoAuthorityField, true);

  let getterCalls = 0;
  const accessorInput = { ...completeInput } as Record<string, unknown>;
  Object.defineProperty(accessorInput, "targetDatabaseBinding", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "getter-value-must-not-be-read";
    },
  });
  const symbolInput = { ...completeInput };
  const symbolSentinel = Symbol("symbol-key-must-not-be-ignored");
  Object.defineProperty(symbolInput, symbolSentinel, {
    enumerable: true,
    value: "symbol-value-must-not-be-echoed",
  });
  const poisonedPrototypeInput = Object.assign(
    Object.create({ poisoned: "prototype-value-must-not-be-read" }) as Record<string, unknown>,
    completeInput,
  );
  const throwingGetPrototypeOfInput = new Proxy({ ...completeInput }, {
    getPrototypeOf() {
      throw new Error("getPrototypeOf-trap-must-not-be-echoed");
    },
  });
  const throwingOwnKeysInput = new Proxy({ ...completeInput }, {
    ownKeys() {
      throw new Error("ownKeys-trap-must-not-be-echoed");
    },
  });
  const throwingDescriptorInput = new Proxy({ ...completeInput }, {
    getOwnPropertyDescriptor() {
      throw new Error("descriptor-trap-must-not-be-echoed");
    },
  });

  const cases: ReadonlyArray<
    Readonly<{
      label: string;
      input: unknown;
      validity: "valid" | "invalid";
      sentinels?: readonly string[];
    }>
  > = [
    { label: "complete closed attestation", input: completeInput, validity: "valid" },
    { label: "incomplete closed attestation", input: incompleteInput, validity: "valid" },
    { label: "non-object", input: null, validity: "invalid" },
    { label: "array", input: [], validity: "invalid" },
    {
      label: "malformed JST ISO week",
      input: { ...completeInput, activationFloorWeekKey: "2026-W54" },
      validity: "invalid",
    },
    {
      label: "authorization field",
      input: { ...completeInput, authorization: "operator-approved-do-not-echo" },
      validity: "invalid",
    },
    {
      label: "approval state field",
      input: { ...completeInput, approvalState: "approved-do-not-echo" },
      validity: "invalid",
    },
    {
      label: "operator identity field",
      input: { ...completeInput, operatorIdentity: "operator-secret-do-not-echo" },
      validity: "invalid",
    },
    {
      label: "authorization-looking allowed-field value",
      input: { ...completeInput, targetDatabaseBinding: "authorized" },
      validity: "invalid",
    },
    {
      label: "accessor without getter invocation",
      input: accessorInput,
      validity: "invalid",
      sentinels: ["getter-value-must-not-be-read"],
    },
    {
      label: "symbol key",
      input: symbolInput,
      validity: "invalid",
      sentinels: [symbolSentinel.description ?? "", "symbol-value-must-not-be-echoed"],
    },
    {
      label: "poisoned nonordinary prototype",
      input: poisonedPrototypeInput,
      validity: "invalid",
      sentinels: ["prototype-value-must-not-be-read"],
    },
    {
      label: "throwing getPrototypeOf Proxy",
      input: throwingGetPrototypeOfInput,
      validity: "invalid",
      sentinels: ["getPrototypeOf-trap-must-not-be-echoed"],
    },
    {
      label: "throwing ownKeys Proxy",
      input: throwingOwnKeysInput,
      validity: "invalid",
      sentinels: ["ownKeys-trap-must-not-be-echoed"],
    },
    {
      label: "throwing getOwnPropertyDescriptor Proxy",
      input: throwingDescriptorInput,
      validity: "invalid",
      sentinels: ["descriptor-trap-must-not-be-echoed"],
    },
    {
      label: "URL detail",
      input: { ...completeInput, detail: "https://example.invalid/readiness?token=url-must-not-be-echoed" },
      validity: "invalid",
      sentinels: ["https://example.invalid/readiness?token=url-must-not-be-echoed"],
    },
    {
      label: "filesystem path detail",
      input: { ...completeInput, detail: "/Users/operator/private/readiness-path-must-not-be-echoed" },
      validity: "invalid",
      sentinels: ["/Users/operator/private/readiness-path-must-not-be-echoed"],
    },
    {
      label: "scheduler plist identifier detail",
      input: { ...completeInput, detail: "com.applied-loop.h-cycle-secret.plist" },
      validity: "invalid",
      sentinels: ["com.applied-loop.h-cycle-secret.plist"],
    },
    {
      label: "secret detail",
      input: { ...completeInput, detail: "sk-live-secret-must-not-be-echoed" },
      validity: "invalid",
      sentinels: ["sk-live-secret-must-not-be-echoed"],
    },
    {
      label: "command detail",
      input: { ...completeInput, detail: "launchctl bootstrap gui/501 command-must-not-be-echoed" },
      validity: "invalid",
      sentinels: ["launchctl bootstrap gui/501 command-must-not-be-echoed"],
    },
  ];

  for (const entry of cases) {
    const result = assessHCycleActivationReadinessV1(entry.input);
    assert.equal(result.featureState, "off", entry.label);
    if (entry.validity === "valid") {
      assert.equal(result.ok, true, entry.label);
    } else {
      assert.deepEqual(result, invalidOffResult, entry.label);
      assert.equal(Object.isFrozen(result), true, entry.label);
      const serializedResult = JSON.stringify(result);
      for (const sentinel of entry.sentinels ?? []) {
        assert.equal(serializedResult.includes(sentinel), false, `${entry.label}: ${sentinel}`);
      }
    }
  }
  assert.equal(getterCalls, 0, "accessor getter must not be invoked");
});

test("A8C0-CG2-T1 readiness blocker order and fixed schedule metadata", () => {
  const expectedScheduleIntent = {
    version: "h_cycle_weekly_monday_0815_jst_v1",
    timeZone: "Asia/Tokyo",
    cadence: "weekly",
    weekday: "monday",
    localTime: "08:15",
    onTimeGraceMinutes: 5,
    maxEnqueuePerScan: 1,
  } as const;
  const oneObservationInput: HCycleActivationReadinessInputV1 = {
    ...completeInput,
    activationFloorWeekKey: "9876-W01",
    manualObservationEvidence: "one_observed",
  };

  const oneObservationResult = assessHCycleActivationReadinessV1(oneObservationInput);
  assert.deepEqual(oneObservationResult, {
    ok: true,
    schema: "h_cycle_activation_readiness_v1",
    featureState: "off",
    technicalReadiness: "blocked",
    scheduleIntent: expectedScheduleIntent,
    blockers: ["manual_observation_evidence_missing"],
  });

  const allMissingResult = assessHCycleActivationReadinessV1(incompleteInput);
  assert.deepEqual(allMissingResult, {
    ok: true,
    schema: "h_cycle_activation_readiness_v1",
    featureState: "off",
    technicalReadiness: "blocked",
    scheduleIntent: expectedScheduleIntent,
    blockers: [
      "target_database_binding_missing",
      "scheduler_binding_missing",
      "activation_floor_missing",
      "disable_uninstall_evidence_missing",
      "worker_operational_evidence_missing",
      "manual_observation_evidence_missing",
    ],
  });

  const completeResult = assessHCycleActivationReadinessV1(completeInput);
  assert.deepEqual(completeResult, {
    ok: true,
    schema: "h_cycle_activation_readiness_v1",
    featureState: "off",
    technicalReadiness: "attested",
    scheduleIntent: expectedScheduleIntent,
    blockers: [],
  });

  const assertDeeplyFrozen = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true);
    for (const nestedValue of Object.values(value)) assertDeeplyFrozen(nestedValue);
  };
  assert.deepEqual(H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1, expectedScheduleIntent);
  assertDeeplyFrozen(H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1);
  assertDeeplyFrozen(oneObservationResult);
  assertDeeplyFrozen(allMissingResult);
  assertDeeplyFrozen(completeResult);

  const serializedResult = JSON.stringify(oneObservationResult);
  for (const sentinel of ["9876-W01", "one_observed", "externally_attested", "accepted"]) {
    assert.equal(serializedResult.includes(sentinel), false, sentinel);
  }
});

test("A8C0-CG3-T1 non-activation surface fence", () => {
  const root = process.cwd();
  const readinessPath = "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts";
  const lines = (args: readonly string[]): string[] => execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);

  const expectedChangedPaths = [
    "docs/adr/0032-h-cycle-activation-readiness-contract.md",
    "src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts",
    "src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts",
  ].sort();
  const introductionCommit = lines([
    "log",
    "--diff-filter=A",
    "-1",
    "--format=%H",
    "--",
    readinessPath,
  ])[0];
  if (introductionCommit === undefined) {
    const changedPaths = [
      ...lines(["diff", "--name-only", "HEAD"]),
      ...lines(["ls-files", "--others", "--exclude-standard"]),
    ].sort();
    assert.deepEqual(changedPaths, expectedChangedPaths, "A8-C0 historical guard paths must both be classified");
  } else {
    const introductionPaths = lines([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      introductionCommit,
    ]).sort();
    if (introductionPaths.length > 0) {
      assert.deepEqual(introductionPaths, expectedChangedPaths, "A8-C0 historical guard paths must both be classified");
    } else {
      // actions/checkout uses a depth-1 synthetic PR merge commit. It has no
      // parent object, so diff-tree cannot expose the introduction paths.
      // Keep the provenance check strict in full history; in this CI-only
      // shape, prove the tree is clean and let the exact literal allowlists
      // below classify the frozen five paths.
      assert.equal(lines(["rev-parse", "--is-shallow-repository"])[0], "true");
      assert.deepEqual(lines(["show", "-s", "--format=%P", introductionCommit]), []);
      assert.deepEqual(lines(["status", "--porcelain"]), []);
      assert.deepEqual(expectedChangedPaths.filter((path) => lines([
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "--",
        path,
      ]).includes(path)), expectedChangedPaths);
    }
  }

  const parse = (path: string): ts.SourceFile => ts.createSourceFile(
    path,
    readFileSync(join(root, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const readinessFile = parse(readinessPath);
  const publicSymbols: string[] = [];
  const prohibitedModuleEdges: string[] = [];
  for (const statement of readinessFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      prohibitedModuleEdges.push(ts.SyntaxKind[statement.kind]);
    }
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      prohibitedModuleEdges.push(ts.SyntaxKind[statement.kind]);
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    assert.equal(
      modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
      false,
      "readiness module must not default-export",
    );
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        assert.equal(ts.isIdentifier(declaration.name), true, "exported binding must have a closed identifier");
        if (ts.isIdentifier(declaration.name)) publicSymbols.push(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      && statement.name !== undefined
    ) {
      publicSymbols.push(statement.name.text);
    } else {
      assert.fail(`unexpected readiness export kind ${ts.SyntaxKind[statement.kind]}`);
    }
  }
  assert.deepEqual(publicSymbols.sort(), [
    "HCycleActivationReadinessInputV1",
    "HCycleActivationReadinessResultV1",
    "H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1",
    "assessHCycleActivationReadinessV1",
  ].sort());
  assert.deepEqual(prohibitedModuleEdges, [], "readiness module must have no import, re-export, or default edge");

  const forbiddenRuntimeIdentifiers = new Set([
    "AsyncFunction",
    "Bun",
    "DATABASE_URL",
    "Deno",
    "Function",
    "PrismaBetterSqlite3",
    "PrismaClient",
    "WebSocket",
    "XMLHttpRequest",
    "buildHCycleEvidencePreviewV1",
    "clock",
    "createHCycleEvaluateDormantHandlerV1",
    "createLoopJobQueue",
    "createReadonlyHCycleEvidencePreviewClient",
    "createRequire",
    "database",
    "db",
    "deriveHCycleEvaluateTimingV1",
    "dispatch",
    "enqueue",
    "eval",
    "fetch",
    "global",
    "globalThis",
    "indexedDB",
    "module",
    "performance",
    "planHCycleEvaluateV1",
    "process",
    "queryHCycleEvidencePreviewSnapshotV1",
    "queryReadonlyHCycleEvidencePreviewSnapshotV1",
    "queueMicrotask",
    "require",
    "runHCycleEvidencePreviewCli",
    "runOneDelivery",
    "runOneShotWorker",
    "scheduler",
    "setInterval",
    "setTimeout",
  ]);
  const forbiddenRuntimeFindings: string[] = [];
  const visitReadiness = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && forbiddenRuntimeIdentifiers.has(node.text)) {
      forbiddenRuntimeFindings.push(node.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      forbiddenRuntimeFindings.push("dynamic import");
    }
    if (ts.isMetaProperty(node)) forbiddenRuntimeFindings.push(node.getText(readinessFile));
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node))
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Date"
      && (node.arguments?.length ?? 0) === 0
    ) {
      forbiddenRuntimeFindings.push("ambient Date clock");
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(readinessFile) === "Date"
      && node.expression.name.text === "now"
    ) {
      forbiddenRuntimeFindings.push("Date.now clock");
    }
    ts.forEachChild(node, visitReadiness);
  };
  visitReadiness(readinessFile);
  assert.deepEqual(forbiddenRuntimeFindings, [], "readiness module must remain capability-free");

  const literalArray = (file: ts.SourceFile, bindingName: string): string[] => {
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== bindingName) continue;
        const initializer = declaration.initializer;
        assert.ok(initializer && ts.isAsExpression(initializer));
        assert.ok(ts.isArrayLiteralExpression(initializer.expression));
        return initializer.expression.elements.map((element) => {
          assert.equal(ts.isStringLiteral(element), true, `${bindingName} must contain literal paths only`);
          return ts.isStringLiteral(element) ? element.text : "";
        });
      }
    }
    assert.fail(`missing ${bindingName}`);
  };
  assert.deepEqual(literalArray(
    parse("src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts"),
    "A8C0_ALLOWED_SRC_PATHS",
  ), expectedChangedPaths.filter((path) => path.startsWith("src/")));
  assert.deepEqual(literalArray(
    parse("src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts"),
    "A8C0_ALLOWED_NON_H_EVAL_PATHS",
  ), expectedChangedPaths.filter(
    (path) => !path.startsWith("src/lib/loop-jobs/harness-evaluation/"),
  ));

  const workerFile = parse("src/lib/loop-jobs/worker-phase2.ts");
  const emptyRegistryArguments: number[] = [];
  const emptyHandlerProperties: number[] = [];
  const visitWorker = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "productionRegistry"
      && node.initializer !== undefined
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "defineLoopJobRegistry"
    ) {
      const argument = node.initializer.arguments[0];
      assert.ok(argument && ts.isObjectLiteralExpression(argument));
      emptyRegistryArguments.push(argument.properties.length);
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(workerFile) === "handlers") {
      assert.equal(ts.isObjectLiteralExpression(node.initializer), true);
      if (ts.isObjectLiteralExpression(node.initializer)) emptyHandlerProperties.push(node.initializer.properties.length);
    }
    ts.forEachChild(node, visitWorker);
  };
  visitWorker(workerFile);
  assert.deepEqual(emptyRegistryArguments, [0], "production registry must remain exactly empty");
  assert.deepEqual(emptyHandlerProperties, [0], "production handlers must remain exactly empty");

  const immutableSurfaceSha256: Readonly<Record<string, string>> = {
    "docs/adr/0028-h-cycle-manual-preview.md": "eba902c852bf8e9f0bef9039a20366119391e8ae0ba5f315ed3e93205af66b06",
    "package.json": "db5c73d6dc61b2aea263f44eb5edad13cbf245c02e7edfa712eb768e1475d000",
    "scripts/com.applied-loop.dev.plist": "56e77066a353bec5c27eaa4bc8eec1f090c87741a74016b13701654c5ddbf432",
    "scripts/com.applied-loop.harness-collect.plist": "8034650241edde128eb4bb6e99f6e5e8ed3afa9b4b7cfd0f561269bd130e75a1",
    "scripts/com.applied-loop.weekly-textbook.plist": "33dcbce39fef4d4698c611eae2b9b4a65e16e28d62a40606a87d9af9d2083824",
    "scripts/preview-h-cycle-evidence.ts": "d03552e9458caf8cf3a26f562c5747c31fcbc29ee21bb2d6742ea8ed4c3b0c7d",
    "src/lib/h-cycle-evidence-adapter.test.ts": "708f84f0a487a0c9356c2ffa8c1ac5cff374cce1519a4fe191b4b4826e525342",
    "src/lib/h-cycle-evidence-adapter.ts": "c8cdbd118a580526d5906e8e7737e99d825ed1ead979ad853f99712f77870762",
    "src/lib/h-cycle-evidence-preview-query.ts": "c5be617f652a186c7076867ad24b05fe5b35a195c7e5f5d0783d4a7ca5d76b3e",
    "src/lib/h-cycle-evidence-preview.test.ts": "ae95a9c6a2f7189985b39b683ee51eef0cbc1fb04242945bdb98b146360fe298",
    "src/lib/h-cycle-evidence-preview.ts": "3257b9c0954befd86d3b410c366974a87dfe43ffa88aafab3f2a38289e96b47f",
    "src/lib/loop-jobs/delivery-no-echo-helper.ts": "e40df38bee18b316dd2b8d98a60f1a9233393a71efb9135d114dc6771ec1b6eb",
    "src/lib/loop-jobs/delivery.ts": "4062126950275118d7ee2d5f772e9a05926c2fda67ec8e48d94142ad3e80bc67",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.test.ts": "cbb3323e8c68385e85c5239fa36b952cd0573c0f3b94fdc321f05511876dbb51",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.ts": "dd0cba88d498d95adb51d5efbcae46eeffeaf32b0073c130b74ee40caac7440f",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.ts": "f2429180b8286a98425b25ce8772206ab129f80c5bfe865795fb72c2a8468dbc",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.test.ts": "cbab8cf5f96f5a5ffc8b837db57c2f65e76201f044c54ed21f006c186ba563e7",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts": "a7f542b0101df367cca7dcfc7f90321d15c885b8bae4f8ed9a33899b6da86d51",
    "src/lib/loop-jobs/state-machine.ts": "b682d057d2c7617434229cba0eb5cad555cbc07fcba4071b930a546b4ab73001",
    "src/lib/loop-jobs/worker-phase1.mjs": "89cfc559cb1b386d3adf504be5322d317caf076abd6c1dadf16f1d87c4d667d4",
    "src/lib/loop-jobs/worker-phase2.ts": "9569be398c439eccac6bfbae86677a1f6d61211ee11a7b4d592f5622490c778d",
    "src/lib/loop-jobs/worker.mjs": "25a09e3c904ef4feb85839ef1821209432d14842665cf36cd197d7bdbd1a6e49",
  };
  const sha256 = (path: string): string => createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");
  const a8c2Snippets: Readonly<Record<string, ReadonlyArray<Readonly<{
    begin: string;
    end: string;
    leading: string;
    trailing: string;
  }>>>> = {
    "src/lib/loop-jobs/state-machine.ts": [
      {
        begin: "// A8-C2 BEGIN: single-kind raw claim import",
        end: "// A8-C2 END: single-kind raw claim import",
        leading: "",
        trailing: "\n\n",
      },
      {
        begin: "    // A8-C2 BEGIN: queue claimKind method",
        end: "    // A8-C2 END: queue claimKind method",
        leading: "",
        trailing: "\n\n",
      },
    ],
    "src/lib/loop-jobs/delivery.ts": [
      {
        begin: "// A8-C2 BEGIN: scoped capability snapshot helpers",
        end: "// A8-C2 END: scoped capability snapshot helpers",
        leading: "",
        trailing: "\n\n",
      },
      {
        begin: "// A8-C2 BEGIN: runOneKindDelivery",
        end: "// A8-C2 END: runOneKindDelivery",
        leading: "\n",
        trailing: "\n",
      },
    ],
  };
  const sha256BeforeA8C2 = (path: string): string => {
    const snippets = a8c2Snippets[path];
    if (!snippets) return sha256(path);
    const source = readFileSync(join(root, path), "utf8");
    let cursor = 0;
    let reconstructed = "";
    for (const snippet of snippets) {
      assert.equal(source.split(snippet.begin).length - 1, 1, `${path}: A8-C2 begin marker count`);
      assert.equal(source.split(snippet.end).length - 1, 1, `${path}: A8-C2 end marker count`);
      const markerStart = source.indexOf(snippet.begin);
      const snippetStart = markerStart - snippet.leading.length;
      assert.ok(snippetStart >= cursor, `${path}: A8-C2 marker order/non-overlap`);
      assert.equal(source.slice(snippetStart, markerStart), snippet.leading, `${path}: A8-C2 leading delimiter`);
      const endMarkerStart = source.indexOf(snippet.end, markerStart + snippet.begin.length);
      assert.ok(endMarkerStart > markerStart, `${path}: A8-C2 marker order`);
      const endMarkerEnd = endMarkerStart + snippet.end.length;
      const snippetEnd = endMarkerEnd + snippet.trailing.length;
      assert.equal(source.slice(endMarkerEnd, snippetEnd), snippet.trailing, `${path}: A8-C2 trailing delimiter`);
      reconstructed += source.slice(cursor, snippetStart);
      cursor = snippetEnd;
    }
    reconstructed += source.slice(cursor);
    return createHash("sha256").update(reconstructed, "utf8").digest("hex");
  };
  for (const [path, expectedSha256] of Object.entries(immutableSurfaceSha256)) {
    assert.equal(sha256BeforeA8C2(path), expectedSha256, path);
  }

  const schemaPath = join(root, "prisma/schema.prisma");
  const schemaSource = readFileSync(schemaPath, "utf8");
  const a8c1SchemaStart = schemaSource.indexOf("// A8-C1: redacted control facts only.");
  const a8c1SchemaEnd = schemaSource.indexOf("// 学び", a8c1SchemaStart);
  assert.ok(a8c1SchemaStart >= 0 && a8c1SchemaEnd > a8c1SchemaStart, "A8-C1 schema addition must remain self-contained");
  assert.equal(
    createHash("sha256").update(schemaSource.slice(0, a8c1SchemaStart) + schemaSource.slice(a8c1SchemaEnd), "utf8").digest("hex"),
    "e119fa710fbe71648ef1389a36a5fb64fa06926a30b4d6b64526aa4e884251ae",
    "prisma/schema.prisma outside the explicit A8-C1 block",
  );

  const a8c1MigrationPath = "prisma/migrations/20260824160000_h_cycle_activation_control_ledger/migration.sql";
  const migrationPaths = lines(["ls-files", "prisma/migrations/*/migration.sql"]);
  assert.equal(migrationPaths.length, 17, "migration path surface must contain only the explicit A8-C1 addition");
  assert.deepEqual(migrationPaths.filter((path) => path === a8c1MigrationPath), [a8c1MigrationPath]);
  const preA8C1MigrationPaths = migrationPaths.filter((path) => path !== a8c1MigrationPath);
  assert.equal(preA8C1MigrationPaths.length, 16, "pre-A8-C1 migration path surface must remain exact");
  const migrationAggregate = preA8C1MigrationPaths.sort()
    .map((path) => `${path}\t${sha256(path)}\n`)
    .join("");
  assert.equal(
    createHash("sha256").update(migrationAggregate, "utf8").digest("hex"),
    "a6de7cf4352f112ca94de742afbe508325c8227f1a6ba8c8eeed51675972e69a",
    "migration byte surface must remain exact",
  );
});
