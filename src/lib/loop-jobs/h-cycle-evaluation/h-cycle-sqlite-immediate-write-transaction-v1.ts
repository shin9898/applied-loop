export type HCycleSqliteImmediateWriteConnectionV1 = Readonly<{
  transaction: (operation: () => void) => Readonly<{
    immediate: () => unknown;
  }>;
}>;

export type HCycleSqliteImmediateWriteTransactionResultV1 =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "storage_failure" }>;

const STORAGE_FAILURE: HCycleSqliteImmediateWriteTransactionResultV1 = Object.freeze({
  ok: false,
  code: "storage_failure",
});
const SUCCESS: HCycleSqliteImmediateWriteTransactionResultV1 = Object.freeze({ ok: true });

export function runHCycleSqliteImmediateWriteTransactionV1(
  input: Readonly<{ connection: HCycleSqliteImmediateWriteConnectionV1 }>,
  operation: (connection: HCycleSqliteImmediateWriteConnectionV1) => undefined,
): HCycleSqliteImmediateWriteTransactionResultV1 {
  try {
    input.connection.transaction(() => {
      if (operation(input.connection) !== undefined) throw new Error("unexpected operation result");
    }).immediate();
    return SUCCESS;
  } catch {
    return STORAGE_FAILURE;
  }
}
