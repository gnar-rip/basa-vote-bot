require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the BASA vote bot is online."),

  new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Start a board vote")
    .addStringOption(option =>
      option
        .setName("question")
        .setDescription("The vote question")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("calendar")
    .setDescription("List upcoming BASA events"),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show the last 5 BASA board votes"),
  new SlashCommandBuilder()
    .setName("scrape")
    .setDescription("Upload receipt attachments from the finance channel to Drive.")
    .addIntegerOption(option =>
      option
        .setName("limit")
        .setDescription("Number of recent messages to scan. Defaults to 100.")
        .setMinValue(1)
        .setMaxValue(500)
    ),
  new SlashCommandBuilder()
    .setName("close-vote")
    .setDescription("Close the most recent BASA board vote.")
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    console.log("Deploying slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("Slash commands deployed.");
  } catch (error) {
    console.error(error);
  }
}

deployCommands();