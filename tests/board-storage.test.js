import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/boardStorage.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function storageModule(localStorage) {
  const exports = {};
  runInNewContext(code, { exports, window: { localStorage } });
  return exports;
}

test("Firebase-backed boards neither read nor persist private browser data", () => {
  const api = storageModule({
    getItem() { assert.fail("Must not read stale private records"); },
    setItem() { assert.fail("Must not persist private records"); },
  });
  const storage = api.createBoardStorage(false);
  assert.equal(storage.getItem("vcg-wins-board-data"), null);
  storage.setItem("vcg-wins-board-data", "private fixture");
});

test("offline and demo boards can still persist local changes", () => {
  const entries = new Map();
  const storage = storageModule({
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  }).createBoardStorage(true);
  storage.setItem("vcg-demo-wins-board-data", "demo fixture");
  assert.equal(storage.getItem("vcg-demo-wins-board-data"), "demo fixture");
});

test("legacy cleanup removes private caches but preserves session and demo data", () => {
  const privateKeys = ["vcg-wins-board-data", "vcg-wins-board-archive", "vcg-wins-board-activity", "vcg-total-wins", "vcg-wins-target", "vcg-wins-target-v2"];
  const retainedKeys = ["firebase:authUser", "theme", "vcg-demo-wins-board-data"];
  const entries = new Map([...privateKeys, ...retainedKeys].map((key) => [key, "fixture"]));
  storageModule({ removeItem: (key) => entries.delete(key) }).clearLegacyBoardStorage();
  assert.deepEqual([...entries.keys()], retainedKeys);
});

test("restricted browser storage does not break initialization or cleanup", () => {
  const blocked = () => { throw new Error("Storage denied"); };
  const api = storageModule({ getItem: blocked, setItem: blocked, removeItem: blocked });
  assert.doesNotThrow(() => api.clearLegacyBoardStorage());
  const storage = api.createBoardStorage(true);
  assert.equal(storage.getItem("key"), null);
  assert.doesNotThrow(() => storage.setItem("key", "value"));
});
