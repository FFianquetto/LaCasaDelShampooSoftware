import type { Session } from "@lcds/shared";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

function getToken(): string | null {
  return localStorage.getItem("lcds_token");
}

export function setSession(session: Session | null): void {
  if (!session) {
    localStorage.removeItem("lcds_token");
    localStorage.removeItem("lcds_session");
    return;
  }
  localStorage.setItem("lcds_token", session.token);
  localStorage.setItem("lcds_session", JSON.stringify(session));
}

export function loadStoredSession(): Session | null {
  const raw = localStorage.getItem("lcds_session");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error || res.statusText,
      res.status,
      (data as { code?: string }).code,
    );
  }
  return data as T;
}
