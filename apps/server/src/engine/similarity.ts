/** A port of Python difflib's SequenceMatcher.ratio(), so the fuzzy entity
 * resolver keeps the exact thresholds it was tuned with (0.84 cutoff).
 *
 * ratio = 2*M / (len(a)+len(b)) where M is the total size of matching blocks
 * found by recursively taking the longest matching substring (no autojunk —
 * inputs here are short name spans).
 */

function longestMatch(
  a: string, b: string, alo: number, ahi: number, blo: number, bhi: number,
  b2j: Map<string, number[]>,
): [number, number, number] {
  let besti = alo, bestj = blo, bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    for (const j of b2j.get(a[i]!) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  return [besti, bestj, bestsize];
}

export function ratio(a: string, b: string): number {
  if (a.length + b.length === 0) return 1;
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j]!;
    const list = b2j.get(ch);
    if (list) list.push(j);
    else b2j.set(ch, [j]);
  }
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi, b2j);
    if (k === 0) continue;
    matches += k;
    queue.push([alo, i, blo, j], [i + k, ahi, j + k, bhi]);
  }
  return (2 * matches) / (a.length + b.length);
}

/** difflib's quick_ratio — an upper bound on ratio(), used to prune cheaply. */
export function quickRatio(a: string, b: string): number {
  if (a.length + b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const ch of b) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let matches = 0;
  for (const ch of a) {
    const n = counts.get(ch) ?? 0;
    if (n > 0) {
      matches += 1;
      counts.set(ch, n - 1);
    }
  }
  return (2 * matches) / (a.length + b.length);
}
