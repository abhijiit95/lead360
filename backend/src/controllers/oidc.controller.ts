import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { jwtExpiresIn } from "../config/auth.js";
import { googleOidcConfig, oidcSessionCookieName } from "../config/oidc.js";
import { AppError } from "../errors/app-error.js";
import { oidcService } from "../services/oidc.service.js";
import { sessionRevocationService } from "../services/session-revocation.service.js";
import { createAccessToken } from "../utils/access-token.js";

function expiresInSeconds(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d|w|y)$/);
  if (!match) return 3600;
  const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };
  return Number(match[1]) * unitSeconds[match[2]];
}

function setSessionCookie(response: Response, token: string): void {
  const parts = [
    `${oidcSessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${expiresInSeconds(jwtExpiresIn)}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(response: Response): void {
  const parts = [`${oidcSessionCookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function frontendCallback(status: string): string {
  const origin = googleOidcConfig?.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  return `${origin}/auth/callback?status=${encodeURIComponent(status)}`;
}

export function beginGoogleLogin(_request: Request, response: Response, next: NextFunction): void {
  void oidcService.beginLogin().then((url) => response.redirect(302, url)).catch(next);
}

export function beginGoogleLink(request: Request, response: Response, next: NextFunction): void {
  void oidcService.beginLink(request.auth!.id).then((url) => response.status(200).json({ authorizationUrl: url })).catch(next);
}

export async function googleOidcCallback(request: Request, response: Response, next: NextFunction): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  try {
    const result = await oidcService.callback(
      String(request.query.state ?? ""),
      typeof request.query.code === "string" ? request.query.code : undefined,
      typeof request.query.error === "string" ? request.query.error : undefined,
    );
    if (result.purpose === "link") {
      response.redirect(302, frontendCallback("linked"));
      return;
    }
    setSessionCookie(response, createAccessToken(result.user, randomUUID()));
    response.redirect(302, frontendCallback("success"));
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403 && error.message.includes("not linked")) {
      response.redirect(302, frontendCallback("account_not_linked"));
      return;
    }
    response.redirect(302, frontendCallback("login_failed"));
  }
}

export function oidcSession(request: Request, response: Response): void {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ user: request.auth });
}

export async function oidcLogout(request: Request, response: Response, next: NextFunction): Promise<void> {
  const token = readSessionCookie(request.header("Cookie"));
  if (!token) {
    clearSessionCookie(response);
    response.status(204).end();
    return;
  }
  try {
    await sessionRevocationService.revoke(token);
  } catch (error) {
    next(error);
    return;
  }
  clearSessionCookie(response);
  response.status(204).end();
}

function readSessionCookie(cookieHeader?: string): string | undefined {
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${oidcSessionCookieName}=`))?.slice(oidcSessionCookieName.length + 1);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}
