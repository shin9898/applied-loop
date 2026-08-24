import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import ts from "typescript";

const SOURCE_ROOT = join(process.cwd(), "src", "lib");

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    })
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.includes("/generated/"))
    .sort();
}

function propertyNamed(node: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return node.properties.find((property) => (
    ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    && property.name.text === name
  ));
}

function isGateStatusMutation(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.name.text !== "update" && node.expression.name.text !== "updateMany") return false;
  if (!ts.isPropertyAccessExpression(node.expression.expression) || node.expression.expression.name.text !== "gate") return false;
  const first = node.arguments[0];
  if (!first || !ts.isObjectLiteralExpression(first)) return false;
  const data = propertyNamed(first, "data");
  if (!data || !ts.isPropertyAssignment(data) || !ts.isObjectLiteralExpression(data.initializer)) return false;
  return propertyNamed(data.initializer, "status") !== undefined;
}

function callCount(source: ts.SourceFile, identifier: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === identifier) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    readFileSync(join(process.cwd(), relativePath), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
  );
}

test("A7B-CG4-T1 allows textbook_check status history only through the reviewed writer boundary", () => {
  const directMutations: string[] = [];
  for (const path of filesBelow(SOURCE_ROOT)) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ESNext, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isGateStatusMutation(node)) {
        directMutations.push(relative(process.cwd(), path));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(directMutations.sort(), [
    "src/lib/gate.ts",
    "src/lib/gate.ts",
    "src/lib/requeue-failed-grading.ts",
    "src/lib/textbook-check-gate-history.ts",
  ]);

  const answer = parse("src/lib/gate-answer.ts");
  const actions = parse("src/lib/actions.ts");
  const gate = parse("src/lib/gate.ts");
  const requeue = parse("src/lib/requeue-failed-grading.ts");
  const capture = parse("src/lib/capture.ts");

  assert.equal(callCount(answer, "transitionGateStatusWithTextbookHistory"), 1);
  assert.equal(callCount(actions, "transitionGateStatusWithTextbookHistory"), 5);
  assert.ok(callCount(gate, "transitionGateStatusWithTextbookHistory") >= 5);
  assert.ok(callCount(gate, "appendTextbookCheckGateStateEvent") >= 1);
  assert.equal(callCount(requeue, "appendTextbookCheckGateStateEvent"), 1);
  assert.equal(callCount(capture, "observeTextbookCheckGateFollowup"), 2);

  const gateText = gate.getFullText();
  assert.match(gateText, /data: \{ \.\.\.gradeData, status: "failed" \}[\s\S]*appendTextbookCheckGateStateEvent/);
  assert.match(gateText, /kind: \{ in: \["retry", "sr_review"\] \}[\s\S]*status: "dismissed"/);
  assert.match(requeue.getFullText(), /\$transaction[\s\S]*appendTextbookCheckGateStateEvent/);
  assert.match(capture.getFullText(), /\$transaction[\s\S]*observeTextbookCheckGateFollowup/);
});
