import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { beginGoogleLink, beginGoogleLogin, googleOidcCallback, oidcLogout, oidcSession } from "../controllers/oidc.controller.js";

export const oidcRouter = Router();
oidcRouter.get("/google/login", beginGoogleLogin);
oidcRouter.post("/google/link", authenticate, beginGoogleLink);
oidcRouter.get("/google/callback", googleOidcCallback);
oidcRouter.get("/session", authenticate, oidcSession);
oidcRouter.post("/logout", authenticate, oidcLogout);
