import { computeAggregatePatterns, renderAggregatePatternSummary } from "../consentSummarizer.js";
import type { AiProvider, AnswerRequest, AnswerResult, SummarizeRequest, SummarizeResult } from "./types.js";

/**
 * Default provider when a guild hasn't enabled an external AI provider
 * (`ai_enabled = 0`, the default). No question text, knowledge content, or
 * server context ever leaves the process — this provider does deterministic
 * template answering over whatever knowledge entries the retrieval step
 * already selected.
 *
 * It is also the automatic fallback if AnthropicProvider errors at runtime,
 * so /ask degrades gracefully instead of failing outright.
 */
export class NullProvider implements AiProvider {
  readonly name = "none" as const;

  async answer(request: AnswerRequest): Promise<AnswerResult> {
    if (request.knowledge.length === 0) {
      return {
        text:
          "I don't have enough approved information to answer that yet. " +
          "Try an administrator or a relevant channel, or use /feedback to suggest this gets documented.",
        usedSourceTitles: [],
        insufficientInformation: true,
        providerName: "none",
      };
    }

    const top = request.knowledge.slice(0, 3);
    const body = top.map((k) => `**${k.title}**\n${k.content}`).join("\n\n");
    const provisionalNote = top.some((k) => k.confidence === "derived_provisional")
      ? "\n\n_Some of this is derived/summarized information, not an official rule — check with an admin if it matters._"
      : "";

    return {
      text: `Here's what's documented on that:\n\n${body}${provisionalNote}`,
      usedSourceTitles: top.map((k) => k.title),
      insufficientInformation: false,
      providerName: "none",
    };
  }

  async summarize(request: SummarizeRequest): Promise<SummarizeResult> {
    const pattern = computeAggregatePatterns(request.messages, request.windowLabel);
    const text = renderAggregatePatternSummary(pattern, request.channelLabel);
    return {
      text: `${text}\n\n_Local extractive summary — enable an AI provider with /config ai for a narrative summary._`,
      messageCount: pattern.messageVolume,
      participantCount: pattern.participantCount,
      providerName: "none",
    };
  }
}
