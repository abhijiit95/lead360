import { rm, stat, writeFile } from "node:fs/promises";

export const workerHeartbeatPath = "/tmp/leadflow360-worker-heartbeat";
export const workerHeartbeatMaxAgeMs = 30_000;

export async function updateWorkerHeartbeat(ready: boolean, path = workerHeartbeatPath): Promise<void> {
  if (ready) {
    await writeFile(path, String(Date.now()), { mode: 0o600 });
  } else {
    await rm(path, { force: true });
  }
}

export async function isWorkerHeartbeatHealthy(
  path = workerHeartbeatPath,
  now = Date.now(),
  maxAgeMs = workerHeartbeatMaxAgeMs,
): Promise<boolean> {
  try {
    const heartbeat = await stat(path);
    const age = now - heartbeat.mtimeMs;
    return age >= -2_000 && age <= maxAgeMs;
  } catch {
    return false;
  }
}

export async function clearWorkerHeartbeat(path = workerHeartbeatPath): Promise<void> {
  await rm(path, { force: true });
}
