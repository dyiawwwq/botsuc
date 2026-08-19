export type ResponseMode = "public" | "mention_only" | "private_only";
export type AiProviderName = "none" | "anthropic";
export type ModerationIntensity = "lenient" | "standard" | "strict";
export type KnowledgeType =
  | "rule"
  | "policy"
  | "faq"
  | "onboarding"
  | "event"
  | "term"
  | "resource"
  | "derived_pattern"
  | "general";
export type KnowledgeStatus = "active" | "outdated" | "archived";
export type KnowledgeConfidence = "authoritative" | "derived_provisional";

export interface TrustedResourceLink {
  label: string;
  url: string;
}

export interface GuildConfigRow {
  guildId: string;
  serverName: string | null;
  serverPurpose: string | null;
  serverDescription: string | null;
  serverCulture: string | null;
  responseMode: ResponseMode;
  aiEnabled: boolean;
  aiProvider: AiProviderName;
  moderationIntensity: ModerationIntensity;
  warningThreshold: number;
  prohibitedContentNotes: string | null;
  enforcementStyle: string;
  modAlertChannelId: string | null;
  messageAnalysisEnabled: boolean;
  messageAnalysisChannels: string[];
  retentionDays: number;
  summarizeEnabled: boolean;
  adminRoleIds: string[];
  trustedResourceLinks: TrustedResourceLink[];
  updatedAt: string;
  updatedByUserId: string | null;
}

export interface ChannelConfigRow {
  id: string;
  guildId: string;
  channelId: string;
  purpose: string | null;
  guidance: string | null;
  category: string | null;
  readEnabled: boolean;
  indexEnabled: boolean;
  updatedAt: string;
}

export interface KnowledgeEntryRow {
  id: string;
  guildId: string;
  type: KnowledgeType;
  title: string;
  content: string;
  sourceChannelId: string | null;
  sourceMessageId: string | null;
  status: KnowledgeStatus;
  confidence: KnowledgeConfidence;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationContextRow {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  summaryText: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuditEventRow {
  id: string;
  guildId: string;
  actorUserId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  success: boolean;
  createdAt: string;
}

export interface FeedbackItemRow {
  id: string;
  guildId: string;
  reporterUserId: string;
  relatedQuestion: string | null;
  relatedAnswer: string | null;
  comment: string;
  status: "open" | "reviewed" | "resolved" | "dismissed";
  createdAt: string;
}

export interface ModerationReportRow {
  id: string;
  guildId: string;
  reporterUserId: string;
  channelId: string | null;
  messageId: string | null;
  reason: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  suggestedAction: string | null;
  createdAt: string;
}
