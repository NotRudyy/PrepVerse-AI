const configuredApiUrl = process.env.NEXT_PUBLIC_PREPVERSE_API_URL?.trim().replace(/\/$/, "");

export const apiUrl = configuredApiUrl || (process.env.NODE_ENV === "production" ? "/api/v1" : "http://localhost:8001/api/v1");
export const apiConfigured = Boolean(apiUrl);

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiConfigured) throw new ApiError("PrepVerse's secure service is not configured yet.");
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError("We couldn't reach PrepVerse's service. Please try again in a moment.");
  }

  const body = await response.json().catch(() => ({})) as { detail?: string | Array<{ msg?: string }>; message?: string };
  const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).filter(Boolean).join(" ") : body.detail;
  if (!response.ok) throw new ApiError(detail || body.message || "That request couldn't be completed.", response.status);
  return body as T;
}

export type DashboardData = {
  profile: { display_name: string; xp_balance: number };
  stats: { streak_days: number; mastery_percent: number; xp_today: number; focus_minutes_today: number };
  pinned_subjects: Array<{
    id: string;
    name: string;
    completed_topics: number;
    total_topics: number;
    mastery_percent: number;
    popular_topics: Array<{ id: string; title: string; importance: "high" | "medium" | "foundational" }>;
  }>;
  recent_activity: Array<{ id: string; title: string; subject: string; occurred_at: string; href: string }>;
  upcoming: Array<{ id: string; title: string; starts_at: string; subject: string }>;
  quests: Array<{ id: string; title: string; progress: number; target: number; xp_reward: number }>;
  study_rhythm_minutes: number[];
};
