// Does every figure in the answer come from the data? Log only (BI_GROUNDING=off|log): it never changes or blocks the
// answer, it counts figures that match nothing Genie returned, so a rise in that count can be noticed and looked into.
//
// Allowed values: every number in each Genie result of the turn (its summary text, the rows the model saw and the rows
// kept for the UI), plus values derived from the first DERIVE_LIMIT numbers of the rows: the sum, difference, ratio and
// percent change of each pair, and each value's share of its column total. The derivations are bounded so a big
// result costs at most a few thousand comparisons; a figure computed from more than two values is not covered.
// A figure matches when it equals an allowed value at the precision it is written with ("492.2M" matches 492,215,330),
// or is within 0.5% of it.
import type { GenieResult, HistoryTurn } from '../../contracts';

export type Figure = { raw: string; value: number; decimals: number; scale: number; percent: boolean };
export type Grounding = { checked: number; ungrounded: number; values: string[] };

const DERIVE_LIMIT = 60;
const TOLERANCE = 0.005;
const SCALES: Record<string, number> = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9 };
// Optional sign, optional currency, digits with thousands separators, decimals, then %, or a K/M/B suffix.
const NUMBER = /(?<![\w.])([-−–]?)\s?[$€£¥]?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|(?:bn|mn|[kmb])(?![a-z]))?/gi;
const LIST_MARKER = /^\s*(\d{1,2})[.)]\s/gm;

export function extractFigures(text: string): Figure[] {
  const listed = new Set<number>();
  for (const m of text.matchAll(LIST_MARKER)) listed.add(m.index + m[0].indexOf(m[1]));
  const figures: Figure[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const [raw, sign, whole, fraction = '', suffix = ''] = m;
    if (listed.has(m.index + raw.indexOf(whole))) continue; // "1." starting a list item
    const unit = suffix.toLowerCase();
    const plain = Number(`${whole.replace(/,/g, '')}${fraction}`);
    if (!unit && !fraction && Number.isInteger(plain) && plain >= 1900 && plain <= 2100 && !whole.includes(',')) continue; // a year
    const scale = SCALES[unit] ?? 1;
    figures.push({ raw: raw.trim(), value: (sign ? -1 : 1) * plain * scale, decimals: fraction ? fraction.length - 1 : 0, scale, percent: unit === '%' });
  }
  return figures;
}

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || !/^\s*-?[\d,]*\.?\d+\s*$/.test(v)) return undefined;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

// Every value an answer may state for this turn's results.
export function allowedValues(results: GenieResult[]): number[] {
  const allowed: number[] = [];
  const columns = new Map<string, number[]>(); // per result and column index
  results.forEach((r, ri) => {
    allowed.push(...extractFigures(r.summary).map((f) => f.value));
    r.rows.forEach((row) =>
      row.forEach((cell, c) => {
        const n = asNumber(cell);
        if (n === undefined) return;
        allowed.push(n);
        const key = `${ri}:${c}`;
        columns.set(key, [...(columns.get(key) ?? []), n]);
      }),
    );
  });
  const base = [...columns.values()].flat().slice(0, DERIVE_LIMIT);
  for (let i = 0; i < base.length; i++) {
    for (let j = 0; j < base.length; j++) {
      if (i === j) continue;
      const [a, b] = [base[i], base[j]];
      allowed.push(a + b, a - b);
      if (b !== 0) allowed.push(a / b, ((a - b) / b) * 100, (a / b) * 100);
    }
  }
  for (const col of columns.values()) {
    const total = col.reduce((s, n) => s + n, 0);
    allowed.push(total);
    if (total !== 0) col.slice(0, DERIVE_LIMIT).forEach((n) => allowed.push((n / total) * 100));
  }
  return allowed;
}

// Equal at the figure's written precision ("492.2M" for 492,215,330), or within the tolerance.
function matches(f: Figure, allowed: number): boolean {
  for (const a of f.percent ? [allowed, allowed * 100] : [allowed]) {
    const written = Math.abs(f.value);
    const value = Math.abs(a);
    if (written === 0 ? value === 0 : Math.abs(value - written) <= TOLERANCE * written) return true;
    const step = f.scale * 10 ** -f.decimals;
    if (Math.round(value / step) === Math.round(written / step)) return true;
  }
  return false;
}

export function checkGrounding(answer: string, results: GenieResult[], question: string, history: HistoryTurn[] = []): Grounding {
  // A number the user wrote themselves (in this question or earlier ones) needs no source.
  const fromUser = new Set([question, ...history.map((t) => t.question)].flatMap(extractFigures).map((f) => f.value));
  const figures = extractFigures(answer).filter((f) => !fromUser.has(f.value));
  const allowed = allowedValues(results);
  const ungrounded = figures.filter((f) => !allowed.some((a) => matches(f, a)));
  return { checked: figures.length, ungrounded: ungrounded.length, values: ungrounded.map((f) => f.raw) };
}
