import jwt, { type JwtPayload } from "jsonwebtoken";
import { jwtSecret } from "../config/auth.js";
import type { AuthenticatedUser, UserRole } from "../types/auth.js";

/** Verifies a LeadFlow360 access token using the same rules for REST and Socket.IO. */
export function verifyAccessToken(token: string): AuthenticatedUser | null {
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload === "string") return null;

    const claims = payload as JwtPayload & { name?: unknown; email?: unknown; role?: unknown };
    if (
      typeof claims.sub !== "string" ||
      typeof claims.name !== "string" ||
      typeof claims.email !== "string" ||
      (claims.role !== "admin" && claims.role !== "agent")
    ) return null;

    return {
      id: claims.sub,
      name: claims.name,
      email: claims.email,
      role: claims.role as UserRole,
    };
  } catch {
    return null;
  }
}
