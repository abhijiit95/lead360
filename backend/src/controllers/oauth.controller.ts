import type { Request, Response, NextFunction } from "express";
import { oauthService } from "../services/oauth.service.js";

export function beginOAuth(request: Request, response: Response, next: NextFunction): void {
  void oauthService.begin(request.auth!.id).then((url) => response.redirect(302, url)).catch(next);
}

export async function oauthCallback(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    await oauthService.callback(String(request.query.state ?? ""), typeof request.query.code === "string" ? request.query.code : undefined, typeof request.query.error === "string" ? request.query.error : undefined);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ connected: true, provider: "google", message: "Google API authorization completed" });
  } catch (error) { next(error); }
}

export async function protectedResource(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ data: await oauthService.resource(request.auth!.id) });
  } catch (error) { next(error); }
}

export async function disconnectOAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { await oauthService.revoke(request.auth!.id); response.status(204).end(); }
  catch (error) { next(error); }
}
