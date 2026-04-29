/**
 * GET /api/contacts
 *
 * Returns all saved contacts from the database, sorted by most recently
 * touched. Supports optional query params:
 *
 *   ?status=active        filter by status (active | dormant | archived)
 *   ?source=email_import  filter by source
 *   ?q=Sarah              full-text search across name, company, role
 *   ?limit=50             max rows (default 100, max 500)
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is not configured" });
  }

  const { status, source, q, limit: limitParam } = req.query;
  const limit = Math.min(parseInt(limitParam ?? "100", 10) || 100, 500);

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Build a dynamic query with positional params — Neon's tagged template
    // literals don't support nested sql`` fragments, so we use the sql(query, params)
    // function-call form instead for conditional filtering.
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    if (source) {
      conditions.push(`source = $${params.length + 1}`);
      params.push(source);
    }
    if (q) {
      const pattern = `%${q}%`;
      const i = params.length + 1;
      conditions.push(
        `(name ILIKE $${i} OR company ILIKE $${i} OR role ILIKE $${i} OR relationship_context ILIKE $${i})`
      );
      params.push(pattern);
    }

    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `SELECT * FROM contacts ${where} ORDER BY updated_at DESC LIMIT $${params.length}`;

    const rows = await sql(query, params);

    return res.status(200).json({ ok: true, count: rows.length, contacts: rows });
  } catch (err) {
    console.error("contacts: query error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
