import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type AnySlashCommandData = SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;

/**
 * Every command module exports one of these. `data` is registered with
 * Discord by deployCommands.ts; `execute` handles the slash-command
 * invocation itself; `handleButton`/`handleModal` (optional) handle any
 * message-component follow-ups the command created, routed by customId
 * prefix — see discord/interactionRouter.ts.
 */
export interface SlashCommand {
  data: AnySlashCommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  handleButton?(interaction: ButtonInteraction): Promise<void>;
  handleModal?(interaction: ModalSubmitInteraction): Promise<void>;
}
