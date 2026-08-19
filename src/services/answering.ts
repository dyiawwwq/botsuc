import type { GuildConfigRow, KnowledgeEntryRow, KnowledgeType } from "../types/domain.js";
import { listActiveKnowledgeForRetrieval } from "../db/repositories/knowledgeRepo.js";
import { retrieve } from "./retrieval.js";
import { resolveAiProvider } from "./aiProvider/resolveProvider.js";
import { flagsPossibleInjectionAttempt } from "./promptGuard.js";

export interface AnsweredQuestion {
  replyText: string;
  ephemeral: boolean;
  matchedEntryIds: string[];
  possibleInjectionFlagged: boolean;
  outcome: "insufficient" | "ambiguous" | "answered";
}

/**
 * Shared by /ask and /rules. Retrieval (source filtering) always happens
 * first and independently of the AI provider — the provider, if any, only
 * ever sees the small set of entries retrieval already selected as
 * plausibly relevant, never the whole knowledge base.
 */
export async function answerQuestion(params: {
  guildId: string;
  question: string;
  config: GuildConfigRow;
  serverName: string | null;
  typeFilter?: KnowledgeType | KnowledgeType[];
}): Promise<AnsweredQuestion> {
  const { guildId, question, config, serverName, typeFilter } = params;
  const possibleInjectionFlagged = flagsPossibleInjectionAttempt(question);

  const pool = listActiveKnowledgeForRetrieval(guildId, typeFilter);
  const outcome = retrieve(question, pool);
  const ephemeral = config.responseMode === "private_only";

  if (outcome.kind === "insufficient") {
    return {
      replyText:
        "I don't have enough approved information to answer that yet. Try asking an administrator, checking a " +
        "relevant channel, or use `/feedback` to suggest this gets documented.",
      ephemeral,
      matchedEntryIds: [],
      possibleInjectionFlagged,
      outcome: "insufficient",
    };
  }

  if (outcome.kind === "ambiguous") {
    const options = outcome.candidates.map((c) => `• **${c.entry.title}**`).join("\n");
    return {
      replyText: `I found a few things that might match — could you be more specific?\n${options}`,
      ephemeral,
      matchedEntryIds: outcome.candidates.map((c) => c.entry.id),
      possibleInjectionFlagged,
      outcome: "ambiguous",
    };
  }

  const matches: KnowledgeEntryRow[] = outcome.matches.map((m) => m.entry);
  const provider = resolveAiProvider(config);
  const result = await provider.answer({
    question,
    serverContext: { name: serverName, purpose: config.serverPurpose },
    knowledge: matches,
  });

  const providerNote = provider.name === "anthropic" ? "" : "";
  return {
    replyText: `${result.text}${providerNote}`,
    ephemeral,
    matchedEntryIds: matches.map((m) => m.id),
    possibleInjectionFlagged,
    outcome: "answered",
  };
}
