function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const jwtSecret = requiredEnvironmentVariable("JWT_SECRET");
if (Buffer.byteLength(jwtSecret, "utf8") < 32) {
  throw new Error("JWT_SECRET must be at least 32 bytes long");
}

export const jwtExpiresIn = requiredEnvironmentVariable("JWT_EXPIRES_IN");
if (!/^\d+(s|m|h|d|w|y)$/.test(jwtExpiresIn)) {
  throw new Error("JWT_EXPIRES_IN must be a duration such as 15m, 1h, or 7d");
}
