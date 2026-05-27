const { Readable } = require("stream");
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

async function uploadFileToDriveFolder({ url, filename, mimeType, folderId }) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const auth = getOAuthClient();
  const drive = google.drive({ version: "v3", auth });

  const uploadResponse = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });

  return uploadResponse.data;
}

module.exports = {
  uploadFileToDriveFolder,
};
