const sensitiveEnvironmentName = /(PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY|PRIVATE_KEY|DATABASE_URL|MONGODB_URI|REDIS_URL)/i;

export function formatDatabaseInitializationError(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const details = error instanceof Error
    ? error.stack ?? `${error.name}: ${error.message}`
    : typeof error === "string"
      ? error
      : safeStringify(error);

  const sensitiveValues = Object.entries(environment)
    .filter(([name, value]) => sensitiveEnvironmentName.test(name) && Boolean(value))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);

  return sensitiveValues.reduce(
    (output, value) => output.replaceAll(value, "[REDACTED]"),
    details,
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
