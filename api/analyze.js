const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const ipHits = new Map();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = ipHits.get(ip);

  if (!record || now - record.startedAt >= RATE_LIMIT_WINDOW_MS) {
    ipHits.set(ip, { count: 1, startedAt: now });
    return false;
  }

  record.count += 1;
  return record.count > RATE_LIMIT_MAX_REQUESTS;
}

function cleanupRateLimit() {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, record] of ipHits.entries()) {
    if (record.startedAt < cutoff) {
      ipHits.delete(ip);
    }
  }
}

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Always allow same-origin requests (origin matches the host)
  const host = req.headers.host;
  if (!origin || (host && origin.includes(host))) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    return true;
  }

  return false;
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }

  const { model, max_tokens: maxTokens, messages } = body;
  if (typeof model !== "string" || model.trim() === "") {
    return "Missing model.";
  }

  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1500) {
    return "max_tokens must be an integer between 1 and 1500.";
  }

  if (!Array.isArray(messages) || messages.length !== 1) {
    return "Exactly one message is allowed.";
  }

  const [message] = messages;
  if (
    !message ||
    message.role !== "user" ||
    typeof message.content !== "string" ||
    message.content.length === 0 ||
    message.content.length > 12000
  ) {
    return "Message content must be a single user prompt under 12000 characters.";
  }

  return null;
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const corsAllowed = applyCors(req, res, allowedOrigins);

  if (req.method === "OPTIONS") {
    if (!corsAllowed) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!corsAllowed) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured" });
  }

  cleanupRateLimit();
  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  const validationError = validateBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const payload = {
    model: req.body.model,
    max_tokens: req.body.max_tokens,
    messages: req.body.messages,
  };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message });
  }
}
