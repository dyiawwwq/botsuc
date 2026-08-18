/**
 * Defenses against prompt injection from server messages, knowledge entries,
 * or member questions. The PRIMARY defense is architectural, not textual:
 *   1. The AI provider is only ever given a fixed system prompt plus clearly
 *      delimited, labeled blocks of untrusted data (see AnthropicProvider).
 *      Everything from Discord — questions, retrieved knowledge, channel
 *      names — is data, never an instruction.
 *   2. The AI's output is used ONLY as reply text. Nothing it produces can
 *      trigger a command, a database write, a moderation action, or a
 *      permission change. Only an authorized human running a real slash
 *      command can do those things.
 *   3. Every admin action re-checks permissions server-side (permissions.ts)
 *      regardless of what any AI-generated or user-supplied text says.
 *
 * The helpers below are a secondary, best-effort layer: they stop a message
 * from prematurely closing our delimiter tags and neutralize invisible/
 * control characters sometimes used to hide instructions. They are NOT a
 * content firewall — keyword-matching for "ignore previous instructions"
 * style phrases is easy to evade and produces false positives on innocent
 * questions (e.g. "how do I ignore notifications"), so we deliberately do
 * NOT block on keywords. We only log a lightweight heuristic flag for
 * admin visibility via /audit; we never use it to silently refuse.
 */

const CONTROL_AND_INVISIBLE_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g;

const PROTECTED_TAGS = ["approved_knowledge", "member_question", "server_context", "system", "instructions"];

export function sanitizeForPrompt(input: string, maxLen: number): string {
  let s = input.normalize("NFKC");
  s = s.replace(CONTROL_AND_INVISIBLE_CHARS, "");
  for (const tag of PROTECTED_TAGS) {
    const re = new RegExp(`</?${tag}>`, "gi");
    s = s.replace(re, "[blocked-tag]");
  }
  s = s.trim();
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  return s;
}

const INJECTION_HEURISTIC_PATTERNS = [
  /ignore (all|the|any) (previous|prior|above) instructions/i,
  /you are now/i,
  /disregard (all|the|any) (rules|instructions)/i,
  /reveal (your|the) system prompt/i,
  /act as (an? )?(unrestricted|jailbroken|dan)/i,
];

/**
 * Best-effort signal only — used to tag an /ask interaction in the audit log
 * for admin awareness. Never used to block or alter the answer, since
 * keyword heuristics are trivially evaded and prone to false positives.
 */
export function flagsPossibleInjectionAttempt(rawInput: string): boolean {
  return INJECTION_HEURISTIC_PATTERNS.some((re) => re.test(rawInput));
}

export interface KnowledgeSnippetForPrompt {
  title: string;
  content: string;
  type: string;
}

/** Builds the delimited, labeled "untrusted data" block passed to the AI provider. */
export function buildKnowledgeBlock(snippets: KnowledgeSnippetForPrompt[]): string {
  const parts = snippets.map((s, i) => {
    const title = sanitizeForPrompt(s.title, 200);
    const content = sanitizeForPrompt(s.content, 1200);
    return `[${i + 1}] (${s.type}) Title: ${title}\nContent: ${content}`;
  });
  return parts.join("\n---\n");
}
