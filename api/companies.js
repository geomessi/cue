/**
 * GET  /api/companies  — list companies, optional ?status= filter
 * POST /api/companies  — upsert a company by name
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is not configured" });
  }

  const sql = neon(process.env.DATABASE_URL);

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { status } = req.query;

    try {
      const conditions = [];
      const params = [];

      if (status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(status);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `SELECT * FROM companies ${where} ORDER BY updated_at DESC`;
      const rows = await sql(query, params);

      return res.status(200).json({ ok: true, count: rows.length, companies: rows });
    } catch (err) {
      console.error("companies GET error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { name, website, industry, stage, description, notes, status } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    try {
      const rows = await sql`
        INSERT INTO companies (name, website, industry, stage, description, notes, status)
        VALUES (
          ${name.trim()},
          ${website ?? null},
          ${industry ?? null},
          ${stage ?? null},
          ${description ?? null},
          ${notes ?? null},
          ${status ?? 'pending_review'}
        )
        ON CONFLICT (lower(name)) DO UPDATE SET
          website     = COALESCE(EXCLUDED.website, companies.website),
          industry    = COALESCE(EXCLUDED.industry, companies.industry),
          stage       = COALESCE(EXCLUDED.stage, companies.stage),
          description = COALESCE(EXCLUDED.description, companies.description),
          notes       = COALESCE(EXCLUDED.notes, companies.notes),
          updated_at  = NOW()
        RETURNING *
      `;

      return res.status(200).json({ ok: true, company: rows[0] });
    } catch (err) {
      console.error("companies POST error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
