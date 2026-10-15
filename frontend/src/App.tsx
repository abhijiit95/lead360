import { useEffect, useState } from "react";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { getSession, signOut, type SessionUser } from "./services/authService";
import "./App.css";

function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const query = new URLSearchParams(window.location.search);
  const isCallback = window.location.pathname === "/auth/callback";
  const status = query.get("status");
  const errorKey = status === "account_not_linked" || status === "login_failed" ? status : undefined;

  useEffect(() => {
    let active = true;
    getSession().then((currentUser) => { if (active) setUser(currentUser); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function handleSignOut() {
    setSigningOut(true); setLogoutError("");
    try { await signOut(); setUser(null); window.history.replaceState({}, "", "/"); }
    catch (error) { setLogoutError(error instanceof Error ? error.message : "Could not sign out."); }
    finally { setSigningOut(false); }
  }

  if (isCallback) {
    if (status === "linked") return <AuthCallbackPage status="linked" />;
    if (status === "success" && checking) return <AuthCallbackPage status="loading" />;
    if (status === "success" && user) return <AuthCallbackPage status="success" message={`Welcome, ${user.name}. Your LeadFlow360 session is ready.`} />;
    return <AuthCallbackPage status="error" message={errorKey === "account_not_linked" ? "This Google account is not linked. Sign in to an existing LeadFlow360 account and link it before using Google Login." : undefined} />;
  }

  if (checking) return <main className="callback-shell"><div className="callback-card"><span className="spinner" /><p className="eyebrow">CHECKING SESSION</p><h1>Opening your workspace…</h1></div></main>;
  return <><LoginPage user={user} onSignOut={handleSignOut} signingOut={signingOut} initialError={errorKey} />{logoutError && <p className="toast-error" role="alert">{logoutError}</p>}</>;
}

export default App;
