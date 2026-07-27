import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

/**
 * Call once, from a mounted component's effect (see app/_layout.tsx) — never
 * at module top-level. This touches the native WebBrowser bridge, which
 * isn't guaranteed to be ready yet during synchronous module evaluation
 * (before React has even mounted); deferring it to an effect guarantees the
 * app is fully up first. Needed once per app load so a pending
 * openAuthSessionAsync() call gets notified when the OS hands control back
 * to this app after the in-app browser redirects — see expo-web-browser's
 * docs on this exact pairing.
 */
export function completePendingAuthSession(): void {
  WebBrowser.maybeCompleteAuthSession();
}

export type GithubLoginResult = { token: string } | { error: string };

/**
 * GitHub OAuth, mediated entirely by the backend (see backend/auth.py) —
 * this app never sees GitHub's client secret or its access token, only the
 * JWT the backend issues at the end. Works in Expo Go: makeRedirectUri()
 * produces an exp://<metro-host>:8081/--/redirect URI there (a
 * devagentremote:// deep link in a native build instead — see app.json's
 * "scheme"), and it's *that* dynamic URI the backend is told to redirect
 * back to (as `return_to`), not a fixed one — GitHub's own registered
 * callback only ever points at the backend, which is the one fixed,
 * stable URL in this whole flow.
 */
export async function loginWithGithub(backendHttpUrl: string): Promise<GithubLoginResult> {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: "devagentremote" });
  const loginUrl =
    `${backendHttpUrl}/auth/github/login?return_to=${encodeURIComponent(redirectUri)}`;

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUri);
  } catch {
    return { error: "could not open browser" };
  }

  if (result.type === "cancel" || result.type === "dismiss") {
    return { error: "cancelled" };
  }
  if (result.type !== "success" || !result.url) {
    return { error: "login failed" };
  }

  const token = extractParam(result.url, "token");
  if (token) return { token };

  const error = extractParam(result.url, "error");
  return { error: error || "login failed" };
}

function extractParam(url: string, key: string): string | null {
  const match = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
