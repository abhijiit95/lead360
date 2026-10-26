export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "agent";
}

export function resolveApiBaseUrl(configuredBaseUrl: string | undefined, isDevelopment: boolean): string {
  return (configuredBaseUrl ?? (isDevelopment ? "http://localhost:4000" : "")).replace(/\/$/, "");
}

const apiBaseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);

export function startGoogleLogin(): void {
  window.location.assign(`${apiBaseUrl}/api/oidc/google/login`);
}

export async function getSession(): Promise<SessionUser> {
  const response = await fetch(`${apiBaseUrl}/api/oidc/session`, { credentials: "include" });
  if (!response.ok) throw new Error("No active LeadFlow360 session");
  const result = await response.json() as { user: SessionUser };
  return result.user;
}

export async function signOut(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/oidc/logout`, { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error("Could not sign out. Please retry.");
}

// The short-lived LeadFlow360 token stays in memory only and is sent just to our API.
export async function signInAndStartGoogleLink(email: string, password: string): Promise<void> {
  const loginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginResponse.ok) throw new Error("LeadFlow360 sign-in failed. Check your email and password.");
  const { accessToken } = await loginResponse.json() as { accessToken: string };
  const linkResponse = await fetch(`${apiBaseUrl}/api/oidc/google/link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!linkResponse.ok) throw new Error("Could not start Google account linking.");
  const { authorizationUrl } = await linkResponse.json() as { authorizationUrl: string };
  window.location.assign(authorizationUrl);
}
