import { randomUUID } from "node:crypto";
import { model, models, Schema, type Model } from "mongoose";

export interface MongoLeadRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function isNonblank(value: string): boolean {
  return value.trim().length > 0;
}

const mongoLeadSchema = new Schema<MongoLeadRecord>(
  {
    id: { type: String, required: true, unique: true, default: () => randomUUID() },
    name: { type: String, required: true, trim: true, maxlength: 150, validate: isNonblank },
    email: { type: String, required: true, trim: true, maxlength: 255, validate: isNonblank },
    phone: { type: String, required: true, trim: true, maxlength: 30, validate: isNonblank },
    source: { type: String, required: true, trim: true, maxlength: 100, validate: isNonblank },
    status: { type: String, required: true, default: "new", trim: true, maxlength: 50, validate: isNonblank },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    versionKey: false,
  },
);

mongoLeadSchema.index({ createdAt: -1 });
mongoLeadSchema.index({ status: 1, source: 1, createdAt: -1 });
mongoLeadSchema.index({ source: 1, createdAt: -1 });

export const MongoLeadModel: Model<MongoLeadRecord> =
  (models.MongoLead as Model<MongoLeadRecord> | undefined)
  ?? model<MongoLeadRecord>("MongoLead", mongoLeadSchema, "leads");
