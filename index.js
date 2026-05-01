require("dotenv").config();

const { appendVoteToSheet } = require("./googleSheets");

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const votes = new Map();

function hasBoardRole(interaction) {
  return interaction.member.roles.cache.has(process.env.BOARD_ROLE_ID);
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ping") {
      return interaction.reply("BASA vote bot is online.");
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
        .map((userId) => interaction.guild.members.cache.get(userId)?.user.username || userId)
        .join(", ");

      const noVoters = [...voteData.no]
        .map((userId) => interaction.guild.members.cache.get(userId)?.user.username || userId)
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

  // Button clicks
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