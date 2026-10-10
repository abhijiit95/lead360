import { randomUUID } from "node:crypto";
import { mysqlPool } from "../config/mysql.js";
import type {
  CreateLeadInput,
  Lead,
  LeadFilters,
  LeadRepository,
  LeadUpdateInput,
  PaginatedLeads,
} from "./lead.repository.js";

const selectedLeadColumns = "id, name, email, phone, source, status, created_at, updated_at";
const updateColumns: ReadonlyArray<keyof LeadUpdateInput> = ["name", "email", "phone", "source", "status"];

export class MySqlLeadRepository implements LeadRepository {
  async create(input: CreateLeadInput): Promise<Lead> {
    const id = randomUUID();
    await mysqlPool.execute(
      `INSERT INTO leads (id, name, email, phone, source, status)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, 'new'))`,
      [id, input.name, input.email, input.phone, input.source, input.status ?? null],
    );
    const lead = await this.findById(id);
    if (!lead) {
      throw new Error("MySQL lead insert succeeded but the inserted lead could not be read");
    }
    return lead;
  }

  async findAll(filters: LeadFilters): Promise<PaginatedLeads> {
    const where: string[] = [];
    const filterValues: string[] = [];
    if (filters.status !== undefined) {
      where.push("status = ?");
      filterValues.push(filters.status);
    }
    if (filters.source !== undefined) {
      where.push("source = ?");
      filterValues.push(filters.source);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const offset = (filters.page - 1) * filters.limit;
    const [leadsResult, countResult] = await Promise.all([
      mysqlPool.execute(
        `SELECT ${selectedLeadColumns} FROM leads ${whereClause}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...filterValues, filters.limit, offset],
      ),
      mysqlPool.execute(
        `SELECT COUNT(*) AS total FROM leads ${whereClause}`,
        filterValues,
      ),
    ]);

    const leads = leadsResult[0] as Lead[];
    const countRows = countResult[0] as Array<{ total: number | string }>;
    const total = Number(countRows[0].total);
    return {
      data: leads,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findById(id: string): Promise<Lead | null> {
    const [rows] = await mysqlPool.execute(
      `SELECT ${selectedLeadColumns} FROM leads WHERE id = ?`,
      [id],
    );
    return (rows as Lead[])[0] ?? null;
  }

  async update(id: string, input: LeadUpdateInput): Promise<Lead | null> {
    const entries: Array<readonly [keyof LeadUpdateInput, string]> = updateColumns
      .filter((column) => input[column] !== undefined)
      .map((column) => [column, input[column] as string]);
    if (entries.length === 0) return this.findById(id);

    const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
    await mysqlPool.execute(
      `UPDATE leads SET ${assignments} WHERE id = ?`,
      [...entries.map(([, value]) => value), id],
    );
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const [result] = await mysqlPool.execute("DELETE FROM leads WHERE id = ?", [id]);
    return (result as { affectedRows: number }).affectedRows === 1;
  }
}
