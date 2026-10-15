function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  frontendOrigin: string;
}

const clientId = optional("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = optional("GOOGLE_OAUTH_CLIENT_SECRET");
const redirectUri = optional("GOOGLE_OIDC_REDIRECT_URI");
function validateUrl(value: string, name: string, allowLocalHttp = false): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(allowLocalHttp && process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  return url;
}

const frontendOrigin = optional("FRONTEND_ORIGIN") ?? "http://localhost:5173";
const parsedFrontendOrigin = validateUrl(frontendOrigin, "FRONTEND_ORIGIN", true);
if (parsedFrontendOrigin.origin !== frontendOrigin.replace(/\/$/, "")) {
  throw new Error("FRONTEND_ORIGIN must be an origin without a path");
}

export const googleOidcConfig: GoogleOidcConfig | null = clientId && clientSecret && redirectUri ? {
  clientId,
  clientSecret,
  redirectUri: validateUrl(redirectUri, "GOOGLE_OIDC_REDIRECT_URI", true).toString(),
  frontendOrigin: parsedFrontendOrigin.origin,
} : null;

export const oidcTransactionTtlSeconds = 600;
export const oidcSessionCookieName = "lf_session";
