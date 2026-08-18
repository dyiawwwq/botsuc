import type { KnowledgeEntryRow } from "../../types/domain.js";

export interface AnswerRequest {
  question: string;
  serverContext: {
    name: string | null;
    purpose: string | null;
  };
  knowledge: KnowledgeEntryRow[];
}

export interface AnswerResult {
  text: string;
  usedSourceTitles: string[];
  /** True when the provider itself determined the knowledge was insufficient. */
  insufficientInformation: boolean;
  providerName: "none" | "anthropic";
}

export interface SummarizeRequest {
  channelLabel: string;
  windowLabel: string;
  messages: { authorId: string; content: string }[];
}

export interface SummarizeResult {
  text: string;
  messageCount: number;
  participantCount: number;
  providerName: "none" | "anthropic";
}

/**
 * Implemented independently by NullProvider (fully local, no external call)
 * and AnthropicProvider (calls the Claude API). Both are swappable behind
 * this interface — see services/aiProvider/resolveProvider.ts.
 */
export interface AiProvider {
  readonly name: "none" | "anthropic";
  answer(request: AnswerRequest): Promise<AnswerResult>;
  summarize(request: SummarizeRequest): Promise<SummarizeResult>;
}
