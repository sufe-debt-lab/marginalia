#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  loadDocsImpactDeclaration,
  parseDocsCheckArgs,
  runDiffChecks,
  runStaticChecks
} from "./docs-check-lib.mjs";

const repoRoot = process.env.DOCS_CHECK_REPO_ROOT
  ? path.resolve(process.env.DOCS_CHECK_REPO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let options;
try {
  options = parseDocsCheckArgs(process.argv.slice(2));
} catch (error) {
  globalThis.console.error(`docs:check usage error: ${error.message}`);
  process.exitCode = 2;
}

if (options) {
  const errors = runStaticChecks(repoRoot);
  if (options.base) {
    try {
      const declaration = loadDocsImpactDeclaration({
        declarationPath: options.declarationPath,
        githubEventPath: options.githubEventPath,
        requireFreshApproval: process.env.DOCS_CHECK_REQUIRE_FRESH_APPROVAL === "1"
      });
      errors.push(
        ...runDiffChecks(repoRoot, options.base, declaration, {
          impactConfigPath: process.env.DOCS_CHECK_IMPACT_CONFIG
            ? path.resolve(process.env.DOCS_CHECK_IMPACT_CONFIG)
            : null
        })
      );
    } catch (error) {
      errors.push(`docs-impact declaration: ${error.message}`);
    }
  }
  if (errors.length) {
    globalThis.console.error(`docs:check failed with ${errors.length} error(s):`);
    for (const error of errors) globalThis.console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    globalThis.console.log(`docs:check passed (${options.base ? "static + diff" : "static"})`);
  }
}
