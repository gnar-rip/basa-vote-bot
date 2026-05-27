require("dotenv").config();

const {
  appendVoteToSheet,
  getVoteHistory,
  getUploadedReceiptAttachmentIds,
  appendReceiptUploadLog,
} = require("./googleSheets");
const { getUpcomingEvents } = require("./googleCalendar");
const { uploadFileToDriveFolder } = require("./googleDrive");

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const votes = new Map();
const RECEIPT_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const RECEIPT_ATTACHMENT_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".pdf",
]);

function hasBoardRole(interaction) {
  return interaction.member.roles.cache.has(process.env.BOARD_ROLE_ID);
}

function formatEventDate(dateString) {
  if (!dateString) return "Date not listed";

  const date = new Date(dateString);

  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMessageDate(date) {
  return date.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

function formatLogDate(date) {
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
}

function sanitizeFilenamePart(value, fallback) {
  const sanitized = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (sanitized || fallback).slice(0, 80).trim();
}

function pathExtension(filename) {
  const lastDot = filename?.lastIndexOf(".");

  if (!lastDot || lastDot < 0) return "";

  return filename.slice(lastDot).toLowerCase();
}

function getFileExtension(filename, contentType) {
  const extension = pathExtension(filename);

  if (extension) return extension;
  if (contentType === "application/pdf") return ".pdf";
  if (contentType?.startsWith("image/")) return `.${contentType.slice(6)}`;

  return "";
}

function isReceiptAttachment(attachment) {
  const contentType = attachment.contentType?.toLowerCase();
  const extension = pathExtension(attachment.name);

  return (
    RECEIPT_ATTACHMENT_TYPES.has(contentType) ||
    RECEIPT_ATTACHMENT_EXTENSIONS.has(extension)
  );
}

function parseReceiptDetails(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const forLine = lines.find((line) => /^for\s*[:-]\s*/i.test(line));
  const amountLine = lines.find((line) => /^amount\s*[:-]\s*/i.test(line));

  const forValue = forLine?.replace(/^for\s*[:-]\s*/i, "").trim();
  const rawAmount = amountLine?.replace(/^amount\s*[:-]\s*/i, "").trim();
  const amount = normalizeAmount(rawAmount);

  return {
    forValue: forValue || "",
    amount: amount || "",
  };
}

function normalizeAmount(value) {
  if (!value) return "";

  const compact = value.replace(/\s+/g, "");

  if (/^\$?\d+(,\d{3})*(\.\d{1,2})?$/.test(compact)) {
    return compact.startsWith("$") ? compact : `$${compact}`;
  }

  return value.trim();
}

function buildReceiptFilename({
  message,
  attachment,
  attachmentIndex,
  totalAttachments,
}) {
  const { forValue, amount } = parseReceiptDetails(message.content || "");
  const date = formatMessageDate(message.createdAt);
  const description = sanitizeFilenamePart(forValue, "No Description");
  const uploader = sanitizeFilenamePart(message.author?.username, "Unknown");
  const extension = getFileExtension(attachment.name, attachment.contentType);
  const parts = [date, description];

  if (amount) parts.push(sanitizeFilenamePart(amount, "Amount"));
  parts.push(uploader);

  if (totalAttachments > 1) {
    parts.push(String(attachmentIndex + 1));
  }

  return `${parts.join(" - ")}${extension}`;
}

async function fetchRecentMessages(channel, limit) {
  const messages = [];
  let before;

  while (messages.length < limit) {
    const batchSize = Math.min(100, limit - messages.length);
    const batch = await channel.messages.fetch({
      limit: batchSize,
      ...(before ? { before } : {}),
    });

    if (batch.size === 0) break;

    messages.push(...batch.values());
    before = batch.last().id;
  }

  return messages;
}

function getMessageUrl(message) {
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ping") {
      return interaction.reply("BASA vote bot is online.");
    }

    if (interaction.commandName === "calendar") {
      if (!hasBoardRole(interaction)) {
        return interaction.reply({
          content: "Only BASA board members can view the internal calendar.",
          ephemeral: true,
        });
      }

      try {
        const events = await getUpcomingEvents();

        if (events.length === 0) {
          return interaction.reply({
            content: "No upcoming BASA calendar events found.",
            ephemeral: true,
          });
        }

        const message = events
          .map((event, index) => {
            const location = event.location
              ? `\nLocation: ${event.location}`
              : "";

            return `**${index + 1}. ${event.title}**
${formatEventDate(event.start)}${location}`;
          })
          .join("\n\n---\n\n");

        return interaction.reply({
          content: `**Upcoming BASA Events**\n\n${message}`,
          ephemeral: true,
        });
      } catch (error) {
        console.error("Failed to fetch calendar events:", error);

        return interaction.reply({
          content: "Could not fetch events from the BASA calendar.",
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === "history") {
      if (!hasBoardRole(interaction)) {
        return interaction.reply({
          content: "Only BASA board members can view vote history.",
          ephemeral: true,
        });
      }

      try {
        const history = await getVoteHistory();

        if (history.length === 0) {
          return interaction.reply({
            content: "No vote history found.",
            ephemeral: true,
          });
        }

        const message = history
          .map(
            (vote, index) => `**${index + 1}. ${vote.result}**
${vote.question}

Yes: ${vote.yes}
No: ${vote.no}
Closed By: ${vote.closedBy}
Date: ${vote.date}`
          )
          .join("\n\n---\n\n");

        return interaction.reply({
          content: `**Recent BASA Votes**\n\n${message}`,
          ephemeral: true,
        });
      } catch (error) {
        console.error("Failed to fetch vote history:", error);

        return interaction.reply({
          content: "Could not fetch vote history from the BASA Vote Log.",
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === "scrape") {
      if (!hasBoardRole(interaction)) {
        return interaction.reply({
          content: "Only BASA board members can scrape receipt uploads.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const financeChannelId = process.env.FINANCE_CHANNEL_ID;
      const receiptsFolderId = process.env.GOOGLE_RECEIPTS_FOLDER_ID;
      const limit = interaction.options.getInteger("limit") || 100;

      if (!financeChannelId || !receiptsFolderId) {
        return interaction.editReply(
          "Receipt scraping is not configured. Missing finance channel or Drive folder settings."
        );
      }

      try {
        const channel = await client.channels.fetch(financeChannelId);

        if (!channel?.isTextBased() || !channel.messages) {
          return interaction.editReply(
            "The configured finance channel could not be read as a text channel."
          );
        }

        const uploadedAttachmentIds = await getUploadedReceiptAttachmentIds();
        const messages = await fetchRecentMessages(channel, limit);
        const logRows = [];
        let found = 0;
        let uploaded = 0;
        let skipped = 0;
        let failed = 0;

        for (const message of messages) {
          const receiptAttachments = [...message.attachments.values()].filter(
            isReceiptAttachment
          );

          for (const [
            attachmentIndex,
            attachment,
          ] of receiptAttachments.entries()) {
            found += 1;

            if (uploadedAttachmentIds.has(attachment.id)) {
              skipped += 1;
              continue;
            }

            try {
              const filename = buildReceiptFilename({
                message,
                attachment,
                attachmentIndex,
                totalAttachments: receiptAttachments.length,
              });
              const driveFile = await uploadFileToDriveFolder({
                url: attachment.url,
                filename,
                mimeType: attachment.contentType || "application/octet-stream",
                folderId: receiptsFolderId,
              });
              const { forValue, amount } = parseReceiptDetails(
                message.content || ""
              );

              logRows.push([
                formatLogDate(new Date()),
                formatLogDate(message.createdAt),
                forValue,
                amount,
                message.author?.id || "",
                message.author?.username || "",
                attachment.name || "",
                driveFile.id || "",
                driveFile.name || filename,
                message.id,
                attachment.id,
                getMessageUrl(message),
              ]);

              uploadedAttachmentIds.add(attachment.id);
              uploaded += 1;
            } catch (error) {
              failed += 1;
              console.error("Failed to upload receipt attachment:", error);
            }
          }
        }

        await appendReceiptUploadLog(logRows);

        return interaction.editReply(
          `Receipt scrape complete.\n\nMessages scanned: ${messages.length}\nReceipt files found: ${found}\nUploaded: ${uploaded}\nSkipped duplicates: ${skipped}\nFailed: ${failed}`
        );
      } catch (error) {
        console.error("Failed to scrape receipt uploads:", error);

        return interaction.editReply(
          "Could not scrape receipts from the finance channel."
        );
      }
    }

    if (interaction.commandName === "vote") {
      if (!hasBoardRole(interaction)) {
        return interaction.reply({
          content: "Only BASA board members can start votes.",
          ephemeral: true,
        });
      }

      const question = interaction.options.getString("question");

      const yesButton = new ButtonBuilder()
        .setCustomId("vote_yes")
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success);

      const noButton = new ButtonBuilder()
        .setCustomId("vote_no")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(yesButton, noButton);

      const message = await interaction.reply({
        content: `**BASA Board Vote**\n\n${question}`,
        components: [row],
        fetchReply: true,
      });

      votes.set(message.id, {
        question,
        yes: new Set(),
        no: new Set(),
        channelId: interaction.channelId,
        createdBy: interaction.user.id,
        closed: false,
      });

      return;
    }

    if (interaction.commandName === "close-vote") {
      if (!hasBoardRole(interaction)) {
        return interaction.reply({
          content: "Only BASA board members can close votes.",
          ephemeral: true,
        });
      }

      const activeVotes = [...votes.entries()].filter(
        ([, voteData]) =>
          voteData.channelId === interaction.channelId && !voteData.closed
      );

      if (activeVotes.length === 0) {
        return interaction.reply({
          content: "There are no active votes to close in this channel.",
          ephemeral: true,
        });
      }

      const [messageId, voteData] = activeVotes[activeVotes.length - 1];

      voteData.closed = true;

      const yesCount = voteData.yes.size;
      const noCount = voteData.no.size;

      let result = "TIED";
      if (yesCount > noCount) result = "PASSED";
      if (noCount > yesCount) result = "FAILED";

      const finalContent = `**BASA Board Vote - CLOSED**

${voteData.question}

Yes: ${yesCount}
No: ${noCount}

**Result: ${result}**`;

      const voteMessage = await interaction.channel.messages.fetch(messageId);

      await voteMessage.edit({
        content: finalContent,
        components: [],
      });

      const yesVoters = [...voteData.yes]
        .map(
          (userId) =>
            interaction.guild.members.cache.get(userId)?.user.username || userId
        )
        .join(", ");

      const noVoters = [...voteData.no]
        .map(
          (userId) =>
            interaction.guild.members.cache.get(userId)?.user.username || userId
        )
        .join(", ");

      await appendVoteToSheet({
        question: voteData.question,
        yesCount,
        noCount,
        result,
        closedBy: interaction.user.username,
        yesVoters,
        noVoters,
      });

      return interaction.reply({
        content: "Vote closed.",
        ephemeral: true,
      });
    }
  }

  if (interaction.isButton()) {
    if (!hasBoardRole(interaction)) {
      return interaction.reply({
        content: "Only BASA board members can vote.",
        ephemeral: true,
      });
    }

    const voteData = votes.get(interaction.message.id);

    if (!voteData) {
      return interaction.reply({
        content: "This vote is no longer active.",
        ephemeral: true,
      });
    }

    if (voteData.closed) {
      return interaction.reply({
        content: "This vote has already been closed.",
        ephemeral: true,
      });
    }

    const userId = interaction.user.id;

    voteData.yes.delete(userId);
    voteData.no.delete(userId);

    if (interaction.customId === "vote_yes") {
      voteData.yes.add(userId);
    }

    if (interaction.customId === "vote_no") {
      voteData.no.add(userId);
    }

    const updatedContent = `**BASA Board Vote**

${voteData.question}

✅ Yes: ${voteData.yes.size}
❌ No: ${voteData.no.size}`;

    await interaction.update({
      content: updatedContent,
      components: interaction.message.components,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
