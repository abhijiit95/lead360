import assert from "node:assert/strict";
import test from "node:test";
import { createOidcService, type OidcDeps } from "../src/services/oidc.service.js";
import type { PublicUser } from "../src/types/auth.js";

const config = {
  clientId: "mock-google-client",
  clientSecret: "mock-only-secret",
  redirectUri: "http://localhost:4000/api/oidc/google/callback",
  frontendOrigin: "http://localhost:5173",
};
const user: PublicUser = {
  id: "local-user-1", name: "Alex Example", email: "alex@example.test", role: "agent",
  created_at: new Date(0), updated_at: new Date(0),
};

function setup(options: { invalidToken?: boolean; nonce?: string; linked?: boolean; failExchange?: boolean; badIssuer?: boolean; badAudience?: boolean; expired?: boolean } = {}) {
  const transactions = new Map<string, string>();
  const linkedSubjects = new Map<string, PublicUser>();
  if (options.linked !== false) linkedSubjects.set("google-subject-1", user);
  const linkedRecords: Array<{ userId: string; subject: string; email?: string }> = [];
  const calls: Array<{ method: string; value?: unknown }> = [];
  const payload = {
    sub: "google-subject-1", iss: options.badIssuer ? "https://attacker.example" : "https://accounts.google.com",
    aud: options.badAudience ? "another-client" : config.clientId,
    exp: Math.floor(Date.now() / 1000) + (options.expired ? -60 : 3600), nonce: options.nonce,
    email: "alex@example.test", email_verified: true,
  };
  const clientFactory: OidcDeps["clientFactory"] = () => ({
    async generateCodeVerifierAsync() { return { codeVerifier: "verifier-for-pkce-123456789012345678901234567890123", codeChallenge: "S256-challenge" }; },
    generateAuthUrl(args) {
      calls.push({ method: "authorize", value: args });
      payload.nonce = options.nonce ?? String(args.nonce);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [key, value] of Object.entries(args)) url.searchParams.set(key, Array.isArray(value) ? value.join(" ") : String(value));
      return url.toString();
    },
    async getToken(args) {
      calls.push({ method: "exchange", value: args });
      if (options.failExchange) throw new Error("mock exchange error");
      return { tokens: { id_token: "mock.signed.id-token", access_token: "mock-google-access-token" } };
    },
    async verifyIdToken(args) {
      calls.push({ method: "verify", value: args });
      if (options.invalidToken) throw new Error("mock signature or audience error");
      return { getPayload: () => payload };
    },
  });
  const deps: OidcDeps = {
    config, now: Date.now, clientFactory,
    transactionStore: {
      async set(key, value) { transactions.set(key, value); },
      async take(key) { const value = transactions.get(key) ?? null; transactions.delete(key); return value; },
    },
    identities: {
      async findGoogleUser(subject) { return linkedSubjects.get(subject) ?? null; },
      async linkGoogleIdentity(userId, subject) { linkedRecords.push({ userId, subject }); },
    },
  };
  return { service: createOidcService(deps), transactions, calls, linkedRecords };
}

test("builds OIDC authorization URL with openid scopes, S256, state and nonce", async () => {
  const { service, calls } = setup();
  const url = new URL(await service.beginLogin());
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("scope"), "openid");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "S256-challenge");
  assert.ok(url.searchParams.get("state"));
  assert.ok(url.searchParams.get("nonce"));
  assert.equal(calls[0].method, "authorize");
});

test("validates the ID token and nonce, then returns only an existing linked local account", async () => {
  const { service, calls } = setup();
  const authUrl = new URL(await service.beginLogin());
  const result = await service.callback(authUrl.searchParams.get("state")!, "mock-code");
  assert.deepEqual(result, { purpose: "login", user });
  assert.deepEqual(calls.find((call) => call.method === "exchange")?.value, {
    code: "mock-code", codeVerifier: "verifier-for-pkce-123456789012345678901234567890123",
  });
  assert.deepEqual(calls.find((call) => call.method === "verify")?.value, {
    idToken: "mock.signed.id-token", audience: config.clientId,
  });
});

test("rejects invalid or replayed state, invalid ID tokens, nonce mismatch and unknown identities", async () => {
  const invalidState = setup();
  await assert.rejects(invalidState.service.callback("not-valid", "code"), /state/i);

  const invalidToken = setup({ invalidToken: true });
  const tokenUrl = new URL(await invalidToken.service.beginLogin());
  await assert.rejects(invalidToken.service.callback(tokenUrl.searchParams.get("state")!, "code"), /ID token validation failed/i);

  const wrongNonce = setup({ nonce: "incorrect-nonce" });
  const nonceUrl = new URL(await wrongNonce.service.beginLogin());
  await assert.rejects(wrongNonce.service.callback(nonceUrl.searchParams.get("state")!, "code"), /claims were invalid/i);

  for (const invalidClaim of [{ badIssuer: true }, { badAudience: true }, { expired: true }]) {
    const invalidClaims = setup(invalidClaim);
    const claimsUrl = new URL(await invalidClaims.service.beginLogin());
    await assert.rejects(invalidClaims.service.callback(claimsUrl.searchParams.get("state")!, "code"), /claims were invalid/i);
  }

  const unknown = setup({ linked: false });
  const unknownUrl = new URL(await unknown.service.beginLogin());
  const state = unknownUrl.searchParams.get("state")!;
  await assert.rejects(unknown.service.callback(state, "code"), /not linked/i);
  await assert.rejects(unknown.service.callback(state, "code"), /state/i);
});

test("rejects missing codes and failed token exchange", async () => {
  const missing = setup();
  const missingUrl = new URL(await missing.service.beginLogin());
  await assert.rejects(missing.service.callback(missingUrl.searchParams.get("state")!, undefined), /authorization code/i);

  const failed = setup({ failExchange: true });
  const failedUrl = new URL(await failed.service.beginLogin());
  await assert.rejects(failed.service.callback(failedUrl.searchParams.get("state")!, "code"), /exchange failed/i);
});

test("links a verified Google subject only to the explicitly authenticated local user", async () => {
  const { service, linkedRecords } = setup();
  const authUrl = new URL(await service.beginLink("local-user-1"));
  const result = await service.callback(authUrl.searchParams.get("state")!, "link-code");
  assert.deepEqual(result, { purpose: "link", userId: "local-user-1" });
  assert.deepEqual(linkedRecords, [{ userId: "local-user-1", subject: "google-subject-1" }]);
});
