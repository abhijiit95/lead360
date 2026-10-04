import { pool } from "../config/database.js";
import type { PublicUser, UserWithPasswordHash } from "../types/auth.js";

export interface CreateUserRecord {
  name: string;
  email: string;
  passwordHash: string;
}

const publicUserColumns = "id, name, email, role, created_at, updated_at";

export const userRepository = {
  async create(input: CreateUserRecord): Promise<PublicUser> {
    const result = await pool.query<PublicUser>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING ${publicUserColumns}`,
      [input.name, input.email, input.passwordHash],
    );
    return result.rows[0];
  },

  async findByEmail(email: string): Promise<UserWithPasswordHash | null> {
    const result = await pool.query<UserWithPasswordHash>(
      `SELECT ${publicUserColumns}, password_hash
       FROM users
       WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  },
};
