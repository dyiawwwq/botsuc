import type { Interaction } from "discord.js";
import { commands } from "../commands/index.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { logger } from "../util/logger.js";
import { toUserMessage } from "../util/errors.js";

/** customId convention used by every command that owns buttons/modals: "<commandName>:<action>:<...args>". */
function commandNameFromCustomId(customId: string): string {
  return customId.split(":")[0] ?? "";
}

export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        logger.warn({ commandName: interaction.commandName }, "Received unknown command");
        await interaction.reply({ content: "That command isn't available right now.", ephemeral: true });
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const command = commands.get(commandNameFromCustomId(interaction.customId));
      if (!command?.handleButton) return;
      await command.handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const command = commands.get(commandNameFromCustomId(interaction.customId));
      if (!command?.handleModal) return;
      await command.handleModal(interaction);
      return;
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, "Unhandled interaction error");

    if (interaction.inGuild() && "user" in interaction) {
      recordAuditEvent({
        guildId: interaction.guildId!,
        actorUserId: interaction.user.id,
        action: "interaction_error",
        success: false,
      });
    }

    const message = toUserMessage(err);
    try {
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: message, ephemeral: true });
        } else {
          await interaction.reply({ content: message, ephemeral: true });
        }
      }
    } catch (replyErr) {
      // Interaction token may have expired (>15 min) or the interaction was already acknowledged
      // in an unusual state — nothing more we can safely do here.
      logger.error({ err: replyErr instanceof Error ? replyErr.message : replyErr }, "Failed to send error reply to user");
    }
  }
}
