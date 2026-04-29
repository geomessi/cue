/**
 * POST /api/email/ingest
 *
 * Receives Gmail push notifications from Google Cloud Pub/Sub.
 * For each new email, fetches the full message via Gmail REST API,
 * sends it to Claude for contact extraction, and upserts every person
 * found into the contacts table.
 *
 * Pub/Sub expects HTTP 200 on success. Any non-200 triggers a retry,
 * so this handler returns 200 even for soft errors (bad token, etc.)
 * and only uses non-200 codes for misconfiguration that should surface.
 */

import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Gmail REST helpers (no googleapis SDK — keeps the bundle tiny)
// ---------------------------------------------------------------------------

async function getAccessToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`OAuth token refresh failed: ${data.error} — ${data.error_description}`);
  }
  return data.access_token;
}

async function gmailGet(path, accessToken) {
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gmail API ${resp.status} on ${path}: ${body}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Email body extraction (handles multipart MIME recursively)
// ---------------------------------------------------------------------------

function extractPlainText(part) {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf-8");
  }
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractPlainText(child);
      if (text) return text;
    }
  }
  return "";
}

function parseEmailPayload(payload) {
  const header = (name) =>
    payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  return {
    from: header("From"),
    to: header("To"),
    cc: header("Cc"),
    replyTo: header("Reply-To"),
    date: header("Date"),
    subject: header("Subject"),
    body: extractPlainText(payload),
  };
}

// ---------------------------------------------------------------------------
// Claude contact extraction
// ---------------------------------------------------------------------------

function buildPrompt(email, myEmail) {
  return `You are a contact-intelligence assistant. Extract every person mentioned, introduced, or participating in the email below and return them as a JSON array.

EMAIL:
From: ${email.from}
To: ${email.to}${email.cc ? `\nCC: ${email.cc}` : ""}${email.replyTo ? `\nReply-To: ${email.replyTo}` : ""}
Date: ${email.date}
Subject: ${email.subject}

Body:
${email.body.slice(0, 6000)}

---
INSTRUCTIONS
Extract ALL of the following:
• The sender
• Every To / CC recipient
• Anyone being introduced ("I'd like to introduce you to…")
• Anyone mentioned by name with enough context to identify them

For each person return a JSON object with EXACTLY these keys:
{
  "name": "Full Name",
  "email": "address@example.com or null",
  "company": "Company name or null",
  "role": "Job title or null",
  "relationship_context": "1–2 sentences: who this person is and why they appear in this email (e.g. 'Partner at Andreessen Horowitz interested in your seed round', 'Mutual connection from YC who made the intro')",
  "follow_up_hook": "The single most natural next action (e.g. 'Send deck and schedule 30-min call', 'Reply to thank them for the intro', 'Follow up in two weeks on due diligence')"
}

Rules:
• Extract emails, companies, and roles from signatures, email addresses (name@company.com), and body text.
• relationship_context must capture WHY this person is relevant — not just their title.
• follow_up_hook must be specific and actionable, never generic like "follow up".
• Omit ${myEmail} — that is the inbox owner, not a contact to import.
• If a field is unknown, use null — never guess or hallucinate values.
• Return ONLY a valid JSON array with no markdown, no explanation.`;
}

async function extractContactsWithClaude(email, myEmail) {
  const prompt = buildPrompt(email, myEmail);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text ?? "";

  // Tolerate any surrounding text by grabbing the first JSON array
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Claude returned no JSON array. Raw: ${text.slice(0, 300)}`);

  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function isAlreadyProcessed(sql, gmailMessageId) {
  const rows = await sql`
    SELECT id FROM email_history WHERE gmail_message_id = ${gmailMessageId}
  `;
  return rows.length > 0;
}

async function upsertContacts(sql, contacts) {
  const savedIds = [];

  for (const c of contacts) {
    if (!c.name || typeof c.name !== "string") continue;

    let rows;

    if (c.email) {
      // Upsert by email when we have one
      rows = await sql`
        INSERT INTO contacts
          (name, email, company, role, last_contact_date,
           relationship_context, follow_up_hook, source, status)
        VALUES
          (${c.name}, ${c.email}, ${c.company ?? null}, ${c.role ?? null},
           CURRENT_DATE, ${c.relationship_context ?? null},
           ${c.follow_up_hook ?? null}, 'email_import', 'active')
        ON CONFLICT (email) DO UPDATE SET
          name                 = EXCLUDED.name,
          company              = COALESCE(EXCLUDED.company, contacts.company),
          role                 = COALESCE(EXCLUDED.role, contacts.role),
          last_contact_date    = CURRENT_DATE,
          relationship_context = EXCLUDED.relationship_context,
          follow_up_hook       = EXCLUDED.follow_up_hook,
          updated_at           = NOW()
        RETURNING id
      `;
    } else {
      // No email — always insert as a new record (NULL doesn't conflict)
      rows = await sql`
        INSERT INTO contacts
          (name, company, role, last_contact_date,
           relationship_context, follow_up_hook, source, status)
        VALUES
          (${c.name}, ${c.company ?? null}, ${c.role ?? null},
           CURRENT_DATE, ${c.relationship_context ?? null},
           ${c.follow_up_hook ?? null}, 'email_import', 'active')
        RETURNING id
      `;
    }

    if (rows[0]?.id) savedIds.push(rows[0].id);
  }

  return savedIds;
}

async function recordEmailProcessed(sql, gmailMessageId, subject, contactCount) {
  await sql`
    INSERT INTO email_history (gmail_message_id, subject, contacts_extracted)
    VALUES (${gmailMessageId}, ${subject ?? null}, ${contactCount})
    ON CONFLICT (gmail_message_id) DO NOTHING
  `;
}

async function getLastHistoryId(sql) {
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = 'last_gmail_history_id'
  `;
  return rows[0]?.value ?? null;
}

async function saveHistoryId(sql, historyId) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('last_gmail_history_id', ${historyId}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate webhook secret — use 200 so Pub/Sub doesn't retry on auth failures
  const secret = process.env.PUBSUB_WEBHOOK_SECRET;
  if (!secret || req.query.token !== secret) {
    console.warn("ingest: invalid or missing webhook token");
    return res.status(200).json({ ok: false, reason: "unauthorized" });
  }

  // Check required env vars
  const missing = [
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GMAIL_USER_EMAIL",
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    console.error("ingest: missing env vars:", missing.join(", "));
    return res.status(500).json({ ok: false, reason: "misconfigured", missing });
  }

  // Parse Pub/Sub message envelope
  let historyId, emailAddress;
  try {
    const message = req.body?.message;
    if (!message?.data) {
      return res.status(200).json({ ok: false, reason: "no message.data" });
    }
    const decoded = JSON.parse(Buffer.from(message.data, "base64").toString("utf-8"));
    historyId = String(decoded.historyId);
    emailAddress = decoded.emailAddress;
  } catch (err) {
    console.error("ingest: failed to parse Pub/Sub envelope:", err.message);
    return res.status(200).json({ ok: false, reason: "bad envelope" });
  }

  const myEmail = process.env.GMAIL_USER_EMAIL;
  const sql = neon(process.env.DATABASE_URL);

  try {
    const accessToken = await getAccessToken();
    const lastHistoryId = await getLastHistoryId(sql);

    // Determine which message IDs are new since the last notification
    let messageIds = [];

    if (lastHistoryId) {
      const history = await gmailGet(
        `/history?startHistoryId=${lastHistoryId}&historyTypes=messageAdded`,
        accessToken
      );
      messageIds = (history.history ?? [])
        .flatMap((h) => h.messagesAdded ?? [])
        .map((m) => m.message.id);
    } else {
      // Cold start: process the single message that triggered this notification.
      // Gmail doesn't give us the messageId in the push payload, so we search
      // for the most recent message in the inbox (safe for first-run only).
      const list = await gmailGet("/messages?maxResults=1&q=in:inbox", accessToken);
      messageIds = (list.messages ?? []).map((m) => m.id);
    }

    // Persist the new watermark immediately so parallel invocations don't overlap
    await saveHistoryId(sql, historyId);

    if (messageIds.length === 0) {
      return res.status(200).json({ ok: true, contacts: 0, reason: "no new messages" });
    }

    let totalContacts = 0;

    for (const messageId of messageIds) {
      if (await isAlreadyProcessed(sql, messageId)) {
        console.log(`ingest: skipping already-processed message ${messageId}`);
        continue;
      }

      // Fetch full email from Gmail
      const msg = await gmailGet(`/messages/${messageId}?format=full`, accessToken);
      const email = parseEmailPayload(msg.payload);

      if (!email.body && !email.from) {
        console.warn(`ingest: message ${messageId} has no body or from header — skipping`);
        continue;
      }

      // Extract contacts with Claude
      const contacts = await extractContactsWithClaude(email, myEmail);

      // Save to database
      const savedIds = await upsertContacts(sql, contacts);
      await recordEmailProcessed(sql, messageId, email.subject, savedIds.length);
      totalContacts += savedIds.length;

      console.log(
        `ingest: message ${messageId} ("${email.subject}") → ${savedIds.length} contacts`
      );
    }

    return res.status(200).json({ ok: true, contacts: totalContacts });
  } catch (err) {
    // Log the real error server-side but return 200 so Pub/Sub stops retrying.
    // Change to 500 if you want Pub/Sub to retry on transient failures.
    console.error("ingest: unhandled error:", err.message);
    return res.status(200).json({ ok: false, reason: err.message });
  }
}
