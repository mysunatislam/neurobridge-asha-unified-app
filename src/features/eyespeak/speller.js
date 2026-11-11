// Eye typing: any word or sentence, letter by letter, with tiles big enough for the person's
// measured gaze accuracy. Letters come in groups (A–E, F–J …): one look opens a group, the next
// picks the letter, so every key stays as large as a board tile. Word suggestions finish a word
// in one more look. With accuracy for only two halves of the screen, the same letters are reached
// in steps of halves. On the 9-tile board every group also has a Back tile; on smaller boards
// there is no room, and closing the eyes for two seconds goes back instead.
// Pure logic, tested on its own in tests/eyespeak-speller.test.mjs.

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

/** Everyday and care words, most useful first, for suggestions. */
export const WORDS = (
  "i need water help please pain toilet food yes no thank you want my call come here nurse doctor medicine family " +
  "hungry thirsty tired sleep cold hot sick better okay good bad hurts head stomach chest back leg arm hand " +
  "love mother father son daughter wife husband brother sister friend home now later today tomorrow morning night " +
  "turn bed sit up down light off on open close window door phone tv music read wash bath clean change clothes " +
  "blanket pillow move position breathe air fan glass tea coffee milk juice rice bread apple banana egg soup " +
  "what when where who why how is am are can do not dont feel see hear go stop wait more less again sorry " +
  "the a an and to it in of for with me we they he she this that am feeling afraid happy sad lonely bored " +
  "visit talk listen pray prayer outside walk wheelchair glasses teeth hair itch dizzy sick vomit fever " +
  "appointment ambulance emergency apply application apartment appetite apples"
)
  .split(/\s+/)
  .filter((w, i, all) => w && all.indexOf(w) === i);

/** Starting words when no word has been begun yet. */
const STARTERS = ["i", "need", "please", "help", "water", "thank", "pain", "call"];

/** The word being typed: the letters after the last space. */
export function currentWord(text) {
  const m = /([a-z']*)$/i.exec(text);
  return m ? m[1] : "";
}

/** Words that finish what is being typed, best first. */
export function suggest(text, n = 6) {
  const w = currentWord(text).toLowerCase();
  if (!w) return STARTERS.slice(0, n);
  return WORDS.filter((x) => x.startsWith(w) && x !== w).slice(0, n);
}

/** The text after one action. Letters type lower case; a chosen word replaces the part typed. */
export function applyAct(text, act) {
  switch (act?.kind) {
    case "letter":
      return text + act.ch;
    case "space":
      return !text || text.endsWith(" ") ? text : text + " ";
    case "delete":
      return text.slice(0, -1);
    case "word": {
      const typed = currentWord(text);
      return text.slice(0, text.length - typed.length) + act.word + " ";
    }
    case "clear":
      return "";
    default:
      return text;
  }
}

/** How a message reads aloud and in a request: "i" becomes "I", a sentence starts with a capital. */
export function tidy(text) {
  const t = text.trim().replace(/\s+/g, " ").replace(/\bi\b/g, "I");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const key = (ch) => ({ id: `k-${ch}`, label: ch.toUpperCase(), bn: "", say: "", act: { kind: "letter", ch } });
const leaf = (id, label, bn, act) => ({ id, label, bn, say: "", act });
const group = (id, label, bn, options) => ({ id, label, bn, options });
const SPACE = leaf("k-space", "Space", "স্পেস", { kind: "space" });
const DELETE = leaf("k-delete", "Delete", "মুছুন", { kind: "delete" });
const SPEAK = leaf("k-speak", "Speak it", "বলুন", { kind: "speak" });
const SEND = leaf("k-send", "Send to caregiver", "পাঠান", { kind: "send" });
const CLEAR = leaf("k-clear", "Clear all", "সব মুছুন", { kind: "clear" });
const BACK = leaf("k-back", "Back", "ফিরে যান", { kind: "back" });
/** The same group with a Back tile at the end. */
const withBack = (g) => ("options" in g ? { ...g, options: [...g.options, BACK] } : g);

const range = (from, to) => LETTERS.slice(LETTERS.indexOf(from), LETTERS.indexOf(to) + 1).map(key);
const letterGroup = (from, to) => group(`g-${from}${to}`, `${from.toUpperCase()}–${to.toUpperCase()}`, "", range(from, to));

function words(text, n) {
  const list = suggest(text, n);
  if (!list.length) return leaf("g-words", "No word found", "শব্দ নেই", { kind: "none" });
  return group("g-words", "Words", "শব্দ", list.map((w) => leaf(`w-${w}`, w === "i" ? "I" : w, "", { kind: "word", word: w })));
}

/** Splits steps into two halves, again and again, until each half is a single step. */
function halves(steps, id) {
  if (steps.length === 1) return steps[0];
  const mid = Math.ceil(steps.length / 2);
  return group(id, labelFor(steps), "", [halves(steps.slice(0, mid), `${id}a`), halves(steps.slice(mid), `${id}b`)]);
}
function labelFor(steps) {
  const flat = steps.flatMap((s) => ("options" in s ? leaves(s) : [s]));
  const letters = flat.filter((s) => s.act?.kind === "letter");
  const rest = flat.filter((s) => s.act?.kind !== "letter");
  const span = letters.length ? (letters.length === 1 ? letters[0].label : `${letters[0].label}–${letters[letters.length - 1].label}`) : "";
  if (!rest.length) return span;
  const names = rest.slice(0, 2).map((s) => s.label.toLowerCase());
  const more = rest.length > 2 ? " and more" : "";
  return span ? `${span}, ${names.join(", ")}${more}` : `${names.join(", ")}${more}`.replace(/^./, (c) => c.toUpperCase());
}
const leaves = (s) => ("options" in s ? s.options.flatMap(leaves) : [s]);

/**
 * The typing board for an accuracy band: 9 tiles, 6 large tiles, or 2 halves chosen in steps.
 * Returns the top group; its options are the first screen. Suggestions follow the text.
 */
export function spellTree(size, text) {
  const groups = [letterGroup("a", "e"), letterGroup("f", "j"), letterGroup("k", "o"), letterGroup("p", "t"), letterGroup("u", "z")];
  if (size === 9) {
    const opts = [...groups, words(text, 6), SPACE, DELETE, group("g-done", "Speak or send", "বলুন বা পাঠান", [SPEAK, SEND, CLEAR])];
    return group("spell", "", "", opts.map(withBack));
  }
  if (size === 6) {
    return group("spell", "", "", [...groups, group("g-more", "Space, words and more", "আরও", [SPACE, DELETE, words(text, 6), SPEAK, SEND, CLEAR])]);
  }
  // Two halves: A to M on one side; N to Z, space, delete, words and sending on the other. The
  // words are halves too, so no screen ever shows more than two tiles.
  const w = words(text, 4);
  const wordSteps = "options" in w && w.options.length > 1 ? { ...halves(w.options, "g-words"), label: "Words", bn: "শব্দ" } : "options" in w ? w.options[0] : w;
  const extras = halves([SPACE, DELETE, wordSteps, SPEAK, SEND, CLEAR], "g-x");
  return group("spell", "", "", [halves(range("a", "m"), "g-am"), halves([...range("n", "z"), extras], "g-nz")]);
}

/** The group reached by following `path` (group ids) from `root`. */
export function walk(root, path) {
  let node = root;
  for (const id of path) {
    const next = node.options.find((o) => o.id === id);
    if (!next || !("options" in next)) break;
    node = next;
  }
  return node;
}

/** Group ids to open, then the leaf id, to reach a target (a letter "p", "space", or "w-apple"). */
export function route(root, targetId) {
  const find = (node, trail) => {
    for (const o of node.options) {
      if (o.id === targetId) return [...trail, o.id];
      if ("options" in o) {
        const r = find(o, [...trail, o.id]);
        if (r) return r;
      }
    }
    return null;
  };
  return find(root, []);
}
