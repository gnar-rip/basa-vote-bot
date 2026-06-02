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

function getVoteLogSheetName() {
  return process.env.VOTE_LOG_SHEET_NAME || "voteLog";
}

function getReceiptLogSheetName() {
  return process.env.RECEIPT_LOG_SHEET_NAME || "receiptLog";
}

async function appendVoteToSheet({
  question,
  yesCount,
  noCount,
  result,
  closedBy,
  yesVoters,
  noVoters,
}) {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getVoteLogSheetName();

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!A:H`,
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
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetName = getVoteLogSheetName();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A:H`,
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

async function getUploadedReceiptAttachmentIds() {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getReceiptLogSheetName();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!K2:K`,
  });

  return new Set((response.data.values || []).flat().filter(Boolean));
}

async function appendReceiptUploadLog(logRows) {
  if (logRows.length === 0) return;

  const auth = getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getReceiptLogSheetName();

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!A:L`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: logRows,
    },
  });
}

module.exports = {
  appendVoteToSheet,
  getVoteHistory,
  getUploadedReceiptAttachmentIds,
  appendReceiptUploadLog,
};
