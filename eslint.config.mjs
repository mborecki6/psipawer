import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...ts,
  globalIgnores([
    ".next/**",
    ".next-local/**",
    ".local/**",
    "output/**",
    "tmp/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
    "public/reference/**",
  ]),
]);
