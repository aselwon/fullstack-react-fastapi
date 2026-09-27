export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export type Role = "admin" | "agent" | "customer";
export type User = { id: number; name: string; email: string; role: Role };
export type Ticket = {
  id: number;
  title: string;
  description: string;
  status: string;
  customer_id: number;
  created_at: string;
  updated_at: string;
};
export type Attachment = { id: number; filename: string; size: number };
export type Subscription = { id: number; url: string; active: boolean };
export type Delivery = {
  id: number;
  subscription_id: number;
  status: string;
  attempts: number;
  response_code: number | null;
  error: string | null;
  created_at: string;
};
export async function api<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `Please check your input (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
