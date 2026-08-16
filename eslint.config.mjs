import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // 既存10箇所の改修が必要なため一時的に warn 降格。
      // 解消したら error に戻す（CI 導入時の暫定措置）。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
