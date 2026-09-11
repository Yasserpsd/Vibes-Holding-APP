import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { authApi, type Me } from '@/api/auth';
import { ApiError, setAuthToken, setUnauthorizedHandler } from '@/api/client';
import { loadToken, saveToken } from '@/auth/storage';

export type AuthStatus = 'loading' | 'guest' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  /** Stores the session after login or verification. */
  signIn: (token: string, me: Me) => Promise<void>;
  /** Ends the session on the server (best effort) and locally. */
  signOut: () => Promise<void>;
  /** Re-reads the account from the server; returns null when the session is gone. */
  refresh: () => Promise<Me | null>;
  /** Replaces the cached account after a profile update. */
  setMe: (me: Me) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMeState] = useState<Me | null>(null);
  const tokenRef = useRef<string | null>(null);

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    setAuthToken(null);
    setMeState(null);
    setStatus('guest');
    await saveToken(null);
    queryClient.removeQueries({ queryKey: ['me'] });
    // Interests belong to the account: the next member on this device must not inherit them.
    queryClient.removeQueries({ queryKey: ['news', 'prefs'] });
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadToken();
      if (cancelled) return;
      if (!stored) {
        setStatus('guest');
        return;
      }
      tokenRef.current = stored;
      setAuthToken(stored);
      try {
        const { me: account } = await authApi.me(stored);
        if (cancelled) return;
        setMeState(account);
        setStatus('signedIn');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          await clearLocal();
        } else {
          // Offline or server trouble: keep the session and show the app; data loads later.
          setStatus('signedIn');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearLocal]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearLocal();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const signIn = useCallback(async (token: string, account: Me) => {
    tokenRef.current = token;
    setAuthToken(token);
    setMeState(account);
    setStatus('signedIn');
    await saveToken(token);
  }, []);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    await clearLocal();
    if (token) {
      try {
        await authApi.logout();
      } catch {
        // The local session is already gone; the server session expires on its own.
      }
    }
  }, [clearLocal]);

  const refresh = useCallback(async (): Promise<Me | null> => {
    const token = tokenRef.current;
    if (!token) return null;
    try {
      const { me: account } = await authApi.me(token, true);
      setMeState(account);
      setStatus('signedIn');
      return account;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearLocal();
      return null;
    }
  }, [clearLocal]);

  const setMe = useCallback((account: Me) => setMeState(account), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, me, signIn, signOut, refresh, setMe }),
    [status, me, signIn, signOut, refresh, setMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
