import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import type { UserRole } from "../types/auth.js";

export function authorizeRoles(...allowedRoles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.auth) {
      next(new AppError("Authentication required", 401));
      return;
    }
    if (!allowedRoles.includes(request.auth.role)) {
      next(new AppError("You do not have permission to perform this action", 403));
      return;
    }
    next();
  };
}
