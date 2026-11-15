import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { authApi, type Me } from '@/api/auth';
import { ApiError, setAuthToken, setUnauthorizedHandler } from '@/api/client';
import { membershipApi } from '@/api/membership';
import { pushApi } from '@/api/push';
import { clearDeckFiles, loadSavedAccount, loadToken, saveAccount, saveToken } from '@/auth/storage';
import { currentPushToken } from '@/lib/notifications';
import { clearPurchaseWatch, loadPurchaseWatch, resetPurchases, savePurchaseWatch, type PurchaseWatch } from '@/lib/purchases';

export type AuthStatus = 'loading' | 'guest' | 'signedIn';

/*
 * Review 2026-11-16 — «اشتريت العضوية ولازم أقفل التطبيق وأفتحه عشان تتفعّل». The server alone activates a membership
 * (CLAUDE.md rule 5); what was missing is the app ASKING it again. The numbers below pace that asking.
 */
/** How long a caller waits for one membership check; a slower answer is still applied when it arrives. */
const SYNC_CAP_MS = 8000;
/**
 * Coming back to the app re-reads a non-member's account with the NORMAL read (the server's 60-second account cache
 * stays in front of the hub), and not more often than this. Only a purchase being watched asks the fresh way.
 */
const FOREGROUND_READ_GAP_MS = 5 * 60_000;
/** The account read at launch failed (offline, slow hub): one more try after this. */
const LAUNCH_RETRY_MS = 20_000;
/** After a purchase: ask every 15 s for 5 minutes, then every 60 s up to 30 minutes (and at launch and on every return, for 72 h). */
const WATCH_FAST_MS = 15_000;
const WATCH_FAST_FOR_MS = 5 * 60_000;
const WATCH_SLOW_MS = 60_000;
const WATCH_TIMER_FOR_MS = 30 * 60_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** What «the membership changed» means: the status, the kind or the end date — not the daily countdown. */
const membershipSignature = (account: Me) => `${account.membership.status}|${account.membership.kind ?? ''}|${account.membership.endDate ?? ''}`;

type AuthContextValue = {
  status: AuthStatus;
  me: Me | null;
  /** Whether this device holds a saved session; `null` until the secure store has answered (read by the sign-in gate). */
  hasSession: boolean | null;
  /**
   * M204: the server answered for this account in this launch. The app opens on the saved account (M165) before that,
   * and a 401 may still sign it out: nothing that opens by itself (a popup) may trust `me` until this is true.
   */
  confirmed: boolean;
  /** The saved session was refused when the app opened: the gate and the sign-in screen show «انتهت الجلسة» once. */
  sessionExpired: boolean;
  /** Forgets that notice (it was seen, or the visitor chose to continue as a guest). */
  dismissSessionExpired: () => void;
  /** Stores the session after login or verification. */
  signIn: (token: string, me: Me) => Promise<void>;
  /** Ends the session on the server (best effort) and locally. */
  signOut: () => Promise<void>;
  /** Re-reads the account from the server; returns null when the session is gone. */
  refresh: () => Promise<Me | null>;
  /** Replaces the cached account after a profile update. */
  setMe: (me: Me) => void;
  /**
   * One server check of the membership after a purchase or a restore (POST /api/membership/sync). The caller waits
   * about 8 seconds at most: it gets the account, or null when there is no answer yet — a later answer is still
   * applied to the account. Only the server's answer activates; the store's own result never does.
   */
  syncMembership: () => Promise<Me | null>;
  /** A purchase is waiting for the server: keep asking — on a timer, on every return to the app, after a restart — until it says active. */
  watchMembership: () => void;
  /** True while such a purchase is still waiting for this account. */
  membershipPending: boolean;
  /** …and it has been waiting for more than 30 minutes: the Subscribe button is offered again beside the waiting notice. */
  membershipPendingLong: boolean;
  /**
   * Ends the watch: the store itself says there is nothing to wait for (a restore found no purchase — a deferred
   * payment that expired or was cancelled). Clears the saved flag too, so Subscribe is offered again.
   */
  stopMembershipWatch: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMeState] = useState<Me | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const tokenRef = useRef<string | null>(null);
  // The account and «the server answered» as callbacks and listeners read them (state is for rendering).
  const meRef = useRef<Me | null>(null);
  const confirmedRef = useRef(false);
  // Every read of the account takes a number when it STARTS. An answer older than one already applied is dropped,
  // so a slow, stale «not a member» can never overwrite a newer «active» (several reads now run side by side).
  const readSeq = useRef(0);
  const appliedSeq = useRef(0);
  const lastReadAt = useRef(0);
  // A purchase waiting for the server's activation (see watchMembership): `firstAfter` is the delay before the first check.
  const watchRef = useRef<PurchaseWatch | null>(null);
  const [watch, setWatch] = useState<(PurchaseWatch & { firstAfter: number }) | null>(null);
  // The `at` of the watch whose 30 minutes have passed (a timer sets it: no clock is read while rendering).
  const [agedWatchAt, setAgedWatchAt] = useState<number | null>(null);
  const [launchReadFailed, setLaunchReadFailed] = useState(false);

  /**
   * The one door every account answer comes through (launch, refresh, a profile update, a membership check).
   * ONE reaction to a membership change: when the SAME account's status, kind or end date differs from the copy the
   * app held, every query is asked again once — the wallet card, event prices, services, people, the affiliate
   * screen and the persisted copies all carry the old answer otherwise. The first copy of a launch (the saved
   * account) and a new session only set the baseline. Returns false when the answer was too old to apply.
   */
  const adopt = useCallback(
    (account: Me, seq: number): boolean => {
      if (seq < appliedSeq.current) return false;
      appliedSeq.current = seq;
      const previous = meRef.current;
      // The same copy again (a check that found nothing new) keeps the object the screens already hold: the app
      // now asks the server far more often, and an identical answer must not re-render every screen.
      if (!previous || JSON.stringify(previous) !== JSON.stringify(account)) {
        meRef.current = account;
        setMeState(account);
      }
      if (account.membership.status === 'active' && watchRef.current?.contactId === account.id) {
        // The server said active: the purchase is no longer waiting.
        watchRef.current = null;
        setWatch(null);
        void clearPurchaseWatch();
      }
      if (previous && previous.id === account.id && membershipSignature(previous) !== membershipSignature(account)) {
        void queryClient.invalidateQueries();
      }
      return true;
    },
    [queryClient],
  );

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    setAuthToken(null);
    // The store identity belongs to the account too (RevenueCat app user id).
    void resetPurchases();
    meRef.current = null;
    confirmedRef.current = false;
    // Answers still on their way belong to the session that just ended.
    appliedSeq.current = ++readSeq.current;
    watchRef.current = null;
    setWatch(null);
    void clearPurchaseWatch();
    setLaunchReadFailed(false);
    setMeState(null);
    setConfirmed(false);
    setHasSession(false);
    setStatus('guest');
    await saveToken(null);
    void saveAccount(null);
    // Rule 4: the pitch decks this account opened are cached files; they leave with the session.
    void clearDeckFiles();
    // Owner (2026-11-02): a signed-out member kept seeing member screens from the cache — person
    // details with unlocked contacts (CLAUDE.md rule 4), his inbox, card, unlocked services. The
    // enumerated removals missed keys, so the WHOLE cache goes: every screen refetches as a guest
    // and shows the locked view; the persisted snapshot is rewritten empty by the cache subscriber.
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, saved] = await Promise.all([loadToken(), loadSavedAccount<Me>()]);
      if (cancelled) return;
      setHasSession(Boolean(stored));
      if (!stored) {
        setStatus('guest');
        return;
      }
      tokenRef.current = stored;
      setAuthToken(stored);
      // M165: the app opens on the last account the server sent; the server is asked behind the screen
      // and replaces it (or signs the member out on a 401). Nobody waits for the hub to see the home.
      if (saved && saved.id !== undefined) {
        // The baseline of this launch: a different membership in the server's answer below refreshes every query.
        adopt(saved, 0);
        setStatus('signedIn');
      }
      const seq = ++readSeq.current;
      try {
        const { me: account } = await authApi.me(stored);
        // `tokenRef` moved on: the session ended, or another account signed in, while the server was answering.
        if (cancelled || tokenRef.current !== stored) return;
        lastReadAt.current = Date.now();
        if (adopt(account, seq)) void saveAccount(account);
        confirmedRef.current = true;
        setConfirmed(true);
        setStatus('signedIn');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          // The client's own handler has already begun ending the session (the token is null by now); a token
          // that is neither null nor the stored one is a NEW session that signed in meanwhile — left alone.
          if (tokenRef.current !== null && tokenRef.current !== stored) return;
          await clearLocal();
          // The member opened the app and found himself a guest: the gate and the sign-in screen say why, once.
          if (!cancelled) setSessionExpired(true);
        } else if (tokenRef.current === stored) {
          // Offline or server trouble: keep the session and show the app; data loads later. The read is tried
          // once more shortly (below) and on the next return to the app — the saved copy may be an old membership.
          setStatus('signedIn');
          setLaunchReadFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, clearLocal]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearLocal();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const signIn = useCallback(
    async (token: string, account: Me) => {
      tokenRef.current = token;
      setAuthToken(token);
      // A new session: nothing of the previous account is compared with it (everything is refetched below anyway).
      meRef.current = null;
      adopt(account, ++readSeq.current);
      confirmedRef.current = true;
      setConfirmed(true);
      setHasSession(true);
      setSessionExpired(false);
      setStatus('signedIn');
      await saveToken(token);
      void saveAccount(account);
      // The guest feed lacks the member's targeted messages (M29): fetch the inbox as him.
      queryClient.removeQueries({ queryKey: ['posts'] });
      queryClient.removeQueries({ queryKey: ['post'] });
      // Everything a guest loaded is asked again as the member (locked cards, prices, his own lists).
      void queryClient.invalidateQueries();
    },
    [adopt, queryClient],
  );

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    // This device stops receiving the account's notifications; the request needs the session token, so it goes first.
    const pushToken = currentPushToken();
    if (token && pushToken) {
      try {
        await pushApi.unregister(pushToken, token);
      } catch {
        // Still registered on the server: the next login on this device takes the token over.
      }
    }
    await clearLocal();
    if (token) {
      try {
        // With the explicit token: clearLocal already emptied the module token, and a logout
        // without it never reached the server, leaving the session alive (owner bug, 2026-11-02).
        await authApi.logout(token);
      } catch {
        // The local session is already gone; the server session expires on its own.
      }
    }
  }, [clearLocal]);

  // `fresh` asks the server to skip its own account cache and read the hub; the plain read may be up to a minute old.
  const read = useCallback(
    async (fresh: boolean): Promise<Me | null> => {
      const token = tokenRef.current;
      if (!token) return null;
      const seq = ++readSeq.current;
      try {
        const { me: account } = await authApi.me(token, fresh);
        // The session ended, or another account signed in, while the server was answering.
        if (tokenRef.current !== token) return null;
        lastReadAt.current = Date.now();
        if (adopt(account, seq)) void saveAccount(account);
        confirmedRef.current = true;
        setConfirmed(true);
        setStatus('signedIn');
        // The newest copy the app holds: this answer, unless a later read was applied first.
        return meRef.current;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && tokenRef.current === token) await clearLocal();
        return null;
      }
    },
    [adopt, clearLocal],
  );

  const refresh = useCallback(() => read(true), [read]);

  const setMe = useCallback(
    (account: Me) => {
      if (adopt(account, ++readSeq.current)) void saveAccount(account);
    },
    [adopt],
  );

  const syncMembership = useCallback(async (): Promise<Me | null> => {
    const token = tokenRef.current;
    if (!token) return null;
    const seq = ++readSeq.current;
    const answer = membershipApi
      .sync()
      .then((result) => {
        if (tokenRef.current !== token) return null;
        lastReadAt.current = Date.now();
        if (adopt(result.me, seq)) void saveAccount(result.me);
        return meRef.current;
      })
      // Server busy or offline: the next check asks again.
      .catch(() => null);
    // The caller moves on after the cap; `answer` above still applies the account whenever it arrives.
    return Promise.race([answer, wait(SYNC_CAP_MS).then(() => null)]);
  }, [adopt]);

  const watchMembership = useCallback(() => {
    const account = meRef.current;
    if (!account || account.membership.status === 'active') return;
    // Always from now: a new purchase or restore restarts the quick pace even when an older watch was resting.
    const started: PurchaseWatch = { contactId: account.id, at: Date.now() };
    watchRef.current = started;
    // The purchase screen is asking the server itself right now: the watcher's first check waits one interval.
    setWatch({ ...started, firstAfter: WATCH_FAST_MS });
    // Saved, so a restart in the middle of «جارٍ التفعيل» goes on asking.
    void savePurchaseWatch(account.id);
  }, []);

  const stopMembershipWatch = useCallback(() => {
    watchRef.current = null;
    setWatch(null);
    void clearPurchaseWatch();
  }, []);

  // A purchase of an earlier launch that the server had not activated yet: pick the watch up again.
  const contactId = me?.id ?? null;
  useEffect(() => {
    if (contactId === null) return;
    let cancelled = false;
    void loadPurchaseWatch(contactId).then((saved) => {
      const account = meRef.current;
      if (cancelled || !saved || watchRef.current || account?.id !== contactId) return;
      if (account.membership.status === 'active') {
        void clearPurchaseWatch();
        return;
      }
      watchRef.current = saved;
      setWatch({ ...saved, firstAfter: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  // The watcher: while a purchase waits, ask the server at once (launch), on a timer and on every return to the app.
  // It only ever applies the server's own answer; the moment that answer is «active», adopt() ends the watch.
  const watching = watch !== null && me !== null && watch.contactId === me.id && me.membership.status !== 'active';
  useEffect(() => {
    if (!watching || !watch) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule(delay: number) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void check(), delay);
    }
    async function check() {
      if (stopped || running) return;
      running = true;
      await syncMembership();
      running = false;
      if (stopped || !watch) return;
      const age = Date.now() - watch.at;
      // After 30 minutes the timer rests; a return to the app and the next launch still ask (for 72 hours).
      if (age < WATCH_TIMER_FOR_MS) schedule(age < WATCH_FAST_FOR_MS ? WATCH_FAST_MS : WATCH_SLOW_MS);
    }
    schedule(watch.firstAfter);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    // Thirty minutes without an activation: the screens offer Subscribe again beside the waiting notice, so a
    // purchase that never completed at the store cannot lock the member out of buying.
    const watchedAt = watch.at;
    const aged = setTimeout(() => setAgedWatchAt(watchedAt), Math.max(0, watchedAt + WATCH_TIMER_FOR_MS - Date.now()));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearTimeout(aged);
      subscription.remove();
    };
  }, [watching, watch, syncMembership]);
  const watchingLong = watching && watch !== null && agedWatchAt === watch.at;

  // Coming back to the app re-reads the account whenever it is not a confirmed, active member: the activation
  // WhatsApp message and the push take the member OUT of the app, and nothing asked again on the way back. Also
  // covers a launch read that failed, and a live session with no saved account (screens kept saying «سجّل الدخول»).
  // It is the NORMAL read, five minutes apart at most: the server forgets its cached copy the moment it activates
  // a membership, so the plain read sees an activation without sending every return of every non-member to the hub.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const account = meRef.current;
      // A watched purchase asks through its own check above (the fresh way), which answers with the account too.
      if (watchRef.current && account && account.membership.status !== 'active') return;
      const settled = confirmedRef.current && account !== null && account.membership.status === 'active';
      if (settled || Date.now() - lastReadAt.current < FOREGROUND_READ_GAP_MS) return;
      void read(false);
    });
    return () => subscription.remove();
  }, [status, read]);

  // The account read at launch failed for a reason other than an ended session: one more try, shortly — the same
  // normal read the launch makes.
  useEffect(() => {
    if (!launchReadFailed) return;
    const timer = setTimeout(() => {
      if (!confirmedRef.current) void read(false);
    }, LAUNCH_RETRY_MS);
    return () => clearTimeout(timer);
  }, [launchReadFailed, read]);

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      hasSession,
      confirmed,
      sessionExpired,
      dismissSessionExpired,
      signIn,
      signOut,
      refresh,
      setMe,
      syncMembership,
      watchMembership,
      stopMembershipWatch,
      membershipPending: watching,
      membershipPendingLong: watchingLong,
    }),
    [status, me, hasSession, confirmed, sessionExpired, dismissSessionExpired, signIn, signOut, refresh, setMe, syncMembership, watchMembership, stopMembershipWatch, watching, watchingLong],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
