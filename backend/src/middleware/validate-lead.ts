import type { Request, Response, NextFunction } from "express";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fields = ["name", "email", "phone", "source", "status"] as const;
const maxLengths = { name: 150, email: 255, phone: 30, source: 100, status: 50 };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBody(requiredFields: readonly string[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const body: unknown = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      response.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    const values = body as Record<string, unknown>;
    const errors: string[] = [];

    for (const key of Object.keys(values)) {
      if (!fields.includes(key as (typeof fields)[number])) {
        errors.push(`${key} is not an allowed lead field`);
      }
    }

    for (const field of requiredFields) {
      if (!(field in values)) errors.push(`${field} is required`);
    }

    for (const field of fields) {
      if (!(field in values)) continue;
      const value = values[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`${field} must be a non-empty string`);
      } else if (value.trim().length > maxLengths[field]) {
        errors.push(`${field} must be at most ${maxLengths[field]} characters`);
      }
    }

    if (typeof values.email === "string" && !emailPattern.test(values.email.trim())) {
      errors.push("email must be a valid email address");
    }

    if (errors.length > 0) {
      response.status(400).json({ error: "Validation failed", details: errors });
      return;
    }

    request.body = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, (value as string).trim()]),
    );
    next();
  };
}

export const validateLeadCreate = validateBody(["name", "email", "phone", "source"]);
export const validateLeadUpdate = validateBody([]);

export function validateLeadId(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (typeof request.params.id !== "string" || !uuidPattern.test(request.params.id)) {
    response.status(400).json({ error: "id must be a valid UUID" });
    return;
  }
  next();
}
