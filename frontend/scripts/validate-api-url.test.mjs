import { describe, expect, it } from "vitest";
import { validateFrontendApiUrl } from "./validate-api-url.mjs";

describe("frontend API URL build validation", () => {
  it("allows an explicitly empty production URL for same-origin API calls", () => {
    expect(validateFrontendApiUrl("", "production")).toBeUndefined();
    expect(() => validateFrontendApiUrl(undefined, "production")).toThrow(/explicitly set/);
    expect(() => validateFrontendApiUrl("", "development")).toThrow(/development builds/);
  });

  it("accepts HTTPS and rejects local or HTTP URLs for production", () => {
    expect(validateFrontendApiUrl("https://api.example.invalid", "production").protocol).toBe("https:");
    expect(() => validateFrontendApiUrl("http://localhost:4000", "production")).toThrow(/HTTPS/);
    expect(() => validateFrontendApiUrl("https://127.0.0.1", "production")).toThrow(/loopback/);
    expect(() => validateFrontendApiUrl("https://[::1]", "production")).toThrow(/loopback/);
  });

  it("preserves the local development URL and rejects remote HTTP", () => {
    expect(validateFrontendApiUrl("http://localhost:4000", "development").port).toBe("4000");
    expect(() => validateFrontendApiUrl("http://api.example.invalid", "development")).toThrow(/local HTTP/);
  });
});
