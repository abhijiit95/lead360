import { AppError } from "../errors/app-error.js";
import { leadRepository } from "../repositories/lead.repository.js";
import type { CreateLeadInput, LeadFilters, LeadUpdateInput } from "../repositories/lead.repository.js";

function ensureFound<T>(value: T | null, id: string): T {
  if (value === null) {
    throw new AppError(`Lead ${id} was not found`, 404);
  }
  return value;
}

export const leadService = {
  createLead(input: CreateLeadInput) {
    return leadRepository.create(input);
  },

  getLeads(filters: LeadFilters) {
    return leadRepository.findAll(filters);
  },

  async getLeadById(id: string) {
    return ensureFound(await leadRepository.findById(id), id);
  },

  async updateLead(id: string, input: LeadUpdateInput) {
    if (Object.keys(input).length === 0) {
      throw new AppError("At least one lead field must be provided", 400);
    }
    return ensureFound(await leadRepository.update(id, input), id);
  },

  async deleteLead(id: string) {
    if (!(await leadRepository.delete(id))) {
      throw new AppError(`Lead ${id} was not found`, 404);
    }
  },
};
