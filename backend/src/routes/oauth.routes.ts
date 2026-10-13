import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { beginOAuth, disconnectOAuth, oauthCallback, protectedResource } from "../controllers/oauth.controller.js";

export const oauthRouter = Router();
oauthRouter.get("/google/callback", oauthCallback);
oauthRouter.post("/google/connect", authenticate, beginOAuth);
oauthRouter.get("/google/resource", authenticate, protectedResource);
oauthRouter.delete("/google/connection", authenticate, disconnectOAuth);
