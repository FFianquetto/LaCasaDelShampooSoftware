import path from "node:path";
import os from "node:os";

function defaultDataDir(): string {
  if (process.env.LCDS_DATA_DIR) return process.env.LCDS_DATA_DIR;
  const appData =
    process.env.APPDATA ||
    path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "LaCasaDelShampoo");
}

export const config = {
  port: Number(process.env.LCDS_PORT || 5100),
  host: process.env.LCDS_HOST || "127.0.0.1",
  dataDir: defaultDataDir(),
  get dbPath() {
    return (
      process.env.LCDS_DB_PATH ||
      path.join(this.dataDir, "lacasadelshampoo.db")
    );
  },
  get exportsDir() {
    return path.join(this.dataDir, "exports");
  },
  get backupsDir() {
    return path.join(this.dataDir, "backups");
  },
  sessionHours: 12,
  printMode: (process.env.LCDS_PRINT_MODE || "simulate") as
    | "simulate"
    | "system",
};
