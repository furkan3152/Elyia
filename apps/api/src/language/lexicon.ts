/**
 * The closed vocabulary of the reader, English and Turkish. Keys are folded
 * (lower case, Turkish letters to ASCII: "köprüle" -> "koprule") word
 * sequences; the lexer matches the longest phrase first, so "take profit"
 * beats "take" and "satın al" (buy) beats "sat" (sell).
 *
 * Anything not in these tables, the asset/market/network/venue registries or
 * the number readers is unknown: its clause is not read (fail closed).
 */
import type { Tok, Verb } from "./types.js";
import type { Locale } from "./numbers.js";
import { VENUE_WORDS } from "./venues.js";

type Template = Tok extends infer T ? (T extends Tok ? Omit<T, "span"> : never) : never;
type Scope = Locale | "both";

const ENTRIES: Array<readonly [Scope, string, Template]> = [];

function add(scope: Scope, phrases: readonly string[], template: Template): void {
  for (const phrase of phrases) ENTRIES.push([scope, phrase, template]);
}

function verb(scope: Scope, name: Verb, phrases: readonly string[], chain: readonly string[] = []): void {
  add(scope, phrases, { k: "verb", verb: name });
  add(scope, chain, { k: "verb", verb: name, chain: true });
}

/* --------------------------------------------------------------- verbs */

verb("en", "swap", ["swap", "convert", "exchange", "change", "turn", "trade"]);
verb("en", "buy", ["buy", "purchase", "ape", "ape into", "bid", "pick up", "accumulate"]);
verb("en", "sell", ["sell", "dump", "offload", "sell off"]);
verb("en", "bridge", ["bridge", "bridge over"]);
verb("en", "move", ["move", "transfer", "fund", "top up"]);
verb("en", "deposit", ["deposit", "put"]);
verb("en", "send", ["send", "pay", "tip"]);
verb("en", "stake", ["stake", "liquid stake", "delegate"]);
verb("en", "unstake", ["unstake", "un-stake", "redeem", "undelegate"]);
verb("en", "wrap", ["wrap"]);
verb("en", "unwrap", ["unwrap"]);
verb("en", "lend", ["lend", "supply", "lend out"]);
verb("en", "withdraw", ["withdraw", "take out", "pull out"]);
verb("en", "borrow", ["borrow", "take a loan"]);
verb("en", "repay", ["repay", "pay back", "pay off"]);
verb("en", "open", ["open", "enter", "go", "place"]);
verb("en", "close", ["close", "exit", "close out", "unwind", "get out of"]);
verb("en", "reduce", ["reduce", "trim", "cut", "scale out of", "decrease"]);
verb("en", "flatten", ["flatten", "flatten everything", "go flat"]);
verb("en", "cancel", ["cancel", "kill"]);
verb("both", "twap", ["twap"]);
verb("en", "set", ["set", "update", "adjust", "add", "use", "make"]);
verb("en", "alert", ["alert", "alert me", "notify", "notify me", "ping", "ping me", "let me know", "tell me", "remind me", "warn me", "message me"]);
verb("en", "show", ["show", "show me", "list", "display", "check", "give me"]);

verb("tr", "swap", ["cevir", "cevirin", "donustur", "donusturun", "takas et", "takas edin", "degistir", "degistirin", "swap et", "swap yap", "swapla", "swaple"], ["cevirip", "donusturup", "takas edip", "degistirip", "swaplayip", "swap edip"]);
verb("tr", "buy", ["al", "alin", "alalim", "satin al", "almak istiyorum", "alir misin", "alabilir misin"], ["alip", "satin alip"]);
verb("tr", "sell", ["sat", "satin", "satalim", "satmak istiyorum", "satar misin"], ["satip"]);
verb("tr", "bridge", ["koprule", "kopruleyin", "bridge et", "bridge yap", "bridgele", "kopruden gecir"], ["kopruleyip", "bridge edip"]);
verb("tr", "move", ["tasi", "tasiyin", "aktar", "aktarin", "gecir", "gecirin", "transfer et", "transfer yap"], ["tasiyip", "aktarip", "gecirip", "transfer edip"]);
verb("tr", "deposit", ["yatir", "yatirin", "koy"], ["yatirip", "koyup"]);
verb("tr", "send", ["gonder", "gonderin", "yolla", "yollayin", "ode"], ["gonderip", "yollayip"]);
verb("tr", "stake", ["stake et", "stake edin", "stake yap", "stakele", "delege et"], ["stake edip", "stakeleyip"]);
verb("tr", "unstake", ["unstake et", "unstake yap", "unstakele", "stake boz", "stake coz", "geri cevir"], ["unstake edip"]);
verb("tr", "wrap", ["wrap et", "wrapla", "sar"]);
verb("tr", "unwrap", ["unwrap et", "unwrapla"]);
verb("tr", "lend", ["borc ver", "odunc ver", "lend et", "supply et"]);
verb("tr", "withdraw", ["cek", "cekin", "geri cek", "geri al"], ["cekip"]);
verb("tr", "borrow", ["borc al", "odunc al"]);
verb("tr", "repay", ["geri ode", "borcu ode", "borcumu ode"]);
verb("tr", "open", ["ac", "acin", "acalim", "gir", "girin", "acmak istiyorum", "acar misin"], ["acip", "girip"]);
verb("tr", "close", ["kapat", "kapatin", "kapatalim", "kapatmak istiyorum", "kapatir misin", "cik", "cikin"], ["kapatip", "cikip"]);
verb("tr", "reduce", ["azalt", "azaltin", "kucult", "kucultun", "dusur"], ["azaltip"]);
verb("tr", "cancel", ["iptal et", "iptal edin", "sil", "silin"], ["iptal edip"]);
verb("tr", "set", ["ayarla", "ayarlayin", "yap", "yapin", "ekle", "kur", "olarak ayarla", "getir"], ["ayarlayip", "yapip", "ekleyip", "kurup"]);
verb("tr", "alert", ["haber ver", "bana haber ver", "bildir", "bana bildir", "uyar", "beni uyar", "alarm kur", "bildirim gonder", "mesaj at", "bana yaz"]);
verb("tr", "show", ["goster", "bana goster", "listele", "goruntule", "gosterir misin"]);
// Polite aorist questions ("çevirir misin", "köprüler misin"): the verb reads the same; "misin" is noise.
verb("tr", "swap", ["cevirir", "donusturur", "takas eder", "degistirir"]);
verb("tr", "bridge", ["kopruler", "bridge eder"]);
verb("tr", "move", ["tasir", "aktarir", "gecirir"]);
verb("tr", "send", ["gonderir", "yollar"]);
verb("tr", "deposit", ["yatirir"]);
verb("tr", "stake", ["stake eder"]);
verb("tr", "withdraw", ["ceker"]);
verb("tr", "reduce", ["azaltir"]);
verb("tr", "set", ["ayarlar", "yapar"]);
verb("tr", "cancel", ["iptal eder"]);
verb("tr", "close", ["kapatir"]);

/* ------------------------------------------------------ trading words */

add("both", ["long", "go long", "long on", "longla", "long gir"], { k: "side", side: "long" });
add("both", ["short", "go short", "short on", "shortla", "short gir", "fade"], { k: "side", side: "short" });
add("both", ["cross", "cross margin", "capraz", "capraz marjin"], { k: "margin", mode: "cross" });
add("both", ["isolated", "iso", "isolated margin", "izole", "izole marjin"], { k: "margin", mode: "isolated" });
add("en", ["market", "at market", "market order", "market price", "at market price"], { k: "order", t: "market" });
add("tr", ["piyasa", "piyasadan", "piyasa fiyatindan", "piyasa emri", "market", "marketten"], { k: "order", t: "market" });
add("both", ["limit", "limit order", "limit emri", "limit emir", "limitle"], { k: "order", t: "limit" });
add("both", ["post only", "post-only", "alo", "maker only"], { k: "order", t: "alo" });
add("both", ["ioc"], { k: "order", t: "ioc" });
add("both", ["gtc", "good till cancel"], { k: "order", t: "gtc" });
add("both", ["reduce only", "reduce-only"], { k: "order", t: "reduceOnly" });
add("both", ["tp", "take profit", "take-profit", "takeprofit", "target", "kar al", "kar al emri", "hedef"], { k: "tpsl", kind: "tp" });
add("both", ["sl", "stop", "stop loss", "stop-loss", "stoploss", "anchor", "zarar durdur", "stop emri"], { k: "tpsl", kind: "sl" });
add("en", ["leverage", "lev", "of leverage", "with leverage"], { k: "levword" });
add("tr", ["kaldirac", "kaldiraci", "kaldiracli", "kaldiracla", "kaldiraci ile", "kaldirac ile", "kat", "katli", "kat kaldirac", "kat kaldiracli"], { k: "levword" });
add("en", ["max leverage", "maximum leverage"], { k: "lev", x: "max" });
add("tr", ["maksimum kaldirac", "max kaldirac", "en yuksek kaldirac", "maksimum kaldiracla", "max kaldiracla", "en yuksek kaldiracla", "maksimum kaldiracli"], { k: "lev", x: "max" });
add("en", ["no leverage", "without leverage"], { k: "lev", x: 1 });
add("tr", ["kaldiracsiz"], { k: "lev", x: 1 });
add("both", ["breakeven", "break even", "break-even", "giris fiyati", "basabas"], { k: "flag", flag: "breakeven" });
add("en", ["from entry", "below entry", "entry", "of entry", "from my entry"], { k: "flag", flag: "entry" });
add("tr", ["giristen", "girisin", "giris"], { k: "flag", flag: "entry" });
add("en", ["mark", "of mark", "below mark", "from mark"], { k: "flag", flag: "mark" });
add("en", ["notional", "notional value", "position size", "size"], { k: "flag", flag: "notional" });
add("tr", ["pozisyon buyuklugu", "buyukluk", "buyuklugunde", "nosyonel"], { k: "flag", flag: "notional" });
add("en", ["margin", "as margin", "of margin", "collateral", "as collateral"], { k: "flag", flag: "margin" });
add("tr", ["marjin", "marjinle", "marjin ile", "teminat", "teminatla"], { k: "flag", flag: "margin" });
add("both", ["perp", "perps", "perpetual", "perpetuals", "futures", "vadeli"], { k: "flag", flag: "perpword" });
add("both", ["spot"], { k: "flag", flag: "spotword" });
add("en", ["randomized", "randomize", "random"], { k: "flag", flag: "random" });
add("tr", ["rastgele"], { k: "flag", flag: "random" });
add("en", ["natively", "native"], { k: "flag", flag: "native" });
add("tr", ["dogal olarak", "yerel olarak"], { k: "flag", flag: "native" });
add("en", ["mirror"], { k: "flag", flag: "mirror" });
add("en", ["canonical", "officially"], { k: "flag", flag: "canonical" });

add("en", ["positions", "all positions", "all my positions", "every position", "my positions"], { k: "scope", what: "positions" });
add("en", ["position", "my position", "the position", "trade"], { k: "scope", what: "position" });
add("en", ["orders", "all orders", "all my orders", "open orders", "my orders", "all open orders", "order"], { k: "scope", what: "orders" });
add("en", ["everything", "all of it everything"], { k: "scope", what: "everything" });
add("tr", ["pozisyon", "pozisyonu", "pozisyonum", "pozisyonumu", "pozisyonda", "pozisyondan", "pozisyonuma", "pozisyonumdan"], { k: "scope", what: "position" });
add("tr", ["pozisyonlar", "pozisyonlari", "pozisyonlarim", "pozisyonlarimi", "tum pozisyonlari", "tum pozisyonlarimi", "butun pozisyonlari", "butun pozisyonlarimi", "tum pozisyonlar", "acik pozisyonlari", "acik pozisyonlarimi"], { k: "scope", what: "positions" });
add("tr", ["emir", "emri", "emirler", "emirleri", "emirlerim", "emirlerimi", "tum emirleri", "tum emirlerimi", "butun emirleri", "butun emirlerimi", "acik emirleri", "acik emirlerimi", "emirlerini"], { k: "scope", what: "orders" });
add("tr", ["her seyi", "hersey", "her sey"], { k: "scope", what: "everything" });

/* --------------------------------------------------- amounts and roles */

add("en", ["half", "half of", "a half", "half of my", "50 percent of"], { k: "qty", q: "half" });
add("en", ["all", "all of", "all my", "max", "maximum", "entire", "the entire", "whole", "my whole", "the whole", "everything i have", "all of my"], { k: "qty", q: "all" });
add("en", ["a quarter", "quarter", "a quarter of", "quarter of"], { k: "qty", q: "quarter" });
add("en", ["a third", "a third of", "third of"], { k: "qty", q: "third" });
add("en", ["the rest", "rest", "the remaining", "remaining", "the remainder", "the rest of it"], { k: "qty", q: "rest" });
add("tr", ["yarim", "yariya", "yarisi", "yarisini", "yarisiyla", "yarisi ile", "yarisina", "yari", "yarisinin"], { k: "qty", q: "half" });
add("tr", ["hepsi", "hepsini", "hepsiyle", "tumu", "tumunu", "tumuyle", "tamami", "tamamini", "tamamiyla", "tum", "butun", "maksimum", "max", "tumunu birden"], { k: "qty", q: "all" });
add("tr", ["ceyrek", "ceyregi", "ceyregini", "dortte biri", "dortte birini"], { k: "qty", q: "quarter" });
add("tr", ["ucte biri", "ucte birini"], { k: "qty", q: "third" });
add("tr", ["kalan", "kalani", "kalanini", "geri kalan", "geri kalani", "geri kalanini", "kalaniyla", "geri kalaniyla"], { k: "qty", q: "rest" });

add("en", ["to", "into", "over to", "onto", "for", "towards", "back to", "in to"], { k: "prep", role: "to" });
add("en", ["from", "out of", "off"], { k: "prep", role: "from" });
add("en", ["on", "in", "via", "through", "inside", "over on"], { k: "prep", role: "on" });
add("en", ["with", "using", "paying with", "paid with"], { k: "prep", role: "with" });
add("en", ["worth", "worth of"], { k: "prep", role: "worth" });
add("en", ["at", "@", "at a price of", "at price"], { k: "prep", role: "at" });
add("en", ["by"], { k: "prep", role: "by" });
add("en", ["of"], { k: "prep", role: "of" });
add("en", ["per", "each"], { k: "prep", role: "per" });
add("en", ["over", "during", "spread over", "across"], { k: "prep", role: "over" });
add("tr", ["ile", "kullanarak"], { k: "prep", role: "with" });
add("tr", ["uzerinden", "araciligiyla", "icinde", "uzerinde"], { k: "prep", role: "on" });
add("tr", ["fiyatindan", "seviyesinden", "fiyattan", "fiyatla"], { k: "prep", role: "at" });
add("tr", ["degerinde", "tutarinda", "karsiligi"], { k: "prep", role: "worth" });
add("tr", ["basina"], { k: "prep", role: "per" });
add("tr", ["olarak"], { k: "noise" });

add("en", ["then", "and then", "after that", "afterwards", "next", "followed by", "and after that"], { k: "conn", c: "then" });
add("en", ["and", "also", "plus", "as well as"], { k: "conn", c: "and" });
add("tr", ["sonra", "ardindan", "daha sonra", "sonrasinda", "ondan sonra", "akabinde", "sonra da"], { k: "conn", c: "then" });
add("tr", ["ve", "ayrica", "bir de", "hem de"], { k: "conn", c: "and" });

add("en", ["usd", "usd worth", "dollars", "dollar", "bucks", "dollars worth", "dollars of", "usd of"], { k: "usd" });
add("tr", ["dolar", "usd", "dolarini"], { k: "usd" });
add("tr", ["dolarlik", "dolarlikla", "usdlik", "dolar degerinde"], { k: "usd", worth: true });
add("en", ["percent", "pct", "per cent"], { k: "pctword" });
add("tr", ["yuzde"], { k: "pctword" });
add("en", ["me", "myself", "my wallet", "my address", "my own wallet"], { k: "self" });
add("tr", ["kendime", "kendi cuzdanima", "cuzdanima", "kendi adresime"], { k: "self" });

/* -------------------------------------------------- rules and alerts */

add("en", ["if", "when", "once", "as soon as", "if ever", "in case"], { k: "cond" });
add("en", ["whenever", "every time", "each time", "anytime"], { k: "cond", repeat: true });
add("tr", ["eger", "egerki"], { k: "cond" });
add("tr", ["her ne zaman", "her seferinde"], { k: "cond", repeat: true });

add("en", ["below", "under", "less than", "lower than", "<", "drops below", "drops under", "falls below", "falls under", "goes below", "dips below", "is below", "is under", "gets below", "is less than", "goes under", "dips under", "trades below", "is lower than", "drops to", "falls to", "dips to"], { k: "cmp", op: "<" });
add("en", ["<=", "at most", "or less", "or lower"], { k: "cmp", op: "<=" });
add("en", ["above", "over", "more than", "greater than", "higher than", ">", "rises above", "goes above", "is above", "gets above", "climbs above", "breaks above", "is over", "goes over", "exceeds", "is more than", "is greater than", "is higher than", "trades above", "rises to", "climbs to", "pumps to", "pumps above"], { k: "cmp", op: ">" });
add("en", [">=", "at least", "or more", "or higher"], { k: "cmp", op: ">=" });
add("en", ["crosses above", "crosses over", "breaks out above"], { k: "cmp", op: "crossesAbove" });
add("en", ["crosses below", "crosses under", "breaks below", "breaks down below"], { k: "cmp", op: "crossesBelow" });
add("en", ["hits", "reaches", "touches", "gets to", "is at", "equals", "=", "is", "goes to", "hit", "reach"], { k: "cmp", op: "=" });
add("en", ["goes negative", "turns negative", "flips negative", "is negative", "becomes negative"], { k: "cmp", op: "neg" });
add("en", ["goes positive", "turns positive", "flips positive", "is positive", "becomes positive"], { k: "cmp", op: "pos" });
add("tr", ["altina", "altinda", "asagisina", "asagisinda", "asagida", "asagiya", "altinda bir"], { k: "cmp", op: "<" });
add("tr", ["altina duserse", "altina inerse", "altina gerilerse", "altina dustugunde", "altina inince", "altina dusunce", "altina gelirse", "altina iner", "altinda olursa", "altindaysa", "asagisina duserse", "asagisina inerse"], { k: "cmp", op: "<", ends: true });
add("tr", ["ustune", "ustunde", "uzerine", "uzeri", "ustu", "yukarisina", "yukarisinda", "yukarida", "yukariya"], { k: "cmp", op: ">" });
add("tr", ["ustune cikarsa", "uzerine cikarsa", "ustune cikinca", "uzerine cikinca", "ustune ciktiginda", "uzerine ciktiginda", "uzerine gecerse", "ustune gecerse", "ustunde olursa", "uzerinde olursa", "ustundeyse", "uzerindeyse", "yukarisina cikarsa"], { k: "cmp", op: ">", ends: true });
add("tr", ["negatif olursa", "negatife duserse", "eksiye duserse", "negatif oldugunda", "negatife donerse", "eksiye gecerse"], { k: "cmp", op: "neg", ends: true });
add("tr", ["pozitif olursa", "pozitife donerse", "artiya gecerse", "pozitif oldugunda"], { k: "cmp", op: "pos", ends: true });
add("tr", ["duserse", "inerse", "gerilerse", "dustugunde", "indiginde", "dusunce", "inince", "kucukse", "kucuk olursa", "daha dusukse", "altindaysa", "altinda olursa"], { k: "condEnd", op: "<" });
add("tr", ["cikarsa", "yukselirse", "gecerse", "asarsa", "ciktiginda", "yukseldiginde", "gectiginde", "astiginda", "cikinca", "gecince", "buyukse", "buyuk olursa", "daha yuksekse", "ustundeyse", "uzerindeyse", "ustunde olursa", "uzerinde olursa"], { k: "condEnd", op: ">" });
add("tr", ["olursa", "gelirse", "olunca", "gelince", "oldugunda", "geldiginde", "vurursa", "degerse", "ulasirsa", "ulastiginda"], { k: "condEnd", op: "=" });
add("tr", ["olursa ve", "ise"], { k: "condEnd" });

add("en", ["price", "the price", "price of", "the price of", "spot price", "prices"], { k: "metric", metric: "price" });
add("en", ["mark price", "the mark price"], { k: "metric", metric: "mark" });
add("en", ["oracle", "oracle price"], { k: "metric", metric: "oracle" });
add("en", ["funding", "funding rate", "the funding", "the funding rate", "funding rates"], { k: "metric", metric: "funding" });
add("en", ["oi", "open interest", "the open interest"], { k: "metric", metric: "openInterest" });
add("en", ["pnl", "p&l", "profit", "profits", "unrealized pnl", "upnl", "my pnl", "pnl of"], { k: "metric", metric: "pnl" });
add("en", ["roe"], { k: "metric", metric: "roe" });
add("en", ["liq distance", "liquidation distance", "distance to liquidation"], { k: "metric", metric: "liqDistance" });
add("en", ["health factor", "hf"], { k: "metric", metric: "healthFactor" });
add("en", ["apy", "yield", "apr", "the apy", "the yield"], { k: "metric", metric: "apy" });
add("tr", ["fiyat", "fiyati", "fiyatin", "fiyatini", "fiyatinin", "fiyatlari", "kuru", "degeri"], { k: "metric", metric: "price" });
add("tr", ["fonlama", "fonlama orani", "fonlamasi", "funding orani", "fonlama oranini", "fonlamasini"], { k: "metric", metric: "funding" });
add("tr", ["acik pozisyon miktari", "oi", "acik faiz"], { k: "metric", metric: "openInterest" });
add("tr", ["kar zarar", "kar/zarar", "kar", "pnl", "karim", "zararim", "kar zararim", "kar zararimi", "karimi"], { k: "metric", metric: "pnl" });
add("tr", ["getiri", "getirisi", "apy", "faiz", "faizi"], { k: "metric", metric: "apy" });
add("tr", ["saglik faktoru"], { k: "metric", metric: "healthFactor" });

add("en", ["per hour", "an hour", "hourly rate", "/h", "/hr", "1h", "per 1h"], { k: "period", period: "1h" });
add("en", ["per 8h", "per 8 hours", "8h", "/8h", "every 8 hours rate", "8-hour", "8 hour"], { k: "period", period: "8h" });
add("en", ["apr", "annualized", "annual", "yearly", "per year", "a year"], { k: "period", period: "apr" });
add("tr", ["saat basi", "saatte", "saatlik oran"], { k: "period", period: "1h" });
add("tr", ["8 saatlik", "8 saatte"], { k: "period", period: "8h" });
add("tr", ["yillik", "yillik bazda"], { k: "period", period: "apr" });

add("en", ["cap", "capped at", "max per run", "per run cap", "budget", "at most per run", "spending cap", "cap of"], { k: "flag", flag: "cap" });
add("tr", ["en fazla", "azami", "tavan", "limiti", "butce", "butcesi"], { k: "flag", flag: "cap" });
add("en", ["per run", "each run", "a run", "per execution"], { k: "noise" });
add("tr", ["calisma basina", "her calismada", "her seferde"], { k: "noise" });
add("both", ["telegram", "on telegram", "via telegram", "telegramdan", "telegrama", "tg"], { k: "flag", flag: "telegram" });
add("en", ["in the app", "on the web", "in app", "in browser"], { k: "flag", flag: "web" });
add("en", ["slippage", "max slippage", "slippage of", "with slippage"], { k: "flag", flag: "slippage" });
add("tr", ["kayma", "slippage", "maksimum kayma", "en fazla kayma"], { k: "flag", flag: "slippage" });
add("en", ["until", "till", "ending", "expiring", "until the"], { k: "until" });
add("tr", ["kadar sur", "tarihine kadar", "e kadar", "a kadar"], { k: "until" });

/* -------------------------------------------------------------- queries */

add("en", ["what", "what's", "whats", "what is", "what are", "how much", "how many", "how is", "how's", "where", "where is", "which", "how much is", "what's the", "what is the", "tell me about"], { k: "query" });
add("en", ["balance", "balances", "my balance", "my balances", "holdings", "my holdings", "my bags", "do i have", "do i own", "i have", "i hold", "do i hold", "how much do i have"], { k: "query", what: "balance" });
add("en", ["portfolio", "my portfolio", "net worth", "my net worth"], { k: "query", what: "portfolio" });
add("en", ["liq price", "liquidation price", "liquidation", "my liq price", "liq"], { k: "query", what: "liqPrice" });
add("en", ["safe", "is it safe", "a scam", "legit", "safety", "rug", "a rug", "risky"], { k: "query", what: "safety" });
add("en", ["whales", "whale", "whale trades"], { k: "query", what: "whales" });
add("tr", ["ne", "nedir", "ne kadar", "kac", "kac tane", "neler", "nasil", "ne durumda", "mi", "mu", "var mi", "nerede", "hangi", "kac para"], { k: "query" });
add("tr", ["bakiye", "bakiyem", "bakiyemi", "bakiyeler", "bakiyelerim", "varliklarim", "varliklarimi", "elimde ne var", "neyim var"], { k: "query", what: "balance" });
add("tr", ["portfoy", "portfoyum", "portfoyumu", "toplam degerim", "net degerim"], { k: "query", what: "portfolio" });
add("tr", ["likidasyon fiyati", "likidasyon fiyatim", "likidasyon", "liq fiyati", "likit fiyati", "likidasyon fiyatimi"], { k: "query", what: "liqPrice" });
add("tr", ["guvenli", "guvenilir", "guvenli mi", "scam mi", "dolandirici mi", "risk"], { k: "query", what: "safety" });
add("tr", ["balinalar", "balina"], { k: "query", what: "whales" });

/* -------------------------------------------------------------- noise */

add("en", [
  "please", "pls", "plz", "kindly", "my", "the", "a", "an", "i", "want", "i want", "i want to", "i'd like to", "id like to", "i would like to", "i wanna", "wanna", "i need to", "need to", "can you",
  "could you", "would you", "can i", "just", "now", "right now", "immediately", "asap", "for me", "it", "them", "that", "this", "those", "these", "token", "tokens", "coin", "coins",
  "go ahead and", "let's", "lets", "let us", "quickly", "hey", "hi", "elyia", "guide", "ok", "okay", "back", "up", "funds", "money", "some", "of my", "account", "wallet",
  "please do", "thanks", "thank you", "do", "position on", "a position", "new", "fresh", "be", "get", "also please", "in my", "worth of my", "currently", "current", "today", "instantly", "for",
  "there", "please?", "pair", "have", "do i", "am i", "is my", "are my", "currently have", "much", "right", "shares", "units", "amount", "an amount of", "totally", "real quick",
], { k: "noise" });
add("tr", [
  "lutfen", "benim", "istiyorum", "hemen", "simdi", "su an", "suan", "tane", "adet", "biraz", "bi", "acaba", "rica etsem", "bunu", "bunlari", "onu", "onlari", "da", "de", "ki", "bu",
  "su", "o", "icin", "bana", "beni", "token", "tokeni", "coin", "coini", "hesabim", "hesap", "hesabimdaki", "cuzdanimdaki", "elimdeki", "mevcut", "olan", "yeni", "tamam", "hadi",
  "lutfen hemen", "elyia", "rehber", "hizlica", "bugun", "tokenimi", "tokenlarimi", "coinlerimi", "cuzdanim", "cuzdan", "param", "paramin", "parami", "kadar", "kadarini", "toplam",
  "miktar", "miktarda", "bir", "geri", "bakalim", "adresine", "adresime", "adrese", "adresi", "cuzdanina", "cuzdana", "yapmak", "etmek", "istiyoruz", "et", "edin", "eder misin", "misin", "musun", "miyim", "acil", "dogrudan", "direkt",
], { k: "noise" });
add("tr", ["var", "elimde var", "kac tane var"], { k: "query", what: "balance" });

add("en", ["don't", "dont", "do not", "never", "not", "no", "without", "stop doing", "don't ever"], { k: "neg" });
add("tr", ["yapma", "etme", "kapatma", "alma", "satma", "degil", "asla", "hayir", "gonderme", "acma", "cevirme", "koprulme", "iptal etme", "istemiyorum"], { k: "neg" });

/* ------------------------------------------------------------- venues */

for (const venue of VENUE_WORDS) add("both", venue.words, { k: "venue", id: venue.id });

/* ----------------------------------------------------------- networks */

add("both", ["elysium", "ely", "elysium chain", "elysium network", "elysium testnet", "elysium l2", "the summit", "summit", "elysiumda"], { k: "network", family: "elysium" });
add("both", ["hyperevm", "hyper evm", "hevm", "evm", "hyperliquid evm", "hl evm", "hyperevm chain", "the ridge", "ridge"], { k: "network", family: "hyperevm" });
add("both", ["hypercore", "hyper core", "core", "the floor", "floor", "hl core", "hyperliquid core"], { k: "network", family: "hypercore" });
add("both", ["hyperliquid", "hl"], { k: "network", family: "hyperliquid" });
add("en", ["perp account", "perps account", "perp wallet", "margin account", "trading account", "futures account", "my perps", "perp balance"], { k: "account", cls: "perp" });
add("en", ["spot account", "spot wallet", "spot balance", "my spot"], { k: "account", cls: "spot" });
add("tr", ["perp hesabi", "perp hesabim", "perp hesabimdaki", "perp hesabimda", "vadeli hesabim", "perpse"], { k: "account", cls: "perp" });
add("tr", ["perp hesabina", "perp hesabima", "vadeli hesaba", "vadeli hesabina", "vadeli hesabima", "perpe", "perplere"], { k: "account", cls: "perp", role: "to" });
add("tr", ["perp hesabimdan", "perp hesabindan", "vadeli hesabindan", "vadeli hesabimdan", "perpten"], { k: "account", cls: "perp", role: "from" });
add("tr", ["spot hesabi", "spot hesabim", "spot hesabimdaki", "spot hesabimda", "spottaki", "spotta"], { k: "account", cls: "spot" });
add("tr", ["spot hesabina", "spot hesabima", "spota"], { k: "account", cls: "spot", role: "to" });
add("tr", ["spot hesabimdan", "spot hesabindan", "spottan"], { k: "account", cls: "spot", role: "from" });

/* --------------------------------------------------------------- index */

const MAX_PHRASE = 5;

function build(locale: Locale): ReadonlyMap<string, Template> {
  const map = new Map<string, Template>();
  // Shared entries first, then the locale's own (which win); within one scope the first entry of a phrase wins.
  for (const pass of ["both", locale] as const) {
    const seen = new Set<string>();
    for (const [scope, phrase, template] of ENTRIES) {
      if (scope !== pass || seen.has(phrase)) continue;
      seen.add(phrase);
      map.set(phrase, template);
    }
  }
  return map;
}

const TABLES: Readonly<Record<Locale, ReadonlyMap<string, Template>>> = { en: build("en"), tr: build("tr") };

/** The template of a folded phrase in the locale, or null. */
export function lookup(phrase: string, locale: Locale): Template | null {
  return TABLES[locale].get(phrase) ?? null;
}

export function maxPhraseWords(): number {
  return MAX_PHRASE;
}

/** Every folded single word of a locale's verbs (typo candidates). */
export function verbWords(locale: Locale): ReadonlyMap<string, Verb> {
  const out = new Map<string, Verb>();
  for (const [phrase, template] of TABLES[locale]) {
    if (template.k === "verb" && !phrase.includes(" ") && !template.chain && phrase.length >= 4) out.set(phrase, template.verb);
  }
  return out;
}

/** Folded words that only Turkish uses (locale detection). */
export function isTurkishWord(word: string): boolean {
  return TABLES.tr.has(word) && !TABLES.en.has(word);
}

export function isEnglishWord(word: string): boolean {
  return TABLES.en.has(word) && !TABLES.tr.has(word);
}

export type { Template };
