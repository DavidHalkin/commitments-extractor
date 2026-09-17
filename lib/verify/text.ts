export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

export function containsPhrase(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  return ` ${normalize(haystack)} `.includes(` ${n} `);
}

export function fuzzyContainsPhrase(haystack: string, needle: string, maxEdits?: number): boolean {
  const nt = tokens(needle);
  if (!nt.length) return false;
  const n = nt.join(" ");
  const allowed = maxEdits ?? Math.min(2, Math.floor(n.length / 6));
  const ht = tokens(haystack);
  for (let i = 0; i + nt.length <= ht.length; i++) {
    if (levenshtein(ht.slice(i, i + nt.length).join(" "), n) <= allowed) return true;
  }
  return false;
}

export type WordSpan = { first: number; last: number };

/** Tokens that flip or soften a commitment; a non-exact quote match may not introduce one absent from the quote. */
export const NEGATIONS = new Set([
  "not",
  "no",
  "never",
  "dont",
  "cant",
  "wont",
  "cannot",
  "isnt",
  "arent",
  "doesnt",
  "didnt",
  "shouldnt",
  "wouldnt",
  "couldnt",
]);
export const HEDGES = new Set(["could", "maybe", "might", "perhaps", "probably"]);

/** Phrases that postpone an item by themselves. */
const DEFERRAL_PHRASES = [
  "pick this up",
  "pick it up",
  "pick that up",
  "come back to",
  "revisit",
  "postpone",
  "put it off",
  "put this off",
  "table it",
  "park it",
];
/** A verb about deciding or discussing plus a postponing marker also defers: "let's decide later". */
const DEFERRAL_VERBS = new Set(["decide", "discuss", "talk", "figure", "sort", "settle", "pick", "revisit"]);
const POSTPONE_MARKERS = ["later", "another time", "next time", "some other time"];

/** True when the text postpones the decision or the discussion instead of settling it. */
export function isDeferral(text: string): boolean {
  if (DEFERRAL_PHRASES.some((p) => containsPhrase(text, p))) return true;
  const defersDecision = tokens(text).some((tok) => DEFERRAL_VERBS.has(tok));
  return defersDecision && POSTPONE_MARKERS.some((m) => containsPhrase(text, m));
}

export function findQuoteSpan(
  quote: string,
  words: { punctuated: string }[],
  minSimilarity = 0.9,
): WordSpan | null {
  const q = tokens(quote);
  if (!q.length) return null;
  const qSet = new Set(q);
  const flat: { tok: string; wordIndex: number }[] = [];
  words.forEach((w, wordIndex) => tokens(w.punctuated).forEach((tok) => flat.push({ tok, wordIndex })));
  const qs = q.join(" ");
  let best: { span: WordSpan; score: number } | null = null;
  // Window sizes around the quote length absorb contractions such as "I'll" vs "I will".
  for (let size = Math.max(1, q.length - 1); size <= q.length + 1; size++) {
    for (let i = 0; i + size <= flat.length; i++) {
      const win = flat.slice(i, i + size);
      const ws = win.map((x) => x.tok).join(" ");
      const isExact = ws === qs;
      if (!isExact) {
        const addsNegationOrHedge = win.some((x) => (NEGATIONS.has(x.tok) || HEDGES.has(x.tok)) && !qSet.has(x.tok));
        if (addsNegationOrHedge) continue;
      }
      const score = isExact ? 1 : similarity(ws, qs);
      if (score >= minSimilarity && (!best || score > best.score)) {
        best = { span: { first: win[0].wordIndex, last: win[win.length - 1].wordIndex }, score };
      }
    }
  }
  return best?.span ?? null;
}
