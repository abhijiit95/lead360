import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { googleOAuthConfig, googleOAuthTokenEncryptionKey, googleOAuthTransactionTtlSeconds, type GoogleOAuthConfig } from "../config/oauth.js";
import { redisClient } from "../config/redis.js";
import { AppError } from "../errors/app-error.js";

interface GoogleTokens { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; token_type?: string }
interface StoredTokens { accessToken: string; refreshToken?: string; expiresAt: number }
interface GoogleOAuthClient {
  generateCodeVerifierAsync(): Promise<{ codeVerifier: string; codeChallenge: string }>;
  generateAuthUrl(options: Record<string, unknown>): string;
  getToken(options: { code: string; codeVerifier: string }): Promise<{ tokens: GoogleTokens }>;
  setCredentials(credentials: GoogleTokens): void;
  refreshAccessToken(): Promise<{ credentials: GoogleTokens }>;
  revokeToken(token: string): Promise<unknown>;
}
interface OAuthDeps {
  config: GoogleOAuthConfig;
  encryptionKey: Buffer;
  now: () => number;
  fetcher: typeof fetch;
  clientFactory: () => GoogleOAuthClient;
  transactionStore: { set(key: string, value: string, ttl: number): Promise<void>; take(key: string): Promise<string | null> };
  tokenStore: { save(userId: string, ciphertext: string): Promise<void>; load(userId: string): Promise<string | null>; delete(userId: string): Promise<void> };
}

function googleClient(config: GoogleOAuthConfig): GoogleOAuthClient {
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri) as unknown as GoogleOAuthClient;
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const { codeVerifier, codeChallenge } = await new OAuth2Client().generateCodeVerifierAsync();
  if (!codeChallenge) throw new Error("Google auth library did not return an S256 PKCE challenge");
  return { verifier: codeVerifier, challenge: codeChallenge };
}

function encrypt(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}
function decrypt(value: string, key: Buffer): string {
  const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function redisTransactions() {
  return {
    async set(key: string, value: string, ttl: number) {
      if (!redisClient?.isReady) throw new AppError("OAuth transaction storage is unavailable", 503);
      const result = await redisClient.set(key, value, { EX: ttl, NX: true });
      if (result !== "OK") throw new AppError("Could not create authorization transaction", 503);
    },
    async take(key: string) {
      if (!redisClient?.isReady) throw new AppError("OAuth transaction storage is unavailable", 503);
      return redisClient.getDel(key);
    },
  };
}

export function createOAuthService(deps?: OAuthDeps) {
  const config = deps?.config ?? googleOAuthConfig;
  const keyProvider = deps?.encryptionKey ?? googleOAuthTokenEncryptionKey;
  const now = deps?.now ?? Date.now;
  const fetcher = deps?.fetcher ?? fetch;
  const clientFactory = deps?.clientFactory ?? (() => googleClient(config!));
  const transactions = deps?.transactionStore ?? redisTransactions();
  const tokenStore = deps?.tokenStore ?? {
    async save(userId: string, ciphertext: string) {
      const { pool } = await import("../config/database.js");
      await pool.query(`INSERT INTO oauth_provider_tokens (user_id, provider, token_ciphertext, updated_at)
        VALUES ($1, 'google', $2, NOW()) ON CONFLICT (user_id, provider)
        DO UPDATE SET token_ciphertext = EXCLUDED.token_ciphertext, updated_at = NOW()`, [userId, ciphertext]);
    },
    async load(userId: string) {
      const { pool } = await import("../config/database.js");
      const result = await pool.query<{ token_ciphertext: string }>("SELECT token_ciphertext FROM oauth_provider_tokens WHERE user_id = $1 AND provider = 'google'", [userId]);
      return result.rows[0]?.token_ciphertext ?? null;
    },
    async delete(userId: string) {
      const { pool } = await import("../config/database.js");
      await pool.query("DELETE FROM oauth_provider_tokens WHERE user_id = $1 AND provider = 'google'", [userId]);
    },
  };
  function ensureConfigured(): { config: GoogleOAuthConfig; key: Buffer } {
    if (!config || !keyProvider) throw new AppError("Google OAuth is not configured", 503);
    return { config, key: keyProvider };
  }
  async function save(userId: string, tokens: GoogleTokens): Promise<void> {
    const { key } = ensureConfigured();
    if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new AppError("Google returned an invalid token response", 502);
    const expiresAt = typeof tokens.expiry_date === "number" && Number.isFinite(tokens.expiry_date) ? tokens.expiry_date : now() + 3_600_000;
    const value = encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? undefined, expiresAt } satisfies StoredTokens), key);
    await tokenStore.save(userId, value);
  }
  async function load(userId: string): Promise<StoredTokens | null> {
    const { key } = ensureConfigured();
    const ciphertext = await tokenStore.load(userId);
    if (!ciphertext) return null;
    try { return JSON.parse(decrypt(ciphertext, key)) as StoredTokens; }
    catch { throw new AppError("Stored Google token could not be decrypted", 500); }
  }
  async function refreshed(userId: string, stored: StoredTokens): Promise<StoredTokens> {
    if (stored.expiresAt > now() + 30_000) return stored;
    if (!stored.refreshToken) throw new AppError("Google authorization expired; reconnect the Google account", 401);
    const client = clientFactory();
    client.setCredentials({ refresh_token: stored.refreshToken });
    let tokens: GoogleTokens;
    try { ({ credentials: tokens } = await client.refreshAccessToken()); }
    catch { throw new AppError("Google token refresh failed; reconnect the Google account", 401); }
    if (!tokens.refresh_token) tokens.refresh_token = stored.refreshToken;
    await save(userId, tokens);
    if (!tokens.access_token) throw new AppError("Google returned an invalid refreshed token", 502);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? stored.refreshToken, expiresAt: tokens.expiry_date ?? now() + 3_600_000 };
  }
  return {
    isConfigured: () => Boolean(config && keyProvider),
    async begin(userId: string): Promise<string> {
      const { config } = ensureConfigured();
      if (config.scopes.length === 0) throw new AppError("Set GOOGLE_OAUTH_SCOPES to the least-privilege scope required by the Google API", 503);
      const client = clientFactory();
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      const state = randomBytes(32).toString("base64url");
      const transaction = { userId, codeVerifier, createdAt: now() };
      await transactions.set(`oauth:google:state:${createHash("sha256").update(state).digest("hex")}`, JSON.stringify(transaction), googleOAuthTransactionTtlSeconds);
      return client.generateAuthUrl({
        access_type: "offline", include_granted_scopes: true, redirect_uri: config.redirectUri,
        response_type: "code", scope: config.scopes, state, code_challenge: codeChallenge, code_challenge_method: "S256",
      });
    },
    async callback(state: string, code: string | undefined, providerError?: string): Promise<string> {
      ensureConfigured();
      if (!state || state.length > 256) throw new AppError("Invalid OAuth state", 400);
      const serialized = await transactions.take(`oauth:google:state:${createHash("sha256").update(state).digest("hex")}`);
      if (!serialized) throw new AppError("Invalid or expired OAuth state", 400);
      const transaction = JSON.parse(serialized) as { userId: string; codeVerifier: string; createdAt: number };
      if (!Number.isFinite(transaction.createdAt) || now() - transaction.createdAt > googleOAuthTransactionTtlSeconds * 1000) throw new AppError("Expired OAuth transaction", 400);
      if (providerError) throw new AppError("Authorization was declined by Google", 400);
      if (!code || code.length > 4096) throw new AppError("Missing authorization code", 400);
      let tokens: GoogleTokens;
      try { ({ tokens } = await clientFactory().getToken({ code, codeVerifier: transaction.codeVerifier })); }
      catch { throw new AppError("Google authorization code exchange failed", 502); }
      await save(transaction.userId, tokens);
      return transaction.userId;
    },
    async resource(userId: string): Promise<unknown> {
      const { config } = ensureConfigured();
      if (!config.resourceUrl) throw new AppError("Set GOOGLE_OAUTH_RESOURCE_URL to enable the protected resource demo", 503);
      const stored = await load(userId);
      if (!stored) throw new AppError("Google API is not connected", 401);
      const current = await refreshed(userId, stored);
      const response = await fetcher(config.resourceUrl, { headers: { authorization: `Bearer ${current.accessToken}`, accept: "application/json" } });
      if (response.status === 401) throw new AppError("Google rejected the access token; reconnect the account", 401);
      if (!response.ok) throw new AppError("Google protected resource request failed", 502);
      return response.json();
    },
    async revoke(userId: string): Promise<void> {
      ensureConfigured();
      const stored = await load(userId);
      if (!stored) return;
      try { await clientFactory().revokeToken(stored.refreshToken ?? stored.accessToken); }
      catch { throw new AppError("Google token revocation failed", 502); }
      await tokenStore.delete(userId);
    },
  };
}

export const oauthService = createOAuthService();
