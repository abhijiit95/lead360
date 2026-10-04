import { Router } from "express";
import {
  createLead,
  deleteLead,
  getLeadById,
  getLeads,
  updateLead,
} from "../controllers/lead.controller.js";
import { validateLeadCreate, validateLeadUpdate, validateLeadId } from "../middleware/validate-lead.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeRoles } from "../middleware/authorize-roles.js";

export const leadRouter = Router();

leadRouter.use(authenticate);

leadRouter.get("/", getLeads);
leadRouter.post("/", authorizeRoles("admin"), validateLeadCreate, createLead);
leadRouter.get("/:id", validateLeadId, getLeadById);
leadRouter.patch("/:id", validateLeadId, validateLeadUpdate, updateLead);
leadRouter.delete("/:id", authorizeRoles("admin"), validateLeadId, deleteLead);
