import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";
import type { LoginInput, RegisterInput } from "../types/auth.js";

export async function register(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await authService.register(request.body as RegisterInput);
    response.status(201).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function login(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    response.status(200).json(await authService.login(request.body as LoginInput));
  } catch (error) {
    next(error);
  }
}
