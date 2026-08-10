import { test } from "node:test";
import assert from "node:assert/strict";
import { version } from "./index.js";

test("version is a non-empty string", () => {
  assert.equal(typeof version, "string");
  assert.ok(version.length > 0);
});
