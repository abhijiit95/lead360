import express from "express";
import { authRouter } from "./routes/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { leadRouter } from "./routes/lead.routes.js";

export const app = express();
app.set("json spaces", 2);

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "leadflow360-api" });
});

app.use("/api/auth", authRouter);
app.use("/api/leads", leadRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found" });
});

app.use(errorHandler);
