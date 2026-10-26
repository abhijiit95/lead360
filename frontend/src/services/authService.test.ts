import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./authService";

describe("API base URL selection", () => {
  it("keeps localhost as the development fallback", () => {
    expect(resolveApiBaseUrl(undefined, true)).toBe("http://localhost:4000");
  });

  it("uses same-origin requests as the production fallback", () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe("");
    expect(resolveApiBaseUrl("", false)).toBe("");
  });

  it("preserves an explicitly configured API URL", () => {
    expect(resolveApiBaseUrl("https://api.example.test/", false)).toBe("https://api.example.test");
    expect(resolveApiBaseUrl("http://localhost:4000/", true)).toBe("http://localhost:4000");
  });
});
