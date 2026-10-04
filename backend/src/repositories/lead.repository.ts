import { pool } from "../config/database.js";

export interface CreateLeadInput {
  name: string;
  email: string;
  phone: string;
  source: string;
  status?: string;
}

export type LeadUpdateInput = Partial<CreateLeadInput>;

export interface LeadFilters {
  page: number;
  limit: number;
  status?: string;
  source?: string;
}

export interface PaginatedLeads {
  data: Lead[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Lead extends Omit<CreateLeadInput, "status"> {
  id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export const leadRepository = {
  async create(input: CreateLeadInput): Promise<Lead> {
    const result = await pool.query<Lead>(
      `INSERT INTO leads (name, email, phone, source, status)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'new'))
       RETURNING id, name, email, phone, source, status, created_at, updated_at`,
      [input.name, input.email, input.phone, input.source, input.status ?? null],
    );
    return result.rows[0];
  },

  async findAll(filters: LeadFilters): Promise<PaginatedLeads> {
    const filterValues = [filters.status ?? null, filters.source ?? null];
    const offset = (filters.page - 1) * filters.limit;
    const [leadsResult, countResult] = await Promise.all([
      pool.query<Lead>(
        `SELECT id, name, email, phone, source, status, created_at, updated_at
         FROM leads
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR source = $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [...filterValues, filters.limit, offset],
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM leads
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR source = $2)`,
        filterValues,
      ),
    ]);

    const total = Number(countResult.rows[0].total);
    return {
      data: leadsResult.rows,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  },

  async findById(id: string): Promise<Lead | null> {
    const result = await pool.query<Lead>(
      `SELECT id, name, email, phone, source, status, created_at, updated_at
       FROM leads WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async update(id: string, input: LeadUpdateInput): Promise<Lead | null> {
    const result = await pool.query<Lead>(
      `UPDATE leads
       SET name = CASE WHEN $1 THEN $2 ELSE name END,
           email = CASE WHEN $3 THEN $4 ELSE email END,
           phone = CASE WHEN $5 THEN $6 ELSE phone END,
           source = CASE WHEN $7 THEN $8 ELSE source END,
           status = CASE WHEN $9 THEN $10 ELSE status END,
           updated_at = NOW()
       WHERE id = $11
       RETURNING id, name, email, phone, source, status, created_at, updated_at`,
      [
        input.name !== undefined, input.name ?? null,
        input.email !== undefined, input.email ?? null,
        input.phone !== undefined, input.phone ?? null,
        input.source !== undefined, input.source ?? null,
        input.status !== undefined, input.status ?? null,
        id,
      ],
    );
    return result.rows[0] ?? null;
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query("DELETE FROM leads WHERE id = $1", [id]);
    return result.rowCount === 1;
  },
};
