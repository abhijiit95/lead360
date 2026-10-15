import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import { sessionRevocationService } from "../services/session-revocation.service.js";
import { verifyAccessToken } from "../utils/access-token.js";

function unauthorized(next: NextFunction): void {
  next(new AppError("Authentication required: provide a valid Bearer token", 401));
}

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header("Authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  const bearerToken = match?.[1];
  const cookieToken = bearerToken ? undefined : readSessionCookie(request.header("Cookie"));
  const token = bearerToken ?? cookieToken;
  if (!token) {
    unauthorized(next);
    return;
  }

  if (cookieToken) {
    try {
      if (await sessionRevocationService.isRevoked(cookieToken)) {
        unauthorized(next);
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
  }

  // Cookie authentication is browser-initiated; require the configured frontend origin
  // on state-changing requests. Existing Bearer-token clients remain unchanged.
  if (cookieToken && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const expectedOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
    if (request.header("Origin") !== expectedOrigin) {
      next(new AppError("Cross-site request rejected", 403));
      return;
    }
  }

  const user = verifyAccessToken(token);
  if (!user) {
    unauthorized(next);
    return;
  }
  request.auth = user;
  next();
}

function readSessionCookie(cookieHeader?: string): string | undefined {
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith("lf_session="))?.slice("lf_session=".length);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}
