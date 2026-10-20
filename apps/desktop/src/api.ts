import type { Session } from "@lcds/shared";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.TAURI_ENV_PLATFORM ? "http://127.0.0.1:5100/api" : "/api");

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
  try {
    return sessionStorage.getItem("lcds_token");
  } catch {
    return null;
  }
}

export function setSession(session: Session | null): void {
  // sessionStorage: recargar la ventana conserva la sesión;
  // cerrar la app la borra y al abrir pide login otra vez.
  try {
    localStorage.removeItem("lcds_token");
    localStorage.removeItem("lcds_session");
    if (!session) {
      sessionStorage.removeItem("lcds_token");
      sessionStorage.removeItem("lcds_session");
      return;
    }
    sessionStorage.setItem("lcds_token", session.token);
    sessionStorage.setItem("lcds_session", JSON.stringify(session));
  } catch {
    // sin almacenamiento disponible
  }
}

export function loadStoredSession(): Session | null {
  try {
    localStorage.removeItem("lcds_token");
    localStorage.removeItem("lcds_session");
    const raw = sessionStorage.getItem("lcds_session");
    if (!raw) return null;
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
