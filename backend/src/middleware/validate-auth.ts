import type { Request, Response, NextFunction } from "express";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isObjectBody(request: Request, response: Response): Record<string, unknown> | null {
  const body: unknown = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "Request body must be a JSON object" });
    return null;
  }
  return body as Record<string, unknown>;
}

function rejectUnknownFields(values: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(values)
    .filter((field) => !allowed.includes(field))
    .map((field) => `${field} is not an allowed field`);
}

export function validateRegistration(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const values = isObjectBody(request, response);
  if (!values) return;

  const errors = rejectUnknownFields(values, ["name", "email", "password"]);
  if (typeof values.name !== "string" || values.name.trim().length === 0) {
    errors.push("name is required and must be a non-empty string");
  } else if (values.name.trim().length > 150) {
    errors.push("name must be at most 150 characters");
  }
  if (typeof values.email !== "string" || !emailPattern.test(values.email.trim())) {
    errors.push("email must be a valid email address");
  } else if (values.email.trim().length > 255) {
    errors.push("email must be at most 255 characters");
  }
  if (typeof values.password !== "string" || values.password.length < 8) {
    errors.push("password must be at least 8 characters");
  } else if (Buffer.byteLength(values.password, "utf8") > 72) {
    errors.push("password must not exceed 72 bytes");
  }

  if (errors.length > 0) {
    response.status(400).json({ error: "Validation failed", details: errors });
    return;
  }

  request.body = {
    name: (values.name as string).trim(),
    email: (values.email as string).trim().toLowerCase(),
    password: values.password as string,
  };
  next();
}

export function validateLogin(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const values = isObjectBody(request, response);
  if (!values) return;

  const errors = rejectUnknownFields(values, ["email", "password"]);
  if (typeof values.email !== "string" || !emailPattern.test(values.email.trim())) {
    errors.push("email must be a valid email address");
  } else if (values.email.trim().length > 255) {
    errors.push("email must be at most 255 characters");
  }
  if (typeof values.password !== "string" || values.password.length === 0) {
    errors.push("password is required");
  } else if (Buffer.byteLength(values.password, "utf8") > 72) {
    errors.push("password must not exceed 72 bytes");
  }

  if (errors.length > 0) {
    response.status(400).json({ error: "Validation failed", details: errors });
    return;
  }

  request.body = {
    email: (values.email as string).trim().toLowerCase(),
    password: values.password as string,
  };
  next();
}
