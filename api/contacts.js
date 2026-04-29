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
    let rows;

    if (q) {
      const pattern = `%${q}%`;
      rows = await sql`
        SELECT * FROM contacts
        WHERE
          (${status ? sql`status = ${status}` : sql`TRUE`})
          AND (${source ? sql`source = ${source}` : sql`TRUE`})
          AND (
            name    ILIKE ${pattern}
            OR company ILIKE ${pattern}
            OR role    ILIKE ${pattern}
            OR relationship_context ILIKE ${pattern}
          )
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * FROM contacts
        WHERE
          (${status ? sql`status = ${status}` : sql`TRUE`})
          AND (${source ? sql`source = ${source}` : sql`TRUE`})
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
    }

    return res.status(200).json({ ok: true, count: rows.length, contacts: rows });
  } catch (err) {
    console.error("contacts: query error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
