import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GLOBAL_BINDINGS } from "../bindings";
import { isEditableTarget, normalizeKey, SequenceMatcher } from "../sequence";

describe("normalizeKey", () => {
  it("canonicalises chords and plain keys", () => {
    assert.equal(normalizeKey({ key: "k", metaKey: true }), "mod+k");
    assert.equal(normalizeKey({ key: "K", ctrlKey: true, shiftKey: true }), "mod+k");
    assert.equal(normalizeKey({ key: "G" }), "g");
    assert.equal(normalizeKey({ key: "?", shiftKey: true }), "?");
    assert.equal(normalizeKey({ key: "Escape" }), "escape");
  });

  it("ignores modifiers alone, repeats and AltGr-style combos", () => {
    assert.equal(normalizeKey({ key: "Meta", metaKey: true }), null);
    assert.equal(normalizeKey({ key: "g", repeat: true }), null);
    assert.equal(normalizeKey({ key: "k", ctrlKey: true, altKey: true }), null);
    assert.equal(normalizeKey({ key: "@", altKey: true }), null);
  });
});

describe("isEditableTarget", () => {
  it("treats text fields and contenteditable as typing", () => {
    assert.equal(isEditableTarget({ tagName: "INPUT", type: "text" }), true);
    assert.equal(isEditableTarget({ tagName: "input", type: "" }), true);
    assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
    assert.equal(isEditableTarget({ tagName: "DIV", getAttribute: (name) => (name === "role" ? "textbox" : null) }), true);
  });

  it("lets shortcuts through on buttons, checkboxes and ranges", () => {
    assert.equal(isEditableTarget({ tagName: "BUTTON" }), false);
    assert.equal(isEditableTarget({ tagName: "INPUT", type: "checkbox" }), false);
    assert.equal(isEditableTarget({ tagName: "INPUT", type: "range" }), false);
    assert.equal(isEditableTarget(null), false);
  });
});

describe("SequenceMatcher", () => {
  const matcher = () => new SequenceMatcher(GLOBAL_BINDINGS, { timeoutMs: 900 });

  it("opens the Oracle on mod+k and '/', shortcuts on '?'", () => {
    const m = matcher();
    assert.equal(m.feed("mod+k", 0), "oracle");
    assert.equal(m.feed("/", 10), "oracle");
    assert.equal(m.feed("?", 20), "shortcuts");
  });

  it("resolves g t to Trade and g p to Portfolio", () => {
    const m = matcher();
    assert.equal(m.feed("g", 0), null);
    assert.equal(m.pending, true);
    assert.equal(m.feed("t", 200), "go:/app/trade");
    assert.equal(m.feed("g", 1_000), null);
    assert.equal(m.feed("p", 1_300), "go:/app/portfolio");
  });

  it("forgets a prefix after the timeout and recovers from a wrong second key", () => {
    const m = matcher();
    m.feed("g", 0);
    assert.equal(m.feed("t", 2_000), null, "too late: 't' alone is not bound");
    m.feed("g", 3_000);
    assert.equal(m.feed("?", 3_100), "shortcuts", "a non-matching key starts over on its own");
    assert.equal(m.pending, false);
  });
});
