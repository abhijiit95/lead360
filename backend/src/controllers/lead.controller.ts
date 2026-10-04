import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import { leadService } from "../services/lead.service.js";
import type { CreateLeadInput, LeadFilters, LeadUpdateInput } from "../repositories/lead.repository.js";

function queryString(value: unknown, name: string, maxLength: number): string | undefined {
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new AppError(`${name} must be a non-empty string of at most ${maxLength} characters`, 400);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string, defaultValue: number): number {
  if (typeof value === "undefined") return defaultValue;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AppError(`${name} must be a positive integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AppError(`${name} must be a safe integer`, 400);
  }
  return parsed;
}

function parseLeadFilters(request: Request): LeadFilters {
  const page = positiveInteger(request.query.page, "page", 1);
  const limit = positiveInteger(request.query.limit, "limit", 10);
  if (limit > 100) {
    throw new AppError("limit must not exceed 100", 400);
  }
  if (!Number.isSafeInteger((page - 1) * limit)) {
    throw new AppError("page and limit produce an unsafe offset", 400);
  }

  return {
    page,
    limit,
    status: queryString(request.query.status, "status", 50),
    source: queryString(request.query.source, "source", 100),
  };
}

function routeLeadId(request: Request): string {
  const id = request.params.id;
  if (typeof id !== "string") {
    throw new AppError("id must be a valid UUID", 400);
  }
  return id;
}

export async function createLead(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const lead = await leadService.createLead(request.body as CreateLeadInput);
    response.status(201).json(lead);
  } catch (error) {
    next(error);
  }
}

export async function getLeads(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    response.status(200).json(await leadService.getLeads(parseLeadFilters(request)));
  } catch (error) {
    next(error);
  }
}

export async function getLeadById(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    response.status(200).json(await leadService.getLeadById(routeLeadId(request)));
  } catch (error) {
    next(error);
  }
}

export async function updateLead(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    response.status(200).json(
      await leadService.updateLead(routeLeadId(request), request.body as LeadUpdateInput),
    );
  } catch (error) {
    next(error);
  }
}

export async function deleteLead(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await leadService.deleteLead(routeLeadId(request));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
}
