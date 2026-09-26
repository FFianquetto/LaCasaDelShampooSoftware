import type { Request, Response, NextFunction } from "express";
import type { Store, User, UserRole } from "@lcds/shared";
import { getDb } from "./db.js";
import { getSession } from "./services/auth.js";
import { AppError } from "./errors.js";

export type AuthedRequest = Request & {
  user?: User;
  store?: Store;
  token?: string;
};

export function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (req.headers["x-session-token"] as string | undefined);

  if (!token) {
    next(new AppError("No autenticado", 401, "UNAUTHORIZED"));
    return;
  }

  const session = getSession(getDb(), token);
  if (!session) {
    next(new AppError("Sesión inválida o expirada", 401, "UNAUTHORIZED"));
    return;
  }

  req.user = session.user;
  req.store = session.store;
  req.token = token;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new AppError("Sin permiso", 403, "FORBIDDEN"));
      return;
    }
    next();
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err && typeof err === "object" && "issues" in err) {
    res.status(400).json({ error: "Datos inválidos", details: err });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: err instanceof Error ? err.message : "Error interno",
  });
}
