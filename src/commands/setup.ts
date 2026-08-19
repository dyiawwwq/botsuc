import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { ensureGuild, getGuildConfig, updateGuildConfig } from "../db/repositories/guildRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { isAuthorizedAdmin } from "../services/permissions.js";
import { PermissionError, toUserMessage } from "../util/errors.js";
import type { ModerationIntensity, ResponseMode } from "../types/domain.js";

function responseModeRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("setup:response-mode:public").setLabel("Public replies").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("setup:response-mode:mention_only").setLabel("Mention-gated").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("setup:response-mode:private_only").setLabel("Private (ephemeral) only").setStyle(ButtonStyle.Primary)
  );
}

function moderationRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("setup:moderation:lenient").setLabel("Lenient").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("setup:moderation:standard").setLabel("Standard").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("setup:moderation:strict").setLabel("Strict").setStyle(ButtonStyle.Secondary)
  );
}

const command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Admin: guided first-time setup for this server's knowledge bot.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    ensureGuild(guildId, interaction.guild?.name);
    const config = getGuildConfig(guildId)!;

    if (!isAuthorizedAdmin(interaction, config)) {
      await interaction.reply({ content: toUserMessage(new PermissionError("You need Manage Server permission to run /setup.")), ephemeral: true });
      return;
    }

    const modal = new ModalBuilder().setCustomId("setup:identity-modal").setTitle("Step 1 of 3 — Server identity");
    const nameInput = new TextInputBuilder().setCustomId("name").setLabel("Server name (display)").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(config.serverName ?? interaction.guild?.name ?? "");
    const purposeInput = new TextInputBuilder().setCustomId("purpose").setLabel("Purpose (what is this server for?)").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false);
    const cultureInput = new TextInputBuilder().setCustomId("culture").setLabel("Culture / vibe (optional)").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(purposeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cultureInput)
    );
    await interaction.showModal(modal);
  },

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.customId !== "setup:identity-modal") return;
    const guildId = interaction.guildId!;
    try {
      const config = getGuildConfig(guildId)!;
      if (!isAuthorizedAdmin(interaction, config)) throw new PermissionError("You no longer have permission to complete setup.");

      const name = interaction.fields.getTextInputValue("name").trim();
      const purpose = interaction.fields.getTextInputValue("purpose").trim();
      const culture = interaction.fields.getTextInputValue("culture").trim();
      updateGuildConfig(guildId, { serverName: name || null, serverPurpose: purpose || null, serverCulture: culture || null }, interaction.user.id);
      recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "setup_identity_saved" });

      await interaction.reply({
        content: "**Step 2 of 3** — How should the bot reply to `/ask` and `/rules`?",
        components: [responseModeRow()],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    try {
      const config = getGuildConfig(guildId)!;
      if (!isAuthorizedAdmin(interaction, config)) throw new PermissionError("You no longer have permission to complete setup.");

      const [, step, value] = interaction.customId.split(":"); // setup:response-mode:<value> | setup:moderation:<value>

      if (step === "response-mode") {
        updateGuildConfig(guildId, { responseMode: value as ResponseMode }, interaction.user.id);
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "setup_response_mode_saved", metadata: { value } });
        await interaction.update({
          content: "**Step 3 of 3** — Default moderation-support intensity? (You can fine-tune this any time with `/config moderation`.)",
          components: [moderationRow()],
        });
        return;
      }

      if (step === "moderation") {
        updateGuildConfig(guildId, { moderationIntensity: value as ModerationIntensity }, interaction.user.id);
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "setup_moderation_saved", metadata: { value } });

        const embed = new EmbedBuilder()
          .setTitle("Setup complete 🎉")
          .setColor(0x2ecc71)
          .setDescription(
            "Next steps:\n" +
              "• `/knowledge add` — add your first rules, FAQs, or channel guidance\n" +
              "• `/config channel` — tell the bot which channels it may read/index\n" +
              "• `/config admin-role` — let other roles manage the bot besides Manage Server\n" +
              "• `/config ai` — optionally enable AI-generated answers (off by default; local keyword matching is used until then)\n" +
              "• `/privacy` — see exactly what this shows your members\n" +
              "• `/status` any time for a full overview"
          );
        await interaction.update({ content: "", embeds: [embed], components: [] });
      }
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
