/**
 * POST /api/companies/enrich
 *
 * Accepts: { name }
 * Calls Claude to enrich a company by name and returns structured JSON.
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured" });
  }

  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    const enriched = await enrichCompany(name.trim());
    return res.status(200).json({ ok: true, ...enriched });
  } catch (err) {
    console.error("companies/enrich error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

export async function enrichCompany(name) {
  const prompt = `You know about many companies. For the company named "${name}", return a JSON object with exactly these keys:
{
  "website": "https://example.com or null",
  "industry": "e.g. Fintech, SaaS, Healthcare or null",
  "stage": "e.g. Seed, Series A, Series B, Public, or null",
  "description": "One crisp sentence describing what the company does"
}
Return ONLY valid JSON, no markdown, no explanation.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text ?? "";

  // Strip any markdown fences just in case
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}
