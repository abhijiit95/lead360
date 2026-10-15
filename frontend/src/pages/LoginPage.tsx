import { useState, type FormEvent } from "react";
import { AuthStatus } from "../components/AuthStatus";
import { GoogleLoginButton } from "../components/GoogleLoginButton";
import { signInAndStartGoogleLink, type SessionUser } from "../services/authService";

const errorMessages: Record<string, string> = {
  account_not_linked: "This Google account is not linked yet. Sign in to your existing LeadFlow360 account and link Google before using Google Login.",
  login_failed: "Google sign-in could not be completed. Please try again.",
};

export function LoginPage({ user, onSignOut, signingOut, initialError }: {
  user: SessionUser | null; onSignOut: () => void; signingOut: boolean; initialError?: string;
}) {
  const [error, setError] = useState(initialError ? errorMessages[initialError] ?? "Sign-in could not be completed." : "");
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [linking, setLinking] = useState(false);

  async function handleLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLinking(true); setError("");
    try { await signInAndStartGoogleLink(linkEmail, linkPassword); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "Could not link Google account."); setLinking(false); }
  }

  return <main className="page-shell">
    <header className="topbar"><a className="wordmark" href="/" aria-label="LeadFlow360 home"><span className="brand-symbol">L</span>LeadFlow<span>360</span></a><span className="topbar-note"><span className="status-dot" /> Secure sign-in</span></header>
    <div className="content-grid">
      <section className="welcome-panel">
        <div className="welcome-kicker"><span>LEAD MANAGEMENT, MADE CLEAR</span><span className="kicker-line" /></div>
        <h1>Welcome to<br /><span>LeadFlow360</span></h1>
        <p className="intro">A focused workspace for your team to keep every lead moving, every follow-up on time, and every conversation in view.</p>
        {user ? <AuthStatus user={user} onSignOut={onSignOut} busy={signingOut} /> : <div className="login-card">
          <p className="eyebrow">YOUR WORKSPACE STARTS HERE</p><h2>Sign in to continue</h2>
          <p className="card-description">Use a Google account that has been linked to your LeadFlow360 profile.</p>
          <GoogleLoginButton onError={setError} />
          {error && <p className="error-message" role="alert">{error}</p>}
          <p className="privacy-note"><span aria-hidden="true">▣</span> Google tokens stay on the server. This app uses Google to verify your sign-in.</p>
          <details className="link-account">
            <summary>First time? Link Google to your existing account</summary>
            <p>Verify your current LeadFlow360 email and password first. The account link uses Google’s verified subject, never an email-only match.</p>
            <form onSubmit={handleLink}>
              <label>Email<input type="email" autoComplete="username" required value={linkEmail} onChange={(event) => setLinkEmail(event.target.value)} /></label>
              <label>Password<input type="password" autoComplete="current-password" required value={linkPassword} onChange={(event) => setLinkPassword(event.target.value)} /></label>
              <button className="link-submit" type="submit" disabled={linking}>{linking ? "Opening Google…" : "Verify & link Google"}</button>
            </form>
          </details>
        </div>}
        <p className="footer-note">Built for thoughtful teams that never let a good lead go cold.</p>
      </section>
      <aside className="learning-panel" aria-label="How sign-in works"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="learning-content">
        <div className="panel-label"><span className="panel-icon">↗</span><span>THE SIGN-IN JOURNEY</span></div>
        <h2>One identity.<br /><em>One secure flow.</em></h2><p className="panel-intro">Google confirms who you are. LeadFlow360 handles your app session.</p>
        <ol className="flow-list">
          <li><span className="flow-number">01</span><div><strong>Frontend</strong><small>You start sign-in</small></div><span className="flow-arrow">↓</span></li>
          <li><span className="flow-number">02</span><div><strong>LeadFlow360 API</strong><small>Creates state, nonce & PKCE</small></div><span className="flow-arrow">↓</span></li>
          <li><span className="flow-number">03</span><div><strong>Google</strong><small>Authenticates your account</small></div><span className="flow-arrow">↓</span></li>
          <li><span className="flow-number">04</span><div><strong>OIDC validation</strong><small>Backend verifies Google’s ID token</small></div><span className="flow-arrow">↓</span></li>
          <li><span className="flow-number">05</span><div><strong>App session</strong><small>HttpOnly LeadFlow360 cookie</small></div><span className="flow-check">✓</span></li>
        </ol>
        <div className="token-note"><span className="token-note-icon">i</span><p><strong>Three credentials, three jobs.</strong><br />Google ID token proves identity to the backend. Google access tokens are not used for login. LeadFlow360’s JWT cookie protects app APIs.</p></div>
      </div><span className="panel-index">AUTH / 01</span></aside>
    </div>
  </main>;
}
