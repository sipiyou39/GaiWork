import * as NodeStream from "node:stream";

import { assert, describe, it } from "@effect/vitest";

import { createSafeOutputRelay, isDisconnectedOutputError } from "./safe-output-relay.mjs";

function outputError(code) {
  return Object.assign(new Error(`write ${code}`), { code });
}

describe("safe desktop dev output relay", () => {
  it("recognizes only disconnected terminal errors", () => {
    assert.isTrue(isDisconnectedOutputError(outputError("EIO")));
    assert.isTrue(isDisconnectedOutputError(outputError("EPIPE")));
    assert.isFalse(isDisconnectedOutputError(outputError("ENOSPC")));
    assert.isFalse(isDisconnectedOutputError(new Error("missing code")));
  });

  it("keeps draining child output after the terminal disappears", () => {
    const source = new NodeStream.PassThrough();
    const target = new NodeStream.PassThrough();
    let received = "";
    target.on("data", (chunk) => {
      received += chunk.toString();
    });
    const relay = createSafeOutputRelay(target);
    relay.connect(source);

    source.write("before\n");
    target.emit("error", outputError("EIO"));
    source.write("after\n");

    assert.strictEqual(received, "before\n");
    assert.isFalse(relay.available);
    assert.isTrue(source.readableFlowing);
    relay.dispose();
  });

  it("reports unexpected destination errors", () => {
    const target = new NodeStream.PassThrough();
    const unexpected = [];
    const relay = createSafeOutputRelay(target, {
      onUnexpectedError: (cause) => unexpected.push(cause),
    });
    const cause = outputError("ENOSPC");

    target.emit("error", cause);

    assert.deepEqual(unexpected, [cause]);
    assert.isFalse(relay.available);
    relay.dispose();
  });
});
