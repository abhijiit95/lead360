function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  resourceUrl?: URL;
}

const clientId = optional("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = optional("GOOGLE_OAUTH_CLIENT_SECRET");
const redirectUri = optional("GOOGLE_OAUTH_REDIRECT_URI");
if ([clientId, clientSecret, redirectUri].some(Boolean) && ![clientId, clientSecret, redirectUri].every(Boolean)) {
  throw new Error("Google OAuth requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI");
}

function validateUrl(value: string, key: string, allowLocalHttp = false): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(allowLocalHttp && process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error(`${key} must use HTTPS outside local development`);
  }
  return url;
}

export const googleOAuthConfig: GoogleOAuthConfig | null = clientId && clientSecret && redirectUri ? {
  clientId,
  clientSecret,
  redirectUri: validateUrl(redirectUri, "GOOGLE_OAUTH_REDIRECT_URI", true).toString(),
  scopes: (optional("GOOGLE_OAUTH_SCOPES") ?? "").split(/[\s,]+/).filter(Boolean),
  resourceUrl: optional("GOOGLE_OAUTH_RESOURCE_URL") ? validateUrl(optional("GOOGLE_OAUTH_RESOURCE_URL")!, "GOOGLE_OAUTH_RESOURCE_URL") : undefined,
} : null;

const encryptionKey = optional("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY");
export const googleOAuthTokenEncryptionKey = encryptionKey ? Buffer.from(encryptionKey, "base64") : null;
if (googleOAuthTokenEncryptionKey && googleOAuthTokenEncryptionKey.length !== 32) {
  throw new Error("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
}

export const googleOAuthTransactionTtlSeconds = Number(process.env.GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS ?? 600);
if (!Number.isSafeInteger(googleOAuthTransactionTtlSeconds) || googleOAuthTransactionTtlSeconds < 60 || googleOAuthTransactionTtlSeconds > 900) {
  throw new Error("GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS must be between 60 and 900");
}
