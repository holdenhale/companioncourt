import test from "node:test";
import assert from "node:assert/strict";
import { API_KEY_ENV_VAR, UsageError, requireKey } from "./cli.js";

// requireKey is the argv-secret fix (upstream-quality improvement): --key stays supported for existing
// scripts, but COMPANIONCOURT_API_KEY alone is now enough — the key no longer has to touch argv/process
// listings at all for the common case. See cli.ts's isEntryPoint guard: importing this module for these
// tests must NOT trigger the real argv-driven CLI dispatch (main() only runs when this file is the
// process entry point), which is exactly what makes requireKey testable in isolation like this.

function withEnvKey(value: string | undefined, fn: () => void): void {
  const prev = process.env[API_KEY_ENV_VAR];
  if (value === undefined) delete process.env[API_KEY_ENV_VAR];
  else process.env[API_KEY_ENV_VAR] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[API_KEY_ENV_VAR];
    else process.env[API_KEY_ENV_VAR] = prev;
  }
}

test("requireKey: an explicit --key flag is used as-is", () => {
  withEnvKey(undefined, () => {
    assert.equal(requireKey({ key: "sk-flag-value" }), "sk-flag-value");
  });
});

test(`requireKey: falls back to ${API_KEY_ENV_VAR} when --key is omitted`, () => {
  withEnvKey("sk-env-value", () => {
    assert.equal(requireKey({}), "sk-env-value");
  });
});

test("requireKey: --key wins over the env var when both are present", () => {
  withEnvKey("sk-env-value", () => {
    assert.equal(requireKey({ key: "sk-flag-value" }), "sk-flag-value");
  });
});

test("requireKey: an empty --key value falls back to the env var, not an empty string", () => {
  withEnvKey("sk-env-value", () => {
    assert.equal(requireKey({ key: "" }), "sk-env-value");
  });
});

test("requireKey: throws UsageError (mentioning both the flag and the env var) when neither is present", () => {
  withEnvKey(undefined, () => {
    assert.throws(
      () => requireKey({}),
      (error: unknown) =>
        error instanceof UsageError && /--key/.test(error.message) && /COMPANIONCOURT_API_KEY/.test(error.message)
    );
  });
});
