import { useState } from "react";
import { startGoogleLogin } from "../services/authService";

export function GoogleLoginButton({ onError }: { onError: (message: string) => void }) {
  const [loading, setLoading] = useState(false);
  function handleClick() {
    setLoading(true);
    onError("");
    try { startGoogleLogin(); }
    catch {
      setLoading(false);
      onError("Could not start Google sign-in. Check that the backend is running.");
    }
  }
  return <button className="google-button" type="button" onClick={handleClick} disabled={loading}>
    <span className="google-mark" aria-hidden="true">G</span>{loading ? "Opening Google…" : "Continue with Google"}<span className="button-arrow" aria-hidden="true">↗</span>
  </button>;
}
