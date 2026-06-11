import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { IUser } from "@shared/schema";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

interface AuthContextType {
  user: IUser | null;
  token: string | null;
  isAdmin: boolean;
  isInventoryManager: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [isLoading, setIsLoading] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdmin = user?.role === "ADMIN";
  const isInventoryManager = user?.role === "INVENTORY_MANAGER";

  useEffect(() => {
    if (token) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              setUser(data.data.user || data.data);
            } else {
              localStorage.removeItem("token");
              setToken(null);
            }
          } else {
            if (res.status === 401) {
              localStorage.setItem("session_expired", "1");
            }
            localStorage.removeItem("token");
            setToken(null);
          }
        })
        .catch(() => {
          localStorage.removeItem("token");
          setToken(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [token]);

  const logout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
    }
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      localStorage.setItem("session_expired", "idle");
      logout();
    }, IDLE_TIMEOUT_MS);
  }, [logout]);

  useEffect(() => {
    if (!user) {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      return;
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    const handler = () => resetIdleTimer();

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetIdleTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [user, resetIdleTimer]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const data = await res.json();
    if (data.success) {
      const { token: newToken, user: newUser } = data.data;
      localStorage.setItem("token", newToken);
      setToken(newToken);
      setUser(newUser);
    } else {
      throw new Error(data.error || "Login failed");
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, isInventoryManager, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
