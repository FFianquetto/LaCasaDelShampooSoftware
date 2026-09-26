import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User, Store } from "@lcds/shared";
import { api, loadStoredSession, setSession } from "../api";

type AuthState = {
  session: Session | null;
  user: User | null;
  store: Store | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() =>
    loadStoredSession(),
  );

  const login = useCallback(async (username: string, password: string) => {
    const result = await api<Session>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setSession(result);
    setSessionState(result);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setSession(null);
    setSessionState(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      store: session?.store ?? null,
      login,
      logout,
      isAdmin: session?.user.role === "Admin",
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
