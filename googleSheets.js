const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "oauth-client.json");

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

async function appendVoteToSheet({ question, yesCount, noCount, result, closedBy, yesVoters, noVoters }) {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A3:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          new Date().toLocaleString("en-US", {
            timeZone: "America/New_York",
          }),
          question,
          yesCount,
          noCount,
          result,
          closedBy,
          yesVoters,
          noVoters,
        ],
      ],
    },
  });
}

async function getVoteHistory() {
    const auth = get0AuthClient();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.value.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Sheet1!A3:H",
    });

    const rows = response.data.values || [];

    return rows.slice(-5).reverse().map((row) => ({
      date: row[0] || "",
      question: row[1] || "",
      yes: row[2] || "0",
      no: row[3] || "0",
      result: row[4] || "",
      closedBy: row[5] || "",
      yesVoters: row[6] || "",
      noVoters: row[7] || "",
    }));
}

module.exports = {
  appendVoteToSheet,
  getVoteHistory,
};