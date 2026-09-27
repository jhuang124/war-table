// Structural sharing for the ViewModel: returns `prev` (same identity) wherever `next` is deeply
// equal, so the UI can skip unchanged subtrees with a plain `===`.

export function reconcile<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') {
    return Object.is(prev, next) ? prev : next;
  }
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const p = prev as unknown as unknown[];
    let same = p.length === next.length;
    const out = next.map((v, i) => {
      const r = i < p.length ? reconcile(p[i], v) : v;
      if (r !== p[i]) same = false;
      return r;
    });
    return (same ? prev : out) as unknown as T;
  }
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const r = k in p ? reconcile(p[k], n[k]) : n[k];
    if (r !== p[k]) same = false;
    out[k] = r;
  }
  return (same ? prev : out) as T;
}
