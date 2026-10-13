import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createOAuthService, createPkcePair } from "../src/services/oauth.service.js";

const config = {
  clientId: "test-google-client", clientSecret: "test-secret",
  redirectUri: "http://localhost:4000/api/oauth/google/callback",
  scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
  resourceUrl: new URL("https://www.googleapis.com/drive/v3/files"),
};
function setup(options: { now?: () => number; resourceFetcher?: typeof fetch; failExchange?: boolean; failRefresh?: boolean; omitRefresh?: boolean } = {}) {
  const transactions = new Map<string, string>();
  const tokens = new Map<string, string>();
  const ttl: number[] = [];
  const clientCalls: Array<{ method: string; value?: unknown }> = [];
  const clientFactory = () => ({
    async generateCodeVerifierAsync() { return { codeVerifier: "A".repeat(43), codeChallenge: "challenge-s256" }; },
    generateAuthUrl(args: Record<string, unknown>) {
      const url = new URL("https://accounts.google.com/o/oauth2/auth");
      for (const [key, value] of Object.entries(args)) url.searchParams.set(key, Array.isArray(value) ? value.join(" ") : String(value));
      clientCalls.push({ method: "authorize", value: args });
      return url.toString();
    },
    async getToken(args: { code: string; codeVerifier: string }) {
      clientCalls.push({ method: "exchange", value: args });
      if (options.failExchange) throw new Error("mock exchange failure");
      return { tokens: { access_token: "access-token", refresh_token: options.omitRefresh ? undefined : "refresh-token", expiry_date: (options.now?.() ?? Date.now()) + 3_600_000 } };
    },
    setCredentials(value: unknown) { clientCalls.push({ method: "setCredentials", value }); },
    async refreshAccessToken() {
      clientCalls.push({ method: "refresh" });
      if (options.failRefresh) throw new Error("mock refresh failure");
      return { credentials: { access_token: "renewed-token", refresh_token: "rotated-refresh", expiry_date: (options.now?.() ?? Date.now()) + 3_600_000 } };
    },
    async revokeToken(value: string) { clientCalls.push({ method: "revoke", value }); },
  });
  const service = createOAuthService({
    config, encryptionKey: Buffer.alloc(32, 7), clientFactory, now: options.now ?? Date.now,
    fetcher: options.resourceFetcher ?? (async () => Response.json({ files: [] })),
    transactionStore: { async set(key, value, seconds) { transactions.set(key, value); ttl.push(seconds); }, async take(key) { const value = transactions.get(key) ?? null; transactions.delete(key); return value; } },
    tokenStore: { async save(id, ciphertext) { tokens.set(id, ciphertext); }, async load(id) { return tokens.get(id) ?? null; }, async delete(id) { tokens.delete(id); } },
  });
  return { service, transactions, tokens, ttl, clientCalls };
}

test("generates an RFC 7636 S256 PKCE verifier and challenge", async () => {
  const pair = await createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(pair.challenge, createHash("sha256").update(pair.verifier).digest("base64url"));
});

test("builds Google's authorization URL with exact callback, state, offline access, scopes, and S256", async () => {
  const { service, ttl } = setup();
  const url = new URL(await service.begin("user-1"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/auth");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("scope"), config.scopes.join(" "));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-s256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.ok(url.searchParams.get("state"));
  assert.deepEqual(ttl, [600]);
});

test("valid callback exchanges code with stored verifier and stores encrypted provider tokens", async () => {
  const { service, tokens, clientCalls } = setup();
  const auth = new URL(await service.begin("user-1"));
  await service.callback(auth.searchParams.get("state")!, "mock-auth-code");
  assert.deepEqual(clientCalls.find((call) => call.method === "exchange")?.value, { code: "mock-auth-code", codeVerifier: "A".repeat(43) });
  assert.ok(tokens.get("user-1"));
  assert.equal(tokens.get("user-1")!.includes("access-token"), false);
});

test("rejects invalid/replayed state, missing code, expired transaction, provider denial, and failed exchange", async () => {
  const invalid = setup();
  await assert.rejects(invalid.service.callback("unknown-state", "code"), /state/i);
  const missing = setup();
  const murl = new URL(await missing.service.begin("u"));
  await assert.rejects(missing.service.callback(murl.searchParams.get("state")!, undefined), /code/i);
  let now = 1_000_000;
  const expired = setup({ now: () => now });
  const eurl = new URL(await expired.service.begin("u")); now += 601_000;
  await assert.rejects(expired.service.callback(eurl.searchParams.get("state")!, "code"), /expired/i);
  const denied = setup(); const durl = new URL(await denied.service.begin("u"));
  await assert.rejects(denied.service.callback(durl.searchParams.get("state")!, undefined, "access_denied"), /declined/i);
  const failed = setup({ failExchange: true }); const furl = new URL(await failed.service.begin("u"));
  await assert.rejects(failed.service.callback(furl.searchParams.get("state")!, "code"), /exchange failed/i);
});

test("requires authorization for protected resource and refreshes expired access tokens", async () => {
  let time = 2_000_000;
  const { service, clientCalls } = setup({ now: () => time });
  await assert.rejects(service.resource("unconnected"), /not connected/i);
  const url = new URL(await service.begin("u")); await service.callback(url.searchParams.get("state")!, "code");
  time += 3_700_000;
  assert.deepEqual(await service.resource("u"), { files: [] });
  assert.equal(clientCalls.filter((call) => call.method === "refresh").length, 1);
});

test("rejects expired credentials without refresh token and handles resource errors", async () => {
  let time = 9_000_000;
  const noRefresh = setup({ now: () => time, omitRefresh: true }); const url = new URL(await noRefresh.service.begin("u"));
  await noRefresh.service.callback(url.searchParams.get("state")!, "code");
  time += 3_700_000;
  await assert.rejects(noRefresh.service.resource("u"), /expired/i);
  const unauthorized = setup({ resourceFetcher: async () => new Response("", { status: 401 }) });
  const aurl = new URL(await unauthorized.service.begin("u")); await unauthorized.service.callback(aurl.searchParams.get("state")!, "code");
  await assert.rejects(unauthorized.service.resource("u"), /rejected/i);
});
