import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { staticMarkets } from "../entities.js";
import { candidates } from "../fuzzy.js";
import { detectLocale, Lexer } from "../lexer.js";
import { numberFromWords, readNumber } from "../numbers.js";
import { fold, segment } from "../text.js";
import { suffixRole } from "../turkish.js";
import type { Tok } from "../types.js";

const lexer = new Lexer({ environment: "testnet", markets: staticMarkets() });
const kinds = (text: string, locale = detectLocale(text)) => lexer.lex(text, locale).map((tok) => tok.k);
const strip = (tok: Tok) => {
  const { span: _span, ...rest } = tok;
  return rest;
};

describe("numbers", () => {
  it("reads English and Turkish separators and refuses ambiguous ones", () => {
    assert.deepEqual(readNumber("1.5", "en"), { value: "1.5" });
    assert.deepEqual(readNumber("1,500", "en"), { value: "1500", rewritten: true });
    assert.deepEqual(readNumber("1,5", "en"), { value: "1.5", ambiguous: ["1.5", "15"] });
    assert.deepEqual(readNumber("1,5", "tr"), { value: "1.5", rewritten: true });
    assert.deepEqual(readNumber("0,05", "tr"), { value: "0.05", rewritten: true });
    assert.deepEqual(readNumber("1.500", "tr"), { value: "1.5", ambiguous: ["1.5", "1500"] });
    assert.deepEqual(readNumber("1,500", "tr"), { value: "1.5", ambiguous: ["1.5", "1500"] });
    assert.deepEqual(readNumber("1.000.000,5", "tr"), { value: "1000000.5", rewritten: true });
    assert.deepEqual(readNumber("1,000,000.25", "en"), { value: "1000000.25", rewritten: true });
  });

  it("scales k always and m only when allowed (m is minutes otherwise)", () => {
    assert.deepEqual(readNumber("5k", "en"), { value: "5000", rewritten: true });
    assert.deepEqual(readNumber("58k", "en"), { value: "58000", rewritten: true });
    assert.equal(readNumber("1m", "en"), null);
    assert.deepEqual(readNumber("1.2m", "en", { allowMillions: true }), { value: "1200000", rewritten: true });
    assert.equal(readNumber("abc", "en"), null);
  });

  it("reads number words in both languages", () => {
    assert.equal(numberFromWords(["two", "hundred"], "en"), 200);
    assert.equal(numberFromWords(["a", "hundred"], "en"), 100);
    assert.equal(numberFromWords(["iki", "yuz"], "tr"), 200);
    assert.equal(numberFromWords(["bin", "bes", "yuz"], "tr"), 1500);
    assert.equal(numberFromWords(["a"], "en"), null);
  });
});

describe("text and Turkish suffixes", () => {
  it("keeps offsets and folds Turkish letters", () => {
    const text = "20 HYPE'ı Elysium'a köprüle";
    for (const seg of segment(text)) assert.equal(text.slice(seg.start, seg.end), seg.raw);
    assert.equal(fold("köprüle"), "koprule");
    assert.equal(fold("İPTAL"), "iptal");
  });

  it("maps case suffixes to roles", () => {
    assert.equal(suffixRole("a"), "to");
    assert.equal(suffixRole("ye"), "to");
    assert.equal(suffixRole("de"), "on");
    assert.equal(suffixRole("ta"), "on");
    assert.equal(suffixRole("dan"), "from");
    assert.equal(suffixRole("ten"), "from");
    assert.equal(suffixRole("i"), "obj");
    assert.equal(suffixRole("yi"), "obj");
    assert.equal(suffixRole("in"), "gen");
    assert.equal(suffixRole("lik"), "worth");
    assert.equal(suffixRole("le"), "with");
    assert.equal(suffixRole("lar"), null);
    assert.equal(suffixRole("xyz"), undefined);
  });

  it("detects the locale", () => {
    assert.equal(detectLocale("swap 10 HYPE to USDC"), "en");
    assert.equal(detectLocale("10 HYPE'ı USDC'ye çevir"), "tr");
    assert.equal(detectLocale("tüm pozisyonları kapat"), "tr");
    assert.equal(detectLocale("what's my pnl"), "en");
  });
});

describe("lexer", () => {
  it("reads the brief's Turkish example with roles", () => {
    const tokens = lexer.lex("ETH'de 5x long aç 200 USDC ile, stop %3", "tr").map(strip);
    assert.deepEqual(tokens, [
      { k: "market", coin: "ETH", role: "on" },
      { k: "lev", x: 5 },
      { k: "side", side: "long" },
      { k: "verb", verb: "open" },
      { k: "num", value: "200", role: "with" },
      { k: "asset", symbol: "USDC", listed: true, role: "with" },
      { k: "prep", role: "with" },
      { k: "punct", p: "," },
      { k: "tpsl", kind: "sl" },
      { k: "num", value: "3", pct: true },
    ]);
  });

  it("reads leverage, durations, percents, dollars, clocks, addresses and names by shape", () => {
    assert.deepEqual(kinds("long 10x x5 5 x"), ["side", "lev", "lev", "lev"]);
    assert.deepEqual(kinds("over 2h 30m 90 minutes"), ["prep", "dur", "dur", "dur"]);
    const pct = lexer.lex("-3% %3 0.05%", "en").map(strip);
    assert.deepEqual(pct, [{ k: "num", value: "3", pct: true, neg: true }, { k: "num", value: "3", pct: true }, { k: "num", value: "0.05", pct: true }]);
    assert.deepEqual(lexer.lex("$5k", "en").map(strip), [{ k: "num", value: "5000", usd: true, rewritten: true }]);
    assert.deepEqual(kinds("at 9:30 utc"), ["prep", "clock"]);
    assert.deepEqual(kinds("send to 0x13A130B336400409c956dF042C128238F1486ddD and bona.ely"), ["verb", "prep", "addr", "conn", "name"]);
    assert.deepEqual(lexer.lex("xyz:TSLA HYPE/USDC ETH-PERP", "en").map(strip), [
      { k: "market", coin: "TSLA", dex: "xyz", kind: "perp" },
      { k: "market", coin: "HYPE", kind: "spot" },
      { k: "market", coin: "ETH", kind: "perp" },
    ]);
  });

  it("prefers the longest phrase", () => {
    assert.deepEqual(kinds("take profit"), ["tpsl"]);
    assert.deepEqual(kinds("satın al", "tr"), ["verb"]);
    assert.equal((lexer.lex("satın al", "tr")[0] as Tok & { k: "verb" }).verb, "buy");
    assert.equal((lexer.lex("sat", "tr")[0] as Tok & { k: "verb" }).verb, "sell");
  });

  it("never reads an unknown word as anything but unknown, and flags negations", () => {
    assert.deepEqual(kinds("flibber 10 HYPE"), ["unknown", "num", "asset"]);
    assert.ok(kinds("don't close my long").includes("neg"));
    assert.ok(kinds("ETH pozisyonumu kapatma", "tr").includes("neg"));
  });

  it("offers asset typos only for a single close candidate", () => {
    assert.deepEqual(candidates("hpye", ["hype", "usdc", "purr"]), ["hype"]);
    assert.deepEqual(candidates("usd", ["usdc"]), []);
    const typo = lexer.lex("swap 1 HPYE", "en")[2] as Tok & { k: "asset" };
    assert.equal(typo.symbol, "HYPE");
    assert.equal(typo.typo, "HPYE");
  });

  it("reads registry look-alikes as themselves", () => {
    const tok = lexer.lex("tUSDC", "en")[0] as Tok & { k: "asset" };
    assert.equal(tok.lookalike, "USDC");
    const weth = lexer.lex("WETH", "en")[0] as Tok & { k: "asset" };
    assert.equal(weth.lookalike, "WHYPE");
  });
});
