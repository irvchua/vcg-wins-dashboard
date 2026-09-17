import test from "node:test";
import assert from "node:assert/strict";
import { handleLocalApiRequest } from "../scripts/local-api-server.mjs";

function response() {
  return {
    statusCode: 200,
    destroyed: false,
    writableEnded: false,
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
      this.writableEnded = true;
    },
  };
}

test("an interrupted request is handled without writing to the disconnected client", async () => {
  const req = {
    url: "/api/tasks",
    aborted: false,
    async *[Symbol.asyncIterator]() {
      yield "partial body";
      this.aborted = true;
      throw Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    },
  };
  const res = response();
  res.setHeader = () => assert.fail("Do not write to an aborted request");
  res.end = () => assert.fail("Do not write to an aborted request");
  await assert.doesNotReject(handleLocalApiRequest(req, res));

  // The next request still reaches its handler after the interrupted upload.
  const next = response();
  await handleLocalApiRequest({
    url: "/api/tasks", method: "POST", headers: {},
    async *[Symbol.asyncIterator]() { yield "{}"; },
  }, next);
  assert.equal(next.statusCode, 401);
});

test("local routing rejects unknown paths, including object prototype names", async () => {
  const res = response();
  await handleLocalApiRequest({ url: "/toString" }, res);
  assert.equal(res.statusCode, 404);
});
