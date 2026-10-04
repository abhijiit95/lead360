import { Router } from "express";
import { login, register } from "../controllers/auth.controller.js";
import { validateLogin, validateRegistration } from "../middleware/validate-auth.js";

export const authRouter = Router();

authRouter.post("/register", validateRegistration, register);
authRouter.post("/login", validateLogin, login);
