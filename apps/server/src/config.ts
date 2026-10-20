import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

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

function envFileCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(defaultDataDir(), ".env"),
    path.resolve(here, "../../..", ".env"),
  ];
}

function readEnvFile(): Record<string, string> {
  const values: Record<string, string> = {};
  const envPath = envFileCandidates().find((candidate) => fs.existsSync(candidate));
  if (!envPath) return values;
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function envValue(key: string): string {
  const fromFile = readEnvFile()[key]?.trim();
  if (fromFile) return fromFile;
  return (process.env[key] || "").trim();
}

function smtpHostFor(email: string): string {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "smtp.gmail.com";
  if (
    domain.startsWith("outlook.") ||
    domain.startsWith("hotmail.") ||
    domain.startsWith("live.") ||
    domain === "msn.com"
  ) {
    return "smtp-mail.outlook.com";
  }
  return "";
}

export function mailSettings(): {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
} | null {
  const user = envValue("LCDS_SMTP_USER");
  const pass = envValue("LCDS_SMTP_PASS").replace(/\s+/g, "");
  const from = envValue("LCDS_SMTP_FROM") || user;
  const host = envValue("LCDS_SMTP_HOST") || smtpHostFor(from);
  const port = Number(envValue("LCDS_SMTP_PORT") || 587);
  if (!host || !user || !pass || !from) return null;
  return { host, port, user, pass, from };
}

export function whatsappSettings(): {
  token: string;
  phoneNumberId: string;
  templateName: string;
  templateLang: string;
  apiVersion: string;
} | null {
  const token = envValue("LCDS_WHATSAPP_TOKEN");
  const phoneNumberId = envValue("LCDS_WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    templateName: envValue("LCDS_WHATSAPP_TEMPLATE"),
    templateLang: envValue("LCDS_WHATSAPP_TEMPLATE_LANG") || "es_MX",
    apiVersion: envValue("LCDS_WHATSAPP_API_VERSION") || "v21.0",
  };
}
