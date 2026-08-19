import type { SlashCommand } from "./types.js";
import setup from "./setup.js";
import config from "./config.js";
import knowledge from "./knowledge.js";
import rules from "./rules.js";
import ask from "./ask.js";
import summarize from "./summarize.js";
import feedback from "./feedback.js";
import report from "./report.js";
import privacy from "./privacy.js";
import forget from "./forget.js";
import status from "./status.js";
import audit from "./audit.js";

export const commands: Map<string, SlashCommand> = new Map(
  [setup, config, knowledge, rules, ask, summarize, feedback, report, privacy, forget, status, audit].map((c) => [
    c.data.name,
    c,
  ])
);
