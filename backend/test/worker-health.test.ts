import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearWorkerHeartbeat,
  isWorkerHeartbeatHealthy,
  updateWorkerHeartbeat,
} from "../src/jobs/worker-health.js";

test("worker health is fresh only while a heartbeat is present and recent", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "leadflow360-worker-health-"));
  const marker = join(directory, "heartbeat");
  context.after(async () => rm(directory, { recursive: true, force: true }));

  assert.equal(await isWorkerHeartbeatHealthy(marker), false);
  await updateWorkerHeartbeat(true, marker);
  assert.equal(await isWorkerHeartbeatHealthy(marker), true);
  assert.equal(await isWorkerHeartbeatHealthy(marker, Date.now() + 60_000), false);
  await updateWorkerHeartbeat(false, marker);
  assert.equal(await isWorkerHeartbeatHealthy(marker), false);
  await clearWorkerHeartbeat(marker);
});
