/**
 * PATCH /api/companies/[id]
 *
 * Updates a company's fields and returns the updated row.
 * Accepts: { status, name, website, industry, stage, description, notes }
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is not configured" });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing company id" });

  const {
    status,
    name,
    website,
    industry,
    stage,
    description,
    notes,
    category,
  } = req.body || {};

  const sql = neon(process.env.DATABASE_URL);

  try {
    const rows = await sql`
      UPDATE companies SET
        status      = COALESCE(${status ?? null}, status),
        name        = COALESCE(${name ?? null}, name),
        website     = COALESCE(${website ?? null}, website),
        industry    = COALESCE(${industry ?? null}, industry),
        stage       = COALESCE(${stage ?? null}, stage),
        description = COALESCE(${description ?? null}, description),
        notes       = COALESCE(${notes ?? null}, notes),
        category    = COALESCE(${category ?? null}, category),
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    return res.status(200).json({ ok: true, company: rows[0] });
  } catch (err) {
    console.error("companies/[id]: update error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
