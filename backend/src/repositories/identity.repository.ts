import { pool } from "../config/database.js";
import type { PublicUser } from "../types/auth.js";

export const identityRepository = {
  async findGoogleUser(subject: string): Promise<PublicUser | null> {
    const result = await pool.query<PublicUser>(
      `SELECT u.id, u.name, u.email, u.role, u.created_at, u.updated_at
       FROM user_identities i JOIN users u ON u.id = i.user_id
       WHERE i.provider = 'google' AND i.provider_subject = $1`,
      [subject],
    );
    return result.rows[0] ?? null;
  },

  async linkGoogleIdentity(userId: string, subject: string): Promise<void> {
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_subject)
       VALUES ($1, 'google', $2)`,
      [userId, subject],
    );
  },
};
