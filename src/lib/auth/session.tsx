import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Account, AuthSession } from "../../types/domain";
import { isSetupPending, markSetupPending, setupRoute } from "../onboarding/store";
import { organizationsFor } from "../organizations/store";
import { isTauri } from "../platform";
import { getWorkspaceRepository, setRepositoryToken } from "../workspace/repository";
import {
  clearPendingHostedIdentity,
  exchangeHostedCode,
  finishHostedHandoff,
  hostedHandoffPending,
  hostedAuthConfigured,
  hostedProblemRoute,
  hostedSignIn,
  hostedSignOut,
  identityFromUser,
  parseHostedLink,
  setHostedSession,
  takeStoredHostedLink,
  type HostedIdentity,
} from "./hosted";
import { messageOf } from "../errors";

const repository = getWorkspaceRepository();
const TOKEN_KEY = "civicflow.auth.token";
// macOS can deliver one launch URL twice: once from getCurrent() and once from
// the open-url event. The first delivery already decides the session, so the
// repeat must not be judged as a second, rejected link.
const handledHostedLinks = new Set<string>();

interface AuthValue {
  user: Account | null;
  token: string | null;
  loading: boolean;
  signIn(email: string, password: string, remember: boolean): Promise<AuthSession>;
  /** Opens the bundled demo workspace. The only action that creates fixtures. */
  openDemo(remember: boolean): Promise<AuthSession>;
  signUp(name: string, email: string, password: string, remember: boolean): Promise<AuthSession>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  /** True when this device held a session that is no longer valid. */
  expired: boolean;
  /** True when a hosted provider is configured in this build. */
  hosted: boolean;
  /** Resumes the local workspace for an identity the hosted provider verified. */
  adoptHostedIdentity(identity: HostedIdentity, remember: boolean): Promise<AuthSession>;
}

const AuthContext = createContext<AuthValue | null>(null);

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function rememberToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // A blocked storage area only shortens the session; it is not a failure.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => storedToken());
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  // Set only when a stored token stops resolving, never on a first visit, so
  // the sign-in screen can say why someone landed back on it.
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    const current = token ?? storedToken();
    if (!current) {
      setRepositoryToken(null);
      setToken(null);
      setUser(null);
      setLoading(false);
      return;
    }
    setRepositoryToken(current);
    try {
      const account = await repository.currentUser(current);
      if (!account) {
        rememberToken(null);
        setRepositoryToken(null);
        setToken(null);
        setExpired(true);
      } else {
        setToken(current);
      }
      setUser(account);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const current = storedToken();
    if (!current) {
      // Defer the empty-session write so the effect body itself stays pure, and
      // re-read storage first: a sign-in can finish between mount and this tick.
      const timer = window.setTimeout(() => {
        if (!active || storedToken()) return;
        setRepositoryToken(null);
        setToken(null);
        setUser(null);
        setLoading(false);
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    setRepositoryToken(current);
    repository
      .currentUser(current)
      .then((account) => {
        if (!active) return;
        if (!account) {
          rememberToken(null);
          setRepositoryToken(null);
          setExpired(true);
        }
        setToken(account ? current : null);
        setUser(account);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const adoptHostedIdentity = useCallback(async (identity: HostedIdentity, remember: boolean) => {
    const session = await repository.signInWithHosted(identity);
    setExpired(false);
    setRepositoryToken(session.token);
    if (remember) rememberToken(session.token);
    else rememberToken(null);
    setToken(session.token);
    setUser(session.user);
    clearPendingHostedIdentity();
    return session;
  }, []);

  const localSignIn = useCallback(async (email: string, password: string, remember: boolean) => {
    const session = await repository.signIn(email, password, remember);
    setExpired(false);
    setRepositoryToken(session.token);
    if (remember) rememberToken(session.token);
    else rememberToken(null);
    setToken(session.token);
    setUser(session.user);
    return session;
  }, []);

  const openDemo = useCallback(async (remember: boolean) => {
    const session = await repository.openDemoWorkspace();
    setExpired(false);
    setRepositoryToken(session.token);
    if (remember) rememberToken(session.token);
    else rememberToken(null);
    setToken(session.token);
    setUser(session.user);
    return session;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      if (hostedAuthConfigured) {
        let hostedError: unknown = null;
        try {
          const hostedSession = await hostedSignIn(email, password);
          const identity = identityFromUser(hostedSession.user);
          if (identity) return await adoptHostedIdentity(identity, remember);
        } catch (caught) {
          hostedError = caught;
        }
        // Local accounts are the fallback when the provider cannot help.
        try {
          return await localSignIn(email, password, remember);
        } catch (localError) {
          // A throttled or disabled account has the more useful message.
          const code = (localError as { code?: string } | null)?.code;
          if (code && code !== "INVALID_CREDENTIALS") throw localError;
          throw hostedError ?? localError;
        }
      }
      return localSignIn(email, password, remember);
    },
    [adoptHostedIdentity, localSignIn],
  );

  // Email links come back to the installed app through the civicflow:// scheme.
  // The callback page handles the browser build.
  useEffect(() => {
    if (!hostedAuthConfigured || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function receive(urls: string[] | null) {
      if (!urls?.length || disposed) return;
      for (const raw of urls) {
        const link = parseHostedLink(raw);
        if (!link) continue;
        // The same answer delivered again is not a new answer.
        if (handledHostedLinks.has(raw)) continue;
        handledHostedLinks.add(raw);
        if (!(await hostedHandoffPending(link.kind))) {
          // A scheme URL that this device never asked for is not a sign-in.
          window.location.hash = hostedProblemRoute(
            "This link was not requested on this device. Start again from the sign-in screen.",
          );
          continue;
        }
        try {
          if (link.error) throw new Error(link.error);
          if (!link.accessToken && !link.code) {
            throw new Error("That link did not carry a sign-in token. Request a new email.");
          }
          const hostedSession =
            link.accessToken && link.refreshToken
              ? await setHostedSession(link.accessToken, link.refreshToken)
              : await exchangeHostedCode(link.code as string);
          if (link.kind === "reset") {
            await finishHostedHandoff();
            window.location.hash = "#/reset-password";
            return;
          }
          const identity = identityFromUser(hostedSession.user);
          if (!identity) throw new Error("That account has no email address.");
          // A provider account with no organization yet is new: setup comes first.
          if (organizationsFor(identity.email).length === 0) {
            markSetupPending(identity.email);
          }
          const session = await adoptHostedIdentity(identity, true);
          await finishHostedHandoff();
          window.location.hash = `#${accountHome(session.user)}`;
        } catch (caught) {
          // Bouncing to the sign-in screen hid every reason a link failed; the
          // callback page can now say what the provider said.
          window.location.hash = hostedProblemRoute(messageOf(caught));
        }
      }
    }

    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const current = await getCurrent();
        if (current?.length) await receive(current);
        else {
          // A reload after the OS handed the URL over; taking it spends it.
          const stored = await takeStoredHostedLink();
          if (stored) await receive([stored]);
        }
        unlisten = await onOpenUrl((urls) => void receive(urls));
      } catch {
        // A build without the deep-link plugin simply has no email returns.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [adoptHostedIdentity]);

  const signUp = useCallback(
    async (name: string, email: string, password: string, remember: boolean) => {
      const session = await repository.createAccount(name, email, password);
      setExpired(false);
      setRepositoryToken(session.token);
      if (remember) rememberToken(session.token);
      else rememberToken(null);
      setToken(session.token);
      setUser(session.user);
      return session;
    },
    [],
  );

  const signOut = useCallback(async () => {
    const current = token ?? storedToken();
    // Clear the local session first so the window leaves the workspace even if
    // revoking the server-side session is slow or the database is busy.
    rememberToken(null);
    setRepositoryToken(null);
    setToken(null);
    setUser(null);
    setExpired(false);
    if (current) {
      try {
        await repository.signOut(current);
      } catch {
        // The token is gone from this device; revocation can wait for expiry.
      }
    }
    await hostedSignOut();
  }, [token]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      token,
      loading,
      signIn,
      openDemo,
      signUp,
      signOut,
      refresh,
      expired,
      hosted: hostedAuthConfigured,
      adoptHostedIdentity,
    }),
    [
      user,
      token,
      loading,
      expired,
      signIn,
      openDemo,
      signUp,
      signOut,
      refresh,
      adoptHostedIdentity,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** For providers that can also render without an account, such as tests. */
export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}

/**
 * The screen a session belongs on. The role comes from an active membership, so
 * a role other than "none" already proves the account has an organization; the
 * cached organization list is not consulted here. It used to be, and a cache
 * still holding the signed-out state sent a fresh coordinator sign-in to the
 * create-or-join screen instead of the workspace it had just opened.
 */
export function accountHome(account: Account): string {
  if (account.role === "none") return "/coordinator/start";
  // Setup is keyed by identity in device storage and runs before the workspace.
  if (isSetupPending(account)) return setupRoute(account, true);
  return account.role === "volunteer" ? "/volunteer/home" : "/coordinator/mission-control";
}
