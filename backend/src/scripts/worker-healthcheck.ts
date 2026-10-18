import { isWorkerHeartbeatHealthy } from "../jobs/worker-health.js";

void isWorkerHeartbeatHealthy().then((healthy) => {
  if (!healthy) process.exitCode = 1;
}).catch(() => {
  process.exitCode = 1;
});
