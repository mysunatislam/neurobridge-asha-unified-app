// Eye typing (src/features/eyespeak/speller.js): letters in groups sized for the person's gaze
// accuracy, word suggestions, and what each key does to the message.
//   node --test tests/eyespeak-speller.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { WORDS, applyAct, currentWord, route, spellTree, suggest, tidy, walk } from "../src/features/eyespeak/speller.js";

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const leaves = (s) => ("options" in s ? s.options.flatMap(leaves) : [s]);
const groups = (s) => ("options" in s ? [s, ...s.options.flatMap(groups)] : []);

test("every board reaches all 26 letters, space, delete, speaking and sending", () => {
  for (const size of [9, 6, 2]) {
    const ids = leaves(spellTree(size, "")).map((s) => s.id);
    for (const ch of LETTERS) assert.ok(ids.includes(`k-${ch}`), `size ${size} has ${ch}`);
    for (const id of ["k-space", "k-delete", "k-speak", "k-send", "k-clear"]) assert.ok(ids.includes(id), `size ${size} has ${id}`);
  }
});

test("no screen shows more tiles than the person's accuracy allows", () => {
  for (const [size, max] of [[9, 9], [6, 6], [2, 2]]) {
    for (const text of ["", "a", "app", "zzz"]) {
      for (const g of groups(spellTree(size, text))) assert.ok(g.options.length <= max, `size ${size}, ${g.id} has ${g.options.length} tiles`);
    }
  }
});

test("ids are unique within each board", () => {
  for (const size of [9, 6, 2]) {
    const ids = groups(spellTree(size, "a")).map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, `size ${size}`);
  }
});

test("9 tiles: a look opens A–E, the next picks the letter, and Back is there to go back", () => {
  const root = spellTree(9, "");
  assert.deepEqual(root.options.map((o) => o.label), ["A–E", "F–J", "K–O", "P–T", "U–Z", "Words", "Space", "Delete", "Speak or send"]);
  assert.deepEqual(route(root, "k-p"), ["g-pt", "k-p"]);
  assert.deepEqual(walk(root, ["g-ae"]).options.map((o) => o.label), ["A", "B", "C", "D", "E", "Back"]);
  assert.deepEqual(walk(root, ["g-done"]).options.map((o) => o.id), ["k-speak", "k-send", "k-clear", "k-back"]);
});

test("6 large tiles: five letter groups and More; no Back tile (no room), eyes closed goes back", () => {
  const root = spellTree(6, "");
  assert.deepEqual(root.options.map((o) => o.id), ["g-ae", "g-fj", "g-ko", "g-pt", "g-uz", "g-more"]);
  assert.ok(!leaves(root).some((s) => s.id === "k-back"));
  assert.deepEqual(route(root, "k-space"), ["g-more", "k-space"]);
});

test("2 halves: each letter is a few looks, half by half, and the labels say what each half holds", () => {
  const root = spellTree(2, "");
  assert.equal(root.options.length, 2);
  assert.equal(root.options[0].label, "A–M");
  assert.match(root.options[1].label, /^N–Z, space, delete and more$/);
  const a = route(root, "k-a");
  assert.equal(a.at(-1), "k-a");
  assert.ok(a.length <= 5, `A is ${a.length} looks`);
  for (const ch of LETTERS) assert.ok(route(root, `k-${ch}`).length <= 6, `${ch} within 6 looks`);
});

test("typing apple: letter by letter, or A then the suggestion", () => {
  let text = "";
  for (const ch of "apple") {
    const root = spellTree(9, text);
    const path = route(root, `k-${ch}`);
    assert.equal(path.length, 2, `${ch} is two looks`);
    text = applyAct(text, walk(root, path.slice(0, -1)).options.find((o) => o.id === path.at(-1)).act);
  }
  assert.equal(text, "apple");

  const root = spellTree(9, "a");
  const words = walk(root, ["g-words"]).options.map((o) => o.label);
  assert.ok(words.includes("apple"), `after A the words include apple (${words.join(", ")})`);
  assert.equal(applyAct("a", { kind: "word", word: "apple" }), "apple ");
});

test("suggestions finish the word being typed, most useful first", () => {
  assert.deepEqual(suggest("", 3), ["i", "need", "please"]);
  assert.deepEqual(suggest("i need wa", 2), ["water", "want"]);
  assert.ok(!suggest("water").includes("water"), "not the word already typed");
  assert.deepEqual(suggest("xq"), []);
  assert.equal(walk(spellTree(9, "xq"), []).options.find((o) => o.id === "g-words").label, "No word found");
  assert.equal(new Set(WORDS).size, WORDS.length);
  assert.equal(currentWord("i need wa"), "wa");
});

test("keys change the message as expected", () => {
  assert.equal(applyAct("", { kind: "letter", ch: "a" }), "a");
  assert.equal(applyAct("", { kind: "space" }), "", "no leading space");
  assert.equal(applyAct("hi ", { kind: "space" }), "hi ", "no double space");
  assert.equal(applyAct("hi", { kind: "delete" }), "h");
  assert.equal(applyAct("i need wa", { kind: "word", word: "water" }), "i need water ");
  assert.equal(applyAct("i need", { kind: "clear" }), "");
  assert.equal(applyAct("i", { kind: "none" }), "i");
  assert.equal(tidy(" i need  water "), "I need water");
  assert.equal(tidy("apple"), "Apple");
  assert.equal(tidy(""), "");
});
