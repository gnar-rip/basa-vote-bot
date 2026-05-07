const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const TOKEN_PATH =
  process.env.NODE_ENV === "production"
    ? "/app/credentials/token.json"
    : path.join(__dirname, "token.json");

const CREDENTIALS_PATH =
  process.env.NODE_ENV === "production"
    ? "/app/credentials/oauth-client.json"
    : path.join(__dirname, "oauth-client.json");

function getOAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  oAuth2Client.setCredentials(token);

  return oAuth2Client;
}

async function getUpcomingEvents() {
  const auth = getOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: new Date().toISOString(),
    maxResults: 5,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.data.items || [];

  return events.map((event) => ({
    title: event.summary || "Untitled Event",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location || "",
    description: event.description || "",
  }));
}

module.exports = {
  getUpcomingEvents,
};