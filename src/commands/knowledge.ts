import {
  ActionRowBuilder,
  AttachmentBuilder,
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
import { ensureGuild, getGuildConfig } from "../db/repositories/guildRepo.js";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntryById,
  listKnowledgeEntries,
  resetAllKnowledgeEntries,
  updateKnowledgeEntry,
} from "../db/repositories/knowledgeRepo.js";
import { recordAuditEvent } from "../db/repositories/auditRepo.js";
import { isAuthorizedAdmin } from "../services/permissions.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { env } from "../config/env.js";
import { NotFoundError, PermissionError, ValidationError, toUserMessage } from "../util/errors.js";
import type { KnowledgeType } from "../types/domain.js";

const KNOWLEDGE_TYPE_CHOICES: { name: string; value: KnowledgeType }[] = [
  { name: "Rule", value: "rule" },
  { name: "Policy", value: "policy" },
  { name: "FAQ", value: "faq" },
  { name: "Onboarding", value: "onboarding" },
  { name: "Event", value: "event" },
  { name: "Term / glossary", value: "term" },
  { name: "Trusted resource", value: "resource" },
  { name: "General", value: "general" },
];

function requireAdmin(interaction: ChatInputCommandInteraction, guildId: string): void {
  ensureGuild(guildId, interaction.guild?.name);
  const config = getGuildConfig(guildId)!;
  if (!isAuthorizedAdmin(interaction, config)) {
    throw new PermissionError("You need Manage Server permission or a configured admin role to manage knowledge.");
  }
}

const command = {
  data: new SlashCommandBuilder()
    .setName("knowledge")
    .setDescription("Admin: manage approved server knowledge (rules, FAQs, policies, and more).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a new knowledge entry")
        .addStringOption((opt) =>
          opt
            .setName("type")
            .setDescription("Category of this entry")
            .setRequired(true)
            .addChoices(...KNOWLEDGE_TYPE_CHOICES)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing knowledge entry")
        .addStringOption((opt) => opt.setName("id").setDescription("Entry ID (see /knowledge list)").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List knowledge entries")
        .addStringOption((opt) => opt.setName("type").setDescription("Filter by type").addChoices(...KNOWLEDGE_TYPE_CHOICES))
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a knowledge entry")
        .addStringOption((opt) => opt.setName("id").setDescription("Entry ID (see /knowledge list)").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("reset").setDescription("Delete ALL knowledge entries for this server (requires confirmation)"))
    .addSubcommand((sub) => sub.setName("export").setDescription("Export all knowledge entries as a JSON file")),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    try {
      checkRateLimit({ bucket: "knowledge-write", guildId, userId: interaction.user.id, limit: 20, windowMs: env.RATE_LIMIT_WINDOW_MS });
      requireAdmin(interaction, guildId);

      if (sub === "add") {
        const type = interaction.options.getString("type", true) as KnowledgeType;
        const modal = new ModalBuilder().setCustomId(`knowledge:add-modal:${type}`).setTitle(`Add ${type} entry`);
        const titleInput = new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short).setMaxLength(150).setRequired(true);
        const contentInput = new TextInputBuilder().setCustomId("content").setLabel("Content").setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(true);
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (sub === "edit") {
        const id = interaction.options.getString("id", true);
        const existing = getKnowledgeEntryById(guildId, id);
        if (!existing) throw new NotFoundError(`No knowledge entry with ID \`${id}\` in this server.`);

        const modal = new ModalBuilder().setCustomId(`knowledge:edit-modal:${id}`).setTitle(`Edit: ${existing.title.slice(0, 40)}`);
        const titleInput = new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Title")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(150)
          .setRequired(true)
          .setValue(existing.title);
        const contentInput = new TextInputBuilder()
          .setCustomId("content")
          .setLabel("Content")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(3500)
          .setRequired(true)
          .setValue(existing.content);
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (sub === "list") {
        const type = interaction.options.getString("type") as KnowledgeType | null;
        const entries = listKnowledgeEntries(guildId, { type: type ?? undefined, limit: 25 });
        if (entries.length === 0) {
          await interaction.reply({ content: "No knowledge entries found for that filter.", ephemeral: true });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Knowledge entries (${entries.length})`)
          .setColor(0x9b59b6)
          .setDescription(
            entries
              .map((e) => `\`${e.id.slice(0, 8)}\` **[${e.type}/${e.status}]** ${e.title}${e.confidence === "derived_provisional" ? " _(derived)_" : ""}`)
              .join("\n")
          )
          .setFooter({ text: "Use the full ID with /knowledge edit or /knowledge delete — /knowledge list shows a short prefix above." });
        // Store full IDs in a compact follow-up so admins can copy exact values.
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (sub === "delete") {
        const id = interaction.options.getString("id", true);
        const existing = getKnowledgeEntryById(guildId, id);
        if (!existing) throw new NotFoundError(`No knowledge entry with ID \`${id}\` in this server.`);
        deleteKnowledgeEntry(guildId, id);
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "knowledge_deleted", targetType: "knowledge_entry", targetId: id, metadata: { title: existing.title } });
        await interaction.reply({ content: `Deleted **${existing.title}**.`, ephemeral: true });
        return;
      }

      if (sub === "reset") {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("knowledge:reset-confirm").setLabel("Delete everything").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("knowledge:reset-cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
          content: "⚠️ This will permanently delete **all** knowledge entries for this server. This can't be undone. Are you sure?",
          components: [row],
          ephemeral: true,
        });
        return;
      }

      if (sub === "export") {
        const entries = listKnowledgeEntries(guildId, { limit: 5000 });
        const json = JSON.stringify({ guildId, exportedAt: new Date().toISOString(), entries }, null, 2);
        const attachment = new AttachmentBuilder(Buffer.from(json, "utf-8"), { name: `knowledge-export-${guildId}.json` });
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "knowledge_exported", metadata: { count: entries.length } });
        await interaction.reply({ content: `Exported ${entries.length} entries.`, files: [attachment], ephemeral: true });
        return;
      }

      throw new ValidationError(`Unknown subcommand: ${sub}`);
    } catch (err) {
      recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: `knowledge_${sub}`, success: false });
      const message = toUserMessage(err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    ensureGuild(guildId, interaction.guild?.name);
    const config = getGuildConfig(guildId)!;
    if (!isAuthorizedAdmin(interaction, config)) {
      await interaction.update({ content: "You no longer have permission to confirm this action.", components: [] });
      return;
    }

    if (interaction.customId === "knowledge:reset-cancel") {
      await interaction.update({ content: "Cancelled — nothing was deleted.", components: [] });
      return;
    }

    if (interaction.customId === "knowledge:reset-confirm") {
      const deleted = resetAllKnowledgeEntries(guildId);
      recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "knowledge_reset", metadata: { deletedCount: deleted } });
      await interaction.update({ content: `Deleted ${deleted} knowledge entr${deleted === 1 ? "y" : "ies"}. This server's knowledge base is now empty.`, components: [] });
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

      const title = interaction.fields.getTextInputValue("title").trim();
      const content = interaction.fields.getTextInputValue("content").trim();
      if (!title || !content) throw new ValidationError("Title and content can't be empty.");

      const parts = interaction.customId.split(":"); // knowledge:add-modal:<type>  |  knowledge:edit-modal:<id>
      const mode = parts[1];

      if (mode === "add-modal") {
        const type = parts[2] as KnowledgeType;
        const entry = createKnowledgeEntry(guildId, { type, title, content, createdByUserId: interaction.user.id });
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "knowledge_created", targetType: "knowledge_entry", targetId: entry.id, metadata: { type, title } });
        await interaction.reply({ content: `Added **${title}** (\`${entry.id}\`).`, ephemeral: true });
        return;
      }

      if (mode === "edit-modal") {
        const id = parts[2]!;
        const updated = updateKnowledgeEntry(guildId, id, { title, content });
        if (!updated) throw new NotFoundError("That entry no longer exists.");
        recordAuditEvent({ guildId, actorUserId: interaction.user.id, action: "knowledge_updated", targetType: "knowledge_entry", targetId: id, metadata: { title } });
        await interaction.reply({ content: `Updated **${title}**.`, ephemeral: true });
        return;
      }
    } catch (err) {
      await interaction.reply({ content: toUserMessage(err), ephemeral: true });
    }
  },
};

export default command;
