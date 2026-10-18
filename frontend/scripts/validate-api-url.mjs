import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  return isIP(host) === 4 && Number(host.split(".")[0]) === 127;
}

export function validateFrontendApiUrl(value, buildEnvironment = "production") {
  if (buildEnvironment !== "production" && buildEnvironment !== "development") {
    throw new Error("FRONTEND_BUILD_ENV must be production or development");
  }
  if (!value) throw new Error("VITE_API_BASE_URL is required");

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_API_BASE_URL must be a valid absolute URL");
  }
  if (url.username || url.password) throw new Error("VITE_API_BASE_URL must not contain credentials");

  const loopback = isLoopback(url.hostname);
  if (buildEnvironment === "production") {
    if (url.protocol !== "https:") throw new Error("Production VITE_API_BASE_URL must use HTTPS");
    if (loopback) throw new Error("Production VITE_API_BASE_URL must not use localhost or a loopback address");
    return url;
  }

  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && loopback) return url;
  throw new Error("Development VITE_API_BASE_URL must use HTTPS or local HTTP");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateFrontendApiUrl(process.env.VITE_API_BASE_URL, process.env.FRONTEND_BUILD_ENV ?? "production");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid frontend API URL configuration");
    process.exitCode = 1;
  }
}
