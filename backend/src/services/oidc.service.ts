import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { googleOidcConfig, oidcTransactionTtlSeconds, type GoogleOidcConfig } from "../config/oidc.js";
import { redisClient } from "../config/redis.js";
import { AppError } from "../errors/app-error.js";
import type { PublicUser } from "../types/auth.js";

interface VerifiedPayload { sub?: string; iss?: string; aud?: string | string[]; exp?: number; nonce?: string; email?: string; email_verified?: boolean; name?: string }
interface OidcClient {
  generateCodeVerifierAsync(): Promise<{ codeVerifier: string; codeChallenge: string }>;
  generateAuthUrl(options: Record<string, unknown>): string;
  getToken(options: { code: string; codeVerifier: string }): Promise<{ tokens: Credentials }>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): VerifiedPayload | undefined }>;
}
export interface OidcDeps {
  config: GoogleOidcConfig;
  now: () => number;
  clientFactory: () => OidcClient;
  transactionStore: { set(key: string, value: string, ttl: number): Promise<void>; take(key: string): Promise<string | null> };
  identities: {
    findGoogleUser(subject: string): Promise<PublicUser | null>;
    linkGoogleIdentity(userId: string, subject: string): Promise<void>;
  };
}

function googleClient(config: GoogleOidcConfig): OidcClient {
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri) as unknown as OidcClient;
}

function redisTransactions() {
  return {
    async set(key: string, value: string, ttl: number) {
      if (!redisClient?.isReady) throw new AppError("OIDC transaction storage is unavailable", 503);
      const result = await redisClient.set(key, value, { EX: ttl, NX: true });
      if (result !== "OK") throw new AppError("Could not create OIDC transaction", 503);
    },
    async take(key: string) {
      if (!redisClient?.isReady) throw new AppError("OIDC transaction storage is unavailable", 503);
      return redisClient.getDel(key);
    },
  };
}

export function createOidcService(deps?: OidcDeps) {
  const config = deps?.config ?? googleOidcConfig;
  const now = deps?.now ?? Date.now;
  const clientFactory = deps?.clientFactory ?? (() => googleClient(config!));
  const transactions = deps?.transactionStore ?? redisTransactions();
  const identities = deps?.identities ?? {
    async findGoogleUser(subject: string) {
      const { identityRepository: repository } = await import("../repositories/identity.repository.js");
      return repository.findGoogleUser(subject);
    },
    async linkGoogleIdentity(userId: string, subject: string) {
      const { identityRepository: repository } = await import("../repositories/identity.repository.js");
      return repository.linkGoogleIdentity(userId, subject);
    },
  };

  function ensureConfigured(): GoogleOidcConfig {
    if (!config) throw new AppError("Google OIDC is not configured", 503);
    return config;
  }

  async function begin(purpose: "login" | "link", userId?: string): Promise<string> {
    const settings = ensureConfigured();
    const client = clientFactory();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const transaction = { purpose, userId, codeVerifier, nonce, createdAt: now() };
    const stateKey = createHash("sha256").update(state).digest("hex");
    await transactions.set(`oidc:google:state:${stateKey}`, JSON.stringify(transaction), oidcTransactionTtlSeconds);
    return client.generateAuthUrl({
      response_type: "code",
      redirect_uri: settings.redirectUri,
      scope: ["openid"],
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
  }

  return {
    isConfigured: () => Boolean(config),
    beginLogin: () => begin("login"),
    beginLink: (userId: string) => begin("link", userId),
    async callback(state: string, code: string | undefined, providerError?: string): Promise<{ purpose: "login"; user: PublicUser } | { purpose: "link"; userId: string }> {
      const settings = ensureConfigured();
      if (!state || state.length > 256) throw new AppError("Invalid OIDC state", 400);
      const stateKey = createHash("sha256").update(state).digest("hex");
      const serialized = await transactions.take(`oidc:google:state:${stateKey}`);
      if (!serialized) throw new AppError("Invalid or expired OIDC state", 400);
      const transaction = JSON.parse(serialized) as { purpose: "login" | "link"; userId?: string; codeVerifier: string; nonce: string; createdAt: number };
      if (transaction.purpose !== "login" && transaction.purpose !== "link") throw new AppError("Invalid OIDC transaction", 400);
      if (!Number.isFinite(transaction.createdAt) || now() - transaction.createdAt > oidcTransactionTtlSeconds * 1000) throw new AppError("Expired OIDC transaction", 400);
      if (providerError) throw new AppError("Google authentication was declined", 400);
      if (!code || code.length > 4096) throw new AppError("Missing authorization code", 400);

      let credentials: Credentials;
      try {
        ({ tokens: credentials } = await clientFactory().getToken({ code, codeVerifier: transaction.codeVerifier }));
      } catch {
        throw new AppError("Google authorization code exchange failed", 502);
      }
      if (!credentials.id_token) throw new AppError("Google did not return an ID token", 401);

      let payload: VerifiedPayload | undefined;
      try {
        const ticket = await clientFactory().verifyIdToken({ idToken: credentials.id_token, audience: settings.clientId });
        payload = ticket.getPayload();
      } catch {
        throw new AppError("Google ID token validation failed", 401);
      }
      // google-auth-library validates signature, issuer, audience and expiry; bind the
      // validated ID token to this one-time authorization transaction with its nonce.
      const audienceMatches = payload?.aud === settings.clientId || (Array.isArray(payload?.aud) && payload.aud.includes(settings.clientId));
      const issuerMatches = ["accounts.google.com", "https://accounts.google.com"].includes(payload?.iss ?? "");
      const tokenIsCurrent = typeof payload?.exp === "number" && payload.exp * 1000 > now();
      if (!payload?.sub || !audienceMatches || !issuerMatches || !tokenIsCurrent || payload.nonce !== transaction.nonce) {
        throw new AppError("Google ID token claims were invalid", 401);
      }

      if (transaction.purpose === "link") {
        if (!transaction.userId) throw new AppError("Invalid identity-link transaction", 400);
        await identities.linkGoogleIdentity(transaction.userId, payload.sub);
        return { purpose: "link", userId: transaction.userId };
      }

      const user = await identities.findGoogleUser(payload.sub);
      if (!user) throw new AppError("Google account is not linked to a LeadFlow360 account", 403);
      return { purpose: "login", user };
    },
  };
}

export const oidcService = createOidcService();
