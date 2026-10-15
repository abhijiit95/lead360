interface AuthCallbackPageProps { status: "loading" | "success" | "linked" | "error"; message?: string }

export function AuthCallbackPage({ status, message }: AuthCallbackPageProps) {
  if (status === "loading") return <main className="callback-shell"><div className="callback-card"><span className="spinner" /><p className="eyebrow">VERIFYING SESSION</p><h1>Finishing sign-in…</h1><p>LeadFlow360 is checking your secure app session.</p></div></main>;
  const ok = status === "success" || status === "linked";
  const title = status === "linked" ? "Google is connected" : status === "success" ? "You’re signed in" : "We couldn’t sign you in";
  return <main className="callback-shell"><div className="callback-card">
    <span className={`result-icon ${ok ? "success" : "failure"}`}>{ok ? "✓" : "!"}</span>
    <p className="eyebrow">{status === "linked" ? "ACCOUNT LINKED" : status === "success" ? "AUTHENTICATED" : "SIGN-IN ISSUE"}</p>
    <h1>{title}</h1>
    <p>{message ?? (status === "linked" ? "This Google identity is now linked to your LeadFlow360 account." : status === "success" ? "Your LeadFlow360 session is ready in a protected browser cookie." : "The Google response could not be verified or this account is not linked yet.")}</p>
    <a className="return-link" href="/">Return to LeadFlow360 <span aria-hidden="true">→</span></a>
  </div></main>;
}
