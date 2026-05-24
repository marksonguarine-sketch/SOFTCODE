import { QueryClient, QueryFunction } from "@tanstack/react-query";

function getToken(): string | null {
  return localStorage.getItem("token");
}

function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * Extracts a clean error message from a non-OK Response.
 * Tries JSON first (so server messages like {success:false, message:"..."} work),
 * falls back to plain text. Uses res.clone() so the original response remains
 * readable by the caller.
 */
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const cloned = res.clone();
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await cloned.json();
        if (json?.message) message = json.message;
        else if (json?.error) message = json.error;
      } else {
        const text = await cloned.text();
        if (text) message = text;
      }
    } catch {
      // ignore parse errors, use default message
    }
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // GLOBAL REAL-TIME POLLING: every query refetches every 1 second
      // This combined with Socket.io ensures all data stays fresh without manual refresh
      refetchInterval: 1000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      staleTime: 500,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Starts a global background polling loop that selectively invalidates the
 * most important query keys every second. Used in addition to per-query
 * refetchInterval to ensure cross-page invalidation when needed.
 */
export function startGlobalRealtimeSync() {
  if (typeof window === "undefined") return;
  const KEY = "__joap_realtime_sync__";
  if ((window as any)[KEY]) return;
  (window as any)[KEY] = setInterval(() => {
    // Invalidate critical query keys for instant cross-view updates
    queryClient.invalidateQueries({ queryKey: ["/api/orders"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["/api/orders?assignedToMe=true"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders?pool=true"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/my-active"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/items/all"] });
  }, 1000);
}
