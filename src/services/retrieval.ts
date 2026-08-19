import type { KnowledgeEntryRow, KnowledgeType } from "../types/domain.js";

export interface ScoredEntry {
  entry: KnowledgeEntryRow;
  score: number;
}

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","to","of","and","or","in","on","for","it","this","that",
  "how","what","when","where","why","who","which","do","does","did","i","you","we","can","will",
  "with","as","be","my","me","our","us","your","if","not","no","yes","please","about","there",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKC").match(/[a-z0-9']+/g) ?? [];
}

function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

/**
 * Deterministic keyword-overlap scorer used by NullProvider always, and as
 * the source-filtering step before AnthropicProvider is ever called (so the
 * AI only ever sees entries that are plausibly relevant, never the whole
 * knowledge base). Weighted by: fraction of query terms matched, a small
 * authoritative-knowledge boost, and a penalty for non-active entries
 * (belt-and-suspenders — callers should already filter to status="active").
 *
 * This is intentionally simple and dependency-free. For semantic (not just
 * lexical) matching at larger knowledge-base sizes, swap this module for an
 * embedding-based retriever behind the same `scoreEntries` signature — see
 * README Limitations.
 */
export function scoreEntries(query: string, entries: KnowledgeEntryRow[]): ScoredEntry[] {
  const qTokens = meaningfulTokens(query);
  if (qTokens.length === 0) return [];
  const qSet = new Set(qTokens);

  const scored = entries.map((entry) => {
    const textTokens = tokenize(`${entry.title} ${entry.title} ${entry.content}`); // title counted twice (weighted)
    const freq = new Map<string, number>();
    for (const t of textTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

    let matched = 0;
    for (const qt of qSet) if (freq.has(qt)) matched += 1;

    let score = matched / qSet.size;
    if (entry.confidence === "authoritative") score += 0.05;
    if (entry.status !== "active") score -= 0.5;

    return { entry, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

export const MIN_CONFIDENCE = 0.34; // roughly: at least ~1/3 of the query's meaningful terms must be found
const DISAMBIGUATION_GAP = 0.12; // if the top two scores are this close, prefer clarifying over guessing

export type RetrievalOutcome =
  | { kind: "insufficient"; topScore: number }
  | { kind: "ambiguous"; candidates: ScoredEntry[] }
  | { kind: "confident"; matches: ScoredEntry[] };

/** Wraps scoreEntries with the confidence-gating and disambiguation policy used by /ask and /rules. */
export function retrieve(query: string, entries: KnowledgeEntryRow[], topK = 4): RetrievalOutcome {
  const scored = scoreEntries(query, entries);
  if (scored.length === 0 || (scored[0]?.score ?? 0) < MIN_CONFIDENCE) {
    return { kind: "insufficient", topScore: scored[0]?.score ?? 0 };
  }

  const top = scored[0]!;
  const second = scored[1];
  if (second && top.score - second.score < DISAMBIGUATION_GAP && second.score >= MIN_CONFIDENCE) {
    return { kind: "ambiguous", candidates: scored.slice(0, 3) };
  }

  return { kind: "confident", matches: scored.slice(0, topK) };
}

export function filterByType(entries: KnowledgeEntryRow[], type: KnowledgeType): KnowledgeEntryRow[] {
  return entries.filter((e) => e.type === type);
}
