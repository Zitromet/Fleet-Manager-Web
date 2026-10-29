// =====================================================================
// login.js - the sign-in page (index.html)
// Two ways to sign in:
//   1. e-mail + password (the user you create in Supabase -> Authentication)
//   2. "magic link": Supabase e-mails a one-click sign-in link
// =====================================================================

const msg = document.getElementById("loginMsg");
function say(text, isError) {
  msg.textContent = text;
  msg.className = "login-msg" + (isError ? " error" : "");
}

// Web address of the dashboard, next to this page (works on GitHub Pages too)
const DASHBOARD_URL = new URL("dashboard.html", location.href).href;

(async function start() {
  if (CONFIG_IS_PLACEHOLDER) {
    document.getElementById("configWarning").hidden = false;
    return;
  }
  // Already signed in (or just came back from a magic link)? Go straight in.
  const { data } = await sb.auth.getSession();
  if (data.session) location.href = DASHBOARD_URL;
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) location.href = DASHBOARD_URL;
  });
})();

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sb) return say("Not connected: fill in config.js first.", true);
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!password) return say("Type your password, or use the e-mail link button.", true);
  say("Signing in…");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) say("Sign-in failed: " + error.message, true);
  else location.href = DASHBOARD_URL;
});

document.getElementById("magicBtn").addEventListener("click", async () => {
  if (!sb) return say("Not connected: fill in config.js first.", true);
  const email = document.getElementById("email").value.trim();
  if (!email) return say("Type your e-mail first.", true);
  say("Sending link…");
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: DASHBOARD_URL },
  });
  if (error) say("Could not send link: " + error.message, true);
  else say("Check your inbox for the sign-in link (open it in this same browser).");
});
