import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { jwtSecret } from "../config/auth.js";
import { AppError } from "../errors/app-error.js";
import type { UserRole } from "../types/auth.js";

function unauthorized(next: NextFunction): void {
  next(new AppError("Authentication required: provide a valid Bearer token", 401));
}

export function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const authorization = request.header("Authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    unauthorized(next);
    return;
  }

  try {
    const payload = jwt.verify(match[1], jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload === "string") {
      unauthorized(next);
      return;
    }

    const claims = payload as JwtPayload & { name?: unknown; email?: unknown; role?: unknown };
    if (
      typeof claims.sub !== "string" ||
      typeof claims.name !== "string" ||
      typeof claims.email !== "string" ||
      (claims.role !== "admin" && claims.role !== "agent")
    ) {
      unauthorized(next);
      return;
    }

    request.auth = {
      id: claims.sub,
      name: claims.name,
      email: claims.email,
      role: claims.role as UserRole,
    };
    next();
  } catch {
    unauthorized(next);
  }
}
