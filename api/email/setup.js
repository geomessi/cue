/**
 * POST /api/email/setup
 *
 * One-time setup: registers a Gmail Push Notification watch so Google
 * sends a Pub/Sub message to your /api/email/ingest endpoint every time
 * a new email arrives in grm.secret.network@gmail.com.
 *
 * Gmail watch() expiration is ~7 days, so call this endpoint again
 * (or set up a weekly cron) to renew it before it expires.
 *
 * Call with:
 *   curl -X POST https://<your-app>.vercel.app/api/email/setup \
 *        -H "Authorization: Bearer <SETUP_SECRET>"
 */

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
    throw new Error(`OAuth refresh failed: ${data.error} — ${data.error_description}`);
  }
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Protect this endpoint with a separate secret so it can't be called by accident
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!process.env.SETUP_SECRET || token !== process.env.SETUP_SECRET) {
    return res.status(401).json({ error: "Unauthorized — provide Authorization: Bearer <SETUP_SECRET>" });
  }

  const missing = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_CLOUD_PROJECT_ID",
    "PUBSUB_TOPIC_NAME",
    "PUBSUB_WEBHOOK_SECRET",
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return res.status(500).json({ error: "Missing env vars", missing });
  }

  const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC_NAME}`;

  try {
    const accessToken = await getAccessToken();

    const watchResp = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicName,
          labelIds: ["INBOX"],          // Only notify for inbox mail
          labelFilterBehavior: "INCLUDE",
        }),
      }
    );

    const watchData = await watchResp.json();

    if (!watchResp.ok) {
      return res.status(502).json({
        error: "Gmail watch() failed",
        detail: watchData,
      });
    }

    // watchData = { historyId: "...", expiration: "<unix ms timestamp>" }
    const expiresAt = new Date(Number(watchData.expiration));

    return res.status(200).json({
      ok: true,
      historyId: watchData.historyId,
      expiresAt: expiresAt.toISOString(),
      message: `Gmail push notifications active until ${expiresAt.toUTCString()}. Re-run this endpoint before then to renew.`,
    });
  } catch (err) {
    console.error("setup: error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
