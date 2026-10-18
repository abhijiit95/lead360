export interface DatabaseTlsOptions {
  rejectUnauthorized: true;
}

export function readDatabaseTlsOptions(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseTlsOptions | undefined {
  const configured = environment.DATABASE_SSL?.toLowerCase();
  if (configured !== undefined && configured !== "true" && configured !== "false") {
    throw new Error("DATABASE_SSL must be true or false");
  }

  const enabled = configured === "true";
  if (environment.NODE_ENV === "production" && !enabled) {
    throw new Error("DATABASE_SSL=true is required in production");
  }

  return enabled ? { rejectUnauthorized: true } : undefined;
}
