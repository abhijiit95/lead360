// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthCallbackPage } from "./AuthCallbackPage";
import { LoginPage } from "./LoginPage";

afterEach(cleanup);

describe("authentication states", () => {
  it("shows a successful callback message", () => {
    render(<AuthCallbackPage status="success" message="Welcome, Alex." />);
    expect(screen.getByRole("heading", { name: "You’re signed in" })).toBeTruthy();
    expect(screen.getByText("Welcome, Alex.")).toBeTruthy();
  });

  it("shows a safe error when the Google identity is not linked", () => {
    render(<LoginPage user={null} onSignOut={() => {}} signingOut={false} initialError="account_not_linked" />);
    expect(screen.getByRole("alert").textContent).toContain("not linked yet");
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
  });
});
