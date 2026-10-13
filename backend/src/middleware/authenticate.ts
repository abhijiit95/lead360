import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../utils/access-token.js";

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

  const user = verifyAccessToken(match[1]);
  if (!user) {
    unauthorized(next);
    return;
  }
  request.auth = user;
  next();
}
