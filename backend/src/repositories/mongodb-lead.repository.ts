import { randomUUID } from "node:crypto";
import { MongoLeadModel, type MongoLeadRecord } from "../models/mongodb-lead.model.js";
import type {
  CreateLeadInput,
  Lead,
  LeadFilters,
  LeadRepository,
  LeadUpdateInput,
  PaginatedLeads,
} from "./lead.repository.js";

function toLead(record: MongoLeadRecord): Lead {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    source: record.source,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export class MongoDBLeadRepository implements LeadRepository {
  async create(input: CreateLeadInput): Promise<Lead> {
    const record = await MongoLeadModel.create({
      id: randomUUID(),
      ...input,
      status: input.status ?? "new",
    });
    return toLead(record);
  }

  async findAll(filters: LeadFilters): Promise<PaginatedLeads> {
    const filter: Partial<Pick<MongoLeadRecord, "status" | "source">> = {};
    if (filters.status !== undefined) filter.status = filters.status;
    if (filters.source !== undefined) filter.source = filters.source;

    const offset = (filters.page - 1) * filters.limit;
    const [records, total] = await Promise.all([
      MongoLeadModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(filters.limit)
        .lean()
        .exec(),
      MongoLeadModel.countDocuments(filter).exec(),
    ]);

    return {
      data: records.map((record) => toLead(record)),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findById(id: string): Promise<Lead | null> {
    const record = await MongoLeadModel.findOne({ id }).lean().exec();
    return record ? toLead(record) : null;
  }

  async update(id: string, input: LeadUpdateInput): Promise<Lead | null> {
    const updates: Partial<Pick<MongoLeadRecord, "name" | "email" | "phone" | "source" | "status">> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.email !== undefined) updates.email = input.email;
    if (input.phone !== undefined) updates.phone = input.phone;
    if (input.source !== undefined) updates.source = input.source;
    if (input.status !== undefined) updates.status = input.status;

    const record = await MongoLeadModel.findOneAndUpdate(
      { id },
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    ).exec();
    return record ? toLead(record) : null;
  }

  async delete(id: string): Promise<boolean> {
    const record = await MongoLeadModel.findOneAndDelete({ id }).exec();
    return record !== null;
  }
}
