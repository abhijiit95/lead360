import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { jwtExpiresIn, jwtSecret } from "../config/auth.js";
import type { AuthenticatedUser, PublicUser, UserRole } from "../types/auth.js";

/** Signs the existing LeadFlow360 JWT used by both password and Google OIDC login. */
export function createAccessToken(user: PublicUser | AuthenticatedUser, jwtId?: string): string {
  return jwt.sign(
    { name: user.name, email: user.email, role: user.role },
    jwtSecret,
    { algorithm: "HS256", subject: user.id, expiresIn: jwtExpiresIn as SignOptions["expiresIn"], ...(jwtId ? { jwtid: jwtId } : {}) },
  );
}

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
