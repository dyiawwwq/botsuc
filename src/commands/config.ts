import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { ensureGuild, getGuildConfig, updateGuildConfig } from "../db/repositories/guildRepo.js";
import { upsertChannelConfig } from "../db/repositories/channelConfigRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { isAuthorizedAdmin } from "../services/permissions.js";
import { PermissionError, ValidationError, toUserMessage } from "../util/errors.js";

function requireAdmin(interaction: ChatInputCommandInteraction, guildId: string) {
  ensureGuild(guildId, interaction.guild?.name);
  const config = getGuildConfig(guildId)!;
  if (!isAuthorizedAdmin(interaction, config)) {
    throw new PermissionError("You need Manage Server permission or a configured admin role to use /config.");
  }
  return config;
}

const command = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Admin: view or change this bot's configuration for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("view").setDescription("Show the current configuration"))
    .addSubcommand((sub) => sub.setName("identity").setDescription("Set server name, purpose, description, and culture (opens a form)"))
    .addSubcommand((sub) =>
      sub
        .setName("moderation")
        .setDescription("Set moderation intensity, warning threshold, and enforcement style")
        .addStringOption((o) => o.setName("intensity").setDescription("How strict moderation support should be").addChoices({ name: "Lenient", value: "lenient" }, { name: "Standard", value: "standard" }, { name: "Strict", value: "strict" }))
        .addIntegerOption((o) => o.setName("warning_threshold").setDescription("Warnings before suggesting escalation").setMinValue(1).setMaxValue(10))
        .addStringOption((o) => o.setName("enforcement_style").setDescription("Free-text description of enforcement style").setMaxLength(200))
    )
    .addSubcommand((sub) =>
      sub
        .setName("response-mode")
        .setDescription("Control whether the bot replies publicly, privately, or mention-gated")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Reply visibility for /ask and /rules")
            .setRequired(true)
            .addChoices({ name: "Public", value: "public" }, { name: "Mention only", value: "mention_only" }, { name: "Private (ephemeral) only", value: "private_only" })
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Set purpose, guidance, and read/index permissions for a channel")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to configure").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum))
        .addStringOption((o) => o.setName("purpose").setDescription("What this channel is for").setMaxLength(300))
        .addStringOption((o) => o.setName("guidance").setDescription("Extra guidance for members/the bot about this channel").setMaxLength(500))
        .addBooleanOption((o) => o.setName("read").setDescription("Allow the bot to read message content here (summarize/analysis)"))
        .addBooleanOption((o) => o.setName("index").setDescription("Allow derived knowledge from here to be used answering questions"))
    )
    .addSubcommand((sub) =>
      sub
        .setName("admin-role")
        .setDescription("Add or remove a role that should be treated as a bot administrator")
        .addStringOption((o) => o.setName("action").setDescription("add or remove").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }))
        .addRoleOption((o) => o.setName("role").setDescription("The role").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("ai")
        .setDescription("Enable or disable sending questions to an external AI provider")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Allow calling an external AI provider for /ask and /rules").setRequired(true))
        .addStringOption((o) => o.setName("provider").setDescription("Which provider").addChoices({ name: "None (local only)", value: "none" }, { name: "Anthropic", value: "anthropic" }))
    )
    .addSubcommand((sub) => sub.setName("alerts").setDescription("Set the channel moderation reports and feedback get posted to").addChannelOption((o) => o.setName("channel").setDescription("Alert channel").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName("retention").setDescription("Set how many days conversation memory is kept before auto-deletion").addIntegerOption((o) => o.setName("days").setDescription("1-365").setRequired(true).setMinValue(1).setMaxValue(365)))
    .addSubcommand((sub) =>
      sub
        .setName("message-analysis")
        .setDescription("Opt in/out of aggregate message-pattern analysis for specific channels (off by default)")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Master switch for this feature").setRequired(true))
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to add/remove from the allowed list").addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName("action").setDescription("add or remove the given channel").addChoices({ name: "Add channel", value: "add" }, { name: "Remove channel", value: "remove" }))
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    try {
      const config = requireAdmin(interaction, guildId);
      const actorId = interaction.user.id;

      switch (sub) {
        case "view": {
          const embed = new EmbedBuilder()
            .setTitle(`Configuration — ${interaction.guild?.name ?? "this server"}`)
            .setColor(0x1abc9c)
            .addFields(
              { name: "Identity", value: config.serverName || config.serverPurpose ? `${config.serverName ?? "(unnamed)"}\n${config.serverPurpose ?? ""}` : "Not set — run `/config identity`" },
              { name: "Response mode", value: config.responseMode, inline: true },
              { name: "AI provider", value: `${config.aiProvider}${config.aiEnabled ? "" : " (disabled)"}`, inline: true },
              { name: "Moderation", value: `${config.moderationIntensity} / threshold ${config.warningThreshold} / ${config.enforcementStyle}`, inline: true },
              { name: "Retention", value: `${config.retentionDays} day(s)`, inline: true },
              { name: "Message analysis", value: config.messageAnalysisEnabled ? `on (${config.messageAnalysisChannels.length} channel(s))` : "off", inline: true },
              { name: "Admin roles", value: config.adminRoleIds.length ? config.adminRoleIds.map((r) => `<@&${r}>`).join(", ") : "None (Manage Server permission only)" },
              { name: "Mod alert channel", value: config.modAlertChannelId ? `<#${config.modAlertChannelId}>` : "Not set" }
            );
          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        case "identity": {
          const modal = new ModalBuilder().setCustomId("config:identity-modal").setTitle("Server identity");
          const nameInput = new TextInputBuilder().setCustomId("name").setLabel("Server name (display)").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false).setValue(config.serverName ?? "");
          const purposeInput = new TextInputBuilder().setCustomId("purpose").setLabel("Purpose").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false).setValue(config.serverPurpose ?? "");
          const descriptionInput = new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false).setValue(config.serverDescription ?? "");
          const cultureInput = new TextInputBuilder().setCustomId("culture").setLabel("Culture / environment").setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false).setValue(config.serverCulture ?? "");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(purposeInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(cultureInput)
          );
          await interaction.showModal(modal);
          return;
        }

        case "moderation": {
          const intensity = interaction.options.getString("intensity") as typeof config.moderationIntensity | null;
          const threshold = interaction.options.getInteger("warning_threshold");
          const style = interaction.options.getString("enforcement_style");
          const updated = updateGuildConfig(
            guildId,
            {
              ...(intensity ? { moderationIntensity: intensity } : {}),
              ...(threshold !== null ? { warningThreshold: threshold } : {}),
              ...(style ? { enforcementStyle: style } : {}),
            },
            actorId
          );
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_moderation_updated", metadata: { intensity: updated.moderationIntensity, threshold: updated.warningThreshold } });
          await interaction.reply({ content: `Moderation settings updated: **${updated.moderationIntensity}**, threshold **${updated.warningThreshold}**.`, ephemeral: true });
          return;
        }

        case "response-mode": {
          const mode = interaction.options.getString("mode", true) as typeof config.responseMode;
          updateGuildConfig(guildId, { responseMode: mode }, actorId);
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_response_mode_updated", metadata: { mode } });
          await interaction.reply({ content: `Response mode set to **${mode}**.`, ephemeral: true });
          return;
        }

        case "channel": {
          const channel = interaction.options.getChannel("channel", true);
          const purpose = interaction.options.getString("purpose");
          const guidance = interaction.options.getString("guidance");
          const read = interaction.options.getBoolean("read");
          const index = interaction.options.getBoolean("index");
          const result = upsertChannelConfig(guildId, channel.id, {
            ...(purpose !== null ? { purpose } : {}),
            ...(guidance !== null ? { guidance } : {}),
            ...(read !== null ? { readEnabled: read } : {}),
            ...(index !== null ? { indexEnabled: index } : {}),
          });
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_channel_updated", targetType: "channel", targetId: channel.id, metadata: { readEnabled: result.readEnabled, indexEnabled: result.indexEnabled } });
          await interaction.reply({ content: `Updated <#${channel.id}>: read=${result.readEnabled}, index=${result.indexEnabled}.`, ephemeral: true });
          return;
        }

        case "admin-role": {
          const action = interaction.options.getString("action", true);
          const role = interaction.options.getRole("role", true);
          const current = new Set(config.adminRoleIds);
          if (action === "add") current.add(role.id);
          else current.delete(role.id);
          updateGuildConfig(guildId, { adminRoleIds: [...current] }, actorId);
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_admin_role_updated", targetType: "role", targetId: role.id, metadata: { action } });
          await interaction.reply({ content: `${action === "add" ? "Added" : "Removed"} <@&${role.id}> ${action === "add" ? "to" : "from"} bot administrators.`, ephemeral: true });
          return;
        }

        case "ai": {
          const enabled = interaction.options.getBoolean("enabled", true);
          const provider = (interaction.options.getString("provider") as typeof config.aiProvider | null) ?? (enabled ? "anthropic" : "none");
          updateGuildConfig(guildId, { aiEnabled: enabled, aiProvider: enabled ? provider : "none" }, actorId);
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_ai_updated", metadata: { enabled, provider } });
          await interaction.reply({
            content: enabled
              ? `External AI answering enabled (**${provider}**). Questions and matched knowledge excerpts will be sent to that provider. Members can see this via /privacy.`
              : "External AI answering disabled. /ask and /rules will use local keyword matching only.",
            ephemeral: true,
          });
          return;
        }

        case "alerts": {
          const channel = interaction.options.getChannel("channel", true);
          updateGuildConfig(guildId, { modAlertChannelId: channel.id }, actorId);
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_alerts_updated", targetType: "channel", targetId: channel.id });
          await interaction.reply({ content: `Moderation reports and feedback will now be posted to <#${channel.id}>.`, ephemeral: true });
          return;
        }

        case "retention": {
          const days = interaction.options.getInteger("days", true);
          updateGuildConfig(guildId, { retentionDays: days }, actorId);
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_retention_updated", metadata: { days } });
          await interaction.reply({ content: `Conversation memory retention set to **${days} day(s)**. Existing items keep their original expiry.`, ephemeral: true });
          return;
        }

        case "message-analysis": {
          const enabled = interaction.options.getBoolean("enabled", true);
          const channel = interaction.options.getChannel("channel");
          const action = interaction.options.getString("action");
          const current = new Set(config.messageAnalysisChannels);
          if (channel && action === "add") current.add(channel.id);
          if (channel && action === "remove") current.delete(channel.id);
          updateGuildConfig(guildId, { messageAnalysisEnabled: enabled, messageAnalysisChannels: [...current] }, actorId);
          recordAuditEvent({ guildId, actorUserId: actorId, action: "config_message_analysis_updated", metadata: { enabled, channelCount: current.size } });
          await interaction.reply({
            content: `Message analysis is now **${enabled ? "on" : "off"}**${current.size ? ` for ${current.size} channel(s)` : ""}. This produces aggregate, non-identifying patterns only — see /privacy.`,
            ephemeral: true,
          });
          return;
        }

        default:
          throw new ValidationError(`Unknown subcommand: ${sub}`);
      }
    } catch (err) {
      recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: `config_${sub}`, success: false });
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    try {
      ensureGuild(guildId, interaction.guild?.name);
      const config = getGuildConfig(guildId)!;
      if (!isAuthorizedAdmin(interaction, config)) {
        throw new PermissionError("You no longer have permission to complete this action.");
      }

      if (interaction.customId === "config:identity-modal") {
        const name = interaction.fields.getTextInputValue("name").trim();
        const purpose = interaction.fields.getTextInputValue("purpose").trim();
        const description = interaction.fields.getTextInputValue("description").trim();
        const culture = interaction.fields.getTextInputValue("culture").trim();
        updateGuildConfig(
          guildId,
          {
            serverName: name || null,
            serverPurpose: purpose || null,
            serverDescription: description || null,
            serverCulture: culture || null,
          },
          interaction.user.id
        );
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "config_identity_updated" });
        await interaction.reply({ content: "Server identity updated.", ephemeral: true });
      }
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
