import type { SessionUser } from "../services/authService";

export function AuthStatus({ user, onSignOut, busy }: { user: SessionUser; onSignOut: () => void; busy: boolean }) {
  return <section className="signed-in-card" aria-live="polite">
    <div className="avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</div>
    <div className="signed-in-copy"><p className="eyebrow">GOOGLE SIGN-IN COMPLETE</p><h2>Welcome, {user.name}</h2><p>{user.email} <span className="role-chip">{user.role}</span></p></div>
    <button className="signout-button" type="button" onClick={onSignOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
  </section>;
}
