#!/usr/bin/env node
/**
 * scripts/get-oauth-token.mjs
 *
 * Run this ONCE locally to obtain a Gmail OAuth2 refresh token.
 * The refresh token is then stored as GOOGLE_REFRESH_TOKEN in Vercel.
 *
 * Usage:
 *   1. Fill in CLIENT_ID and CLIENT_SECRET below (from Google Cloud Console).
 *   2. node scripts/get-oauth-token.mjs
 *   3. Open the printed URL in your browser.
 *   4. Sign in as grm.secret.network@gmail.com and approve access.
 *   5. Copy the `code` param from the redirect URL and paste it here.
 *   6. The script prints your refresh_token — save it in Vercel env vars.
 */

import * as http from "http";
import * as readline from "readline";

// ─── Fill these in before running ────────────────────────────────────────────
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "PASTE_YOUR_CLIENT_ID_HERE";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "PASTE_YOUR_CLIENT_SECRET_HERE";
const REDIRECT_URI = "http://localhost:3456";
// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",  // needed for watch()
].join(" ");

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +   // essential — gets you a refresh_token
  `&prompt=consent`;         // forces Google to return a new refresh_token

console.log("\n📋  Open this URL in your browser (sign in as grm.secret.network@gmail.com):\n");
console.log(authUrl);
console.log("\nWaiting for the OAuth redirect on http://localhost:3456 …\n");

// Spin up a temporary local server to catch the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400);
    res.end(`OAuth error: ${error}`);
    console.error("OAuth error:", error);
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(400);
    res.end("No code in redirect — try again.");
    server.close();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h2>✅ Auth code received — check your terminal for the refresh token.</h2>");

  server.close();

  // Exchange the code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenResp.json();

  if (!tokenResp.ok) {
    console.error("\n❌  Token exchange failed:", tokens);
    return;
  }

  console.log("\n✅  Success!\n");
  console.log("─".repeat(60));
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("─".repeat(60));
  console.log("\nAdd that to your Vercel environment variables:");
  console.log("  vercel env add GOOGLE_REFRESH_TOKEN\n");

  if (!tokens.refresh_token) {
    console.warn(
      "⚠️  No refresh_token in the response. This usually means the account\n" +
      "   already granted access previously. Go to https://myaccount.google.com/permissions,\n" +
      "   revoke access for your app, then re-run this script."
    );
  }
});

server.listen(3456, "localhost");
