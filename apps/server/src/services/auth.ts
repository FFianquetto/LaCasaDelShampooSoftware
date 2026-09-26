import bcrypt from "bcryptjs";
import { newId, nowIso } from "@lcds/db";
import type { Session, User, Store } from "@lcds/shared";
import type { Db } from "@lcds/db";
import { AppError, assertFound } from "../errors.js";
import { mapStore, mapUser } from "../mappers.js";
import { config } from "../config.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function login(
  db: Db,
  username: string,
  password: string,
): Promise<Session> {
  const row = db
    .prepare("SELECT * FROM users WHERE username = ? AND active = 1")
    .get(username) as Record<string, unknown> | undefined;

  if (!row) throw new AppError("Usuario o contraseña incorrectos", 401, "AUTH");

  const ok = await verifyPassword(password, String(row.password_hash));
  if (!ok) throw new AppError("Usuario o contraseña incorrectos", 401, "AUTH");

  const storeRow = db
    .prepare("SELECT * FROM stores WHERE id = ?")
    .get(row.store_id) as Record<string, unknown> | undefined;
  const store = mapStore(assertFound(storeRow, "Sucursal no encontrada"));
  const user = mapUser(row);

  const token = newId("tok");
  const expires = new Date(
    Date.now() + config.sessionHours * 60 * 60 * 1000,
  ).toISOString();

  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, user.id, nowIso(), expires);

  return { token, user, store };
}

export function logout(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getSession(
  db: Db,
  token: string,
): { user: User; store: Store } | null {
  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.*, st.id AS store_pk, st.name AS store_name,
              st.code AS store_code, st.created_at AS store_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN stores st ON st.id = u.store_id
       WHERE s.token = ? AND u.active = 1`,
    )
    .get(token) as Record<string, unknown> | undefined;

  if (!session) return null;
  if (String(session.expires_at) < nowIso()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }

  return {
    user: mapUser(session),
    store: {
      id: String(session.store_pk),
      name: String(session.store_name),
      code: String(session.store_code),
      createdAt: String(session.store_created_at),
    },
  };
}
