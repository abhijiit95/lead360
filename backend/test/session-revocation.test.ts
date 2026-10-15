import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createSessionRevocationService } from "../src/services/session-revocation.service.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

process.env.JWT_SECRET = "oidc-session-test-secret-with-more-than-32-characters";
process.env.JWT_EXPIRES_IN = "1h";

test("OIDC session signs the existing LeadFlow360 JWT format", async () => {
  const { createAccessToken, verifyAccessToken } = await import("../src/utils/access-token.js");
  const user: AuthenticatedUser = { id: "local-user", name: "Example", email: "example@test", role: "agent" };
  const token = createAccessToken(user, "oidc-session-id");
  assert.deepEqual(verifyAccessToken(token), user);
  const payload = jwt.decode(token);
  assert.equal(typeof payload, "object");
  assert.equal((payload as jwt.JwtPayload).jti, "oidc-session-id");
});

test("revokes an OIDC cookie token until its JWT expiry without storing the raw token", async () => {
  let now = Date.now();
  const records = new Map<string, string>();
  let savedTtl = 0;
  const service = createSessionRevocationService({
    now: () => now,
    store: {
      async get(key) { return records.get(key) ?? null; },
      async set(key, value, ttl) { records.set(key, value); savedTtl = ttl; },
    },
  });
  const token = jwt.sign({ name: "Example", email: "example@test", role: "agent" }, "test-secret", {
    subject: "user-1", expiresIn: 120, jwtid: "session-1",
  });

  assert.equal(await service.isRevoked(token), false);
  await service.revoke(token);
  assert.equal(await service.isRevoked(token), true);
  assert.equal(savedTtl, 120);
  assert.equal([...records.keys()][0].includes(token), false);

  now += 121_000;
  await service.revoke(token);
  assert.equal(savedTtl, 120, "expired tokens do not create a new revocation record");
});
