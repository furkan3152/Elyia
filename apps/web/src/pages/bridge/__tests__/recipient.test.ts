import assert from "node:assert/strict";
import { test } from "node:test";

import { recipientProblem } from "../recipient";

test("recipients: 0x addresses and name.ely", () => {
  assert.equal(recipientProblem("bona.ely"), null);
  assert.equal(recipientProblem("0xe49D0d8CF01Ea366D804CC84738A768F0b8b175e"), null);
  assert.equal(recipientProblem(""), null);
  assert.match(recipientProblem("bo na.ely")!, /letters/u);
  assert.match(recipientProblem("bona.eth")!, /0x address/u);
});
