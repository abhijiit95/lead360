import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "Malformed JSON request body" });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const databaseError = error as { code: string };
    if (databaseError.code === "23505") {
      response.status(409).json({ error: "A record with this unique value already exists" });
      return;
    }
    if (databaseError.code === "23514") {
      response.status(400).json({ error: "Lead data violates a database constraint" });
      return;
    }
  }

  console.error("Request failed:", error);
  response.status(500).json({ error: "Internal server error" });
};
