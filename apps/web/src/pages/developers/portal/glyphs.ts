/**
 * The portal's 9 x 9 pixel glyphs, ported verbatim from the v2 mockup
 * (elyia-design/v2/src/engine.js). Keys: i ink · a accent · s sun · S sun
 * light · o sun shade · d rope red · u up green · w card · r ridge · f floor ·
 * m muted · k on-accent. "." is transparent.
 */
import type { GlyphRows } from "../../../pixel/glyphs";

export const PORTAL_GLYPHS = {
  anchor: ['...iii...', '...i.i...', '...iii...', '.iiiiiii.', '....i....', 'i...i...i', 'ii..i..ii', '.ii.i.ii.', '..iiiii..'],
  coin: ['..ooooo..', '.oSSssso.', 'oSssoosso', 'oSsosssso', 'osssoooso', 'osssssoso', 'oSsooosso', '.ossssso.', '..ooooo..'],
  rebalance: ['.........', '.aa......', '.aa......', '.aa.ff...', '.aa.ff.rr', '.aa.ff.rr', '.aa.ff.rr', '.aa.ff.rr', 'iiiiiiiii'],
  bolt: ['....ss...', '...ss....', '..ss.....', '.sssssss.', '.....ss..', '....ss...', '...ss....', '..ss.....', '.s.......'],
  shield: ['iiiiiiiii', 'iaaaaaaai', 'iaaaaaawi', 'iaaaaawai', 'iawaawaai', '.iawwaai.', '.iaawaai.', '..iaaai..', '...iii...'],
  rope: ['...iii...', '..i...i..', '...iii...', '....d....', '....s....', '....d....', '....s....', '....d....', '...ddd...'],
  stairs: ['.......uu', '.......u.', '.....uuu.', '.....u...', '...uuu...', '...u.....', '.uuu.....', '.u.......', 'iiiiiiiii'],
  broom: ['.......r.', '......r..', '.....r...', '....r....', '..ssr....', '.sssss...', 'sssss....', 'ssss.....', 's.s.s....'],
  gas: ['.iiiii...', '.iwwwi.i.', '.iwwwi..i', '.iiiii..i', '.iaaai.ii', '.iaaai.i.', '.iaaaii..', '.iaaai...', 'iiiiiii..'],
  key: ['.........', '.sss.....', 's...s....', 's.o.sssss', 's...s.s.s', '.sss..s..', '.........', '.........', '.........'],
  hook: ['....aaa..', '...a...a.', '...a...a.', '....a..a.', '.......a.', '.a.....a.', '.a....a..', '..aaaa...', '.........'],
  plug: ['..i...i..', '..i...i..', '.iiiiiii.', '.iaaaaai.', '.iaaaaai.', '..iaaai..', '...iai...', '....i....', '....i....'],
  widget: ['iiiiiiiii', 'iiiiiiiii', 'iwwwwwwwi', 'iwaaawwwi', 'iwwwwwwwi', 'iwaaaaawi', 'iwwwwwwwi', 'iwsssswwi', 'iiiiiiiii'],
  percent: ['ss.....s.', 'ss....s..', '.....s...', '....s....', '...s.....', '..s......', '.s....ss.', 's.....ss.', '.........'],
  block: ['.iiiiiii.', 'iaaaaaaai', 'iawwwwwai', 'iaaaaaaai', 'iawwwaaai', 'iaaaaaaai', 'iawwwwaai', 'iaaaaaaai', '.iiiiiii.'],
  flag: ['i........', 'iddddd...', 'idddddd..', 'iddddd...', 'i........', 'i........', 'i........', 'i........', 'iii......'],
  swap: ['...a.....', '..aa.....', '.aaaaaaa.', '..aa.....', '...a.....', '.....r...', '.....rr..', '.rrrrrrr.', '.....rr..'],
  peak: ['....w....', '...waw...', '...aaa...', '..aaaaa..', '..aaaar..', '.aaaarrr.', '.aaarrrr.', 'aaarrrrrr', 'fffffffff'],
  bridge: ['.........', 'iiiiiiiii', '.i.i.i.i.', 'iiiiiiiii', '.i.....i.', '.i.....i.', 'fifffffif', 'fffffffff', 'fffffffff'],
  search: ['.iii.....', 'i...i....', 'i...i....', 'i...i....', '.iii.....', '....ii...', '.....ii..', '......ii.', '.........'],
  clock: ['..iiiii..', '.i.....i.', 'i...i...i', 'i...i...i', 'i...iii.i', 'i.......i', '.i.....i.', '..iiiii..', '.........'],
  send: ['....k....', '...kkk...', '..k.k.k..', '.k..k..k.', '....k....', '....k....', '....k....', '....k....', '.........'],
  chat: ['.iiiiiii.', 'i.......i', 'i.ii.ii.i', 'i.......i', 'i.iiii..i', 'i.......i', '.iiiiiii.', '..ii.....', '..i......'],
  book: ['iiii.iiii', 'iwwi.iwwi', 'iwwiiiwwi', 'iwwiwiwwi', 'iwwiwiwwi', 'iwwiwiwwi', 'iwwiwiwwi', 'iiiiwiiii', '....i....'],
  burger: ['.........', 'iiiiiiiii', '.........', '.........', 'iiiiiiiii', '.........', '.........', 'iiiiiiiii', '.........'],
  pulse: ['.........', '.........', '....i....', '...i.i...', 'iii...i.i', '.......i.', '.........', '.........', '.........'],
  eye: ['.........', '..iiiii..', '.i.....i.', 'i..aaa..i', 'i..aia..i', 'i..aaa..i', '.i.....i.', '..iiiii..', '.........'],
  pause: ['.........', '.dd...dd.', '.dd...dd.', '.dd...dd.', '.dd...dd.', '.dd...dd.', '.dd...dd.', '.dd...dd.', '.........'],
  tent: ['....i....', '...iai...', '..iaaai..', '..iawai..', '.iaawaai.', '.iawwwai.', 'iaawwwaai', 'iiiiiiiii', '.........'],
  people: ['.ii...ii.', 'iwwi.iwwi', 'iwwi.iwwi', '.ii...ii.', 'iaai.iaai', 'iaai.iaai', 'iaai.iaai', '.........', '.........'],
  wallet: ['.........', 'iiiiiiii.', 'irrrrrrri', 'irrrrriii', 'irrrrris.', 'irrrrriii', 'irrrrrrri', 'iiiiiiiii', '.........'],
  check: ['.........', '........u', '.......uu', '......uu.', 'u....uu..', 'uu..uu...', '.uuuu....', '..uu.....', '.........'],
  grid: ['iii.iii..', 'iai.iai..', 'iii.iii..', '.........', 'iii.iii..', 'isi.iai..', 'iii.iii..', '.........', '.........'],
  docs: ['.iiiiii..', '.iwwwwii.', '.iwiiwwi.', '.iwwwwwi.', '.iwiiiwi.', '.iwwwwwi.', '.iwiiiwi.', '.iwwwwwi.', '.iiiiiii.'],
  star: ['....s....', '....s....', '...sss...', 'sssssssss', '.sssssss.', '..sssss..', '..ss.ss..', '.ss...ss.', '.s.....s.'],
} as const satisfies Readonly<Record<string, GlyphRows>>;

export type PortalGlyphName = keyof typeof PORTAL_GLYPHS;

/** Glyph keys -> colours (tokens follow the sheet; the sun family stays fixed). */
export const PORTAL_GLYPH_PALETTE: Readonly<Record<string, string>> = {
  i: "--ink",
  a: "--accent",
  s: "#F2C200",
  S: "#FFE27A",
  o: "#B89100",
  d: "--down",
  u: "--up",
  w: "--card",
  r: "#B07A44",
  f: "#1E6B7D",
  m: "--ink-3",
  k: "--on-accent",
};
