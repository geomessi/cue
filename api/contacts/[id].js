/**
 * PATCH /api/contacts/[id]
 *
 * Updates a contact's fields and returns the updated row.
 * Accepts: { status, name, company, role, notes, follow_up_hook, relationship_context }
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
  if (!id) return res.status(400).json({ error: "Missing contact id" });

  const {
    status,
    name,
    company,
    role,
    notes,
    follow_up_hook,
    relationship_context,
  } = req.body || {};

  const sql = neon(process.env.DATABASE_URL);

  try {
    const rows = await sql`
      UPDATE contacts SET
        status               = COALESCE(${status ?? null}, status),
        name                 = COALESCE(${name ?? null}, name),
        company              = COALESCE(${company ?? null}, company),
        role                 = COALESCE(${role ?? null}, role),
        notes                = COALESCE(${notes ?? null}, notes),
        follow_up_hook       = COALESCE(${follow_up_hook ?? null}, follow_up_hook),
        relationship_context = COALESCE(${relationship_context ?? null}, relationship_context),
        updated_at           = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }

    return res.status(200).json({ ok: true, contact: rows[0] });
  } catch (err) {
    console.error("contacts/[id]: update error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
