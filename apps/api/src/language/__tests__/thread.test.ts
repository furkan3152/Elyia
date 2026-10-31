import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeAnswers, ThreadSigner, textHash } from "../thread.js";

const NOW = Date.UTC(2026, 9, 31);

describe("thread token", () => {
  const signer = new ThreadSigner("secret");
  const answers = [{ question: "g0.leverage", option: "5" }, { question: "g0.size", text: "0.1" }];

  it("round-trips for the same text", () => {
    const token = signer.sign("go long eth", answers, NOW) as string;
    assert.deepEqual(signer.verify(token, "go long eth", NOW + 1_000), answers);
  });

  it("refuses other text, tampering, expiry and other keys", () => {
    const token = signer.sign("go long eth", answers, NOW) as string;
    assert.equal(signer.verify(token, "go short eth", NOW), null);
    const [body, mac] = token.split(".") as [string, string];
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), a: [{ question: "g0.leverage", option: "50" }] })).toString("base64url");
    assert.equal(signer.verify(`${tampered}.${mac}`, "go long eth", NOW), null);
    assert.equal(signer.verify(token, "go long eth", NOW + 31 * 60_000), null);
    assert.equal(new ThreadSigner("other").verify(token, "go long eth", NOW), null);
    assert.equal(signer.verify("garbage", "go long eth", NOW), null);
  });

  it("is null when nothing was answered, and later answers win", () => {
    assert.equal(signer.sign("x", [], NOW), null);
    assert.deepEqual(mergeAnswers([{ question: "a", option: "1" }], [{ question: "a", option: "2" }]), [{ question: "a", option: "2" }]);
    assert.equal(textHash("abc").length, 16);
  });
});
