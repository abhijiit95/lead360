export type LeadDatabaseType = "postgres" | "mysql" | "mongodb";
export type DependencyCheck = () => Promise<unknown>;

export interface ReadinessDependencies {
  postgres: DependencyCheck;
  redis: DependencyCheck;
  mysql?: DependencyCheck;
  mongodb?: DependencyCheck;
}

export function createReadinessCheck(
  leadDatabaseType: LeadDatabaseType,
  dependencies: ReadinessDependencies,
): () => Promise<boolean> {
  return async () => {
    const required: Array<DependencyCheck | undefined> = [dependencies.postgres, dependencies.redis];
    if (leadDatabaseType === "mysql") required.push(dependencies.mysql);
    if (leadDatabaseType === "mongodb") required.push(dependencies.mongodb);
    if (required.some((check) => !check)) return false;

    const results = await Promise.allSettled(required.map((check) => check!()));
    return results.every((result) => result.status === "fulfilled");
  };
}
