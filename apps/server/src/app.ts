import express from "express";
import cors from "cors";
import fs from "node:fs";
import { config } from "./config.js";
import { getDb, closeDb } from "./db.js";
import { apiRouter } from "./routes/api.js";
import { errorHandler } from "./middleware.js";

export function createApp() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.exportsDir, { recursive: true });
  fs.mkdirSync(config.backupsDir, { recursive: true });
  getDb();

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
}

export function startServer() {
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[LCDS] API local en http://${config.host}:${config.port} (BD: ${config.dbPath})`,
    );
  });

  const shutdown = () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}
