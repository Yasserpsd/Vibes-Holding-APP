import { requireOptionalNativeModule } from 'expo';

/**
 * 2026-11-16 (members: «شاشة سودا بدون سبب»). On Android a fatal JavaScript error does not close the app: React
 * Native destroys the React host, expo-updates only reacts during the first ten seconds of the process, and the
 * member is left on a dead black window until the app is swiped away. Two guards answer it:
 *
 * 1. this global handler, for errors OUTSIDE render (a timer, a listener, an onPress): in release builds a fatal one
 *    is no longer handed to the native side, so the host survives and the app keeps running — one action failed,
 *    not the app;
 * 2. the error boundaries in app/_layout.tsx (components/CrashScreen.tsx), for errors INSIDE render, which never
 *    pass through this handler.
 *
 * The one case both guards leave alone: a fatal error BEFORE the first commit of a cold start on a downloaded
 * update (a throw at module scope, or in the very first render of the root layout). Only then can expo-updates still
 * mark that update as failed and start the previous one — the only automatic way back from a broken OTA — so the
 * error is passed on exactly as before (see `nativeRollbackStands`). Once anything has been mounted (the root layout
 * mounts its launch cover at the first commit) expo-updates counts the launch as successful: its plan is then «wait
 * for a remote update, then crash», no rollback, so passing an error on would only tear the host down — the black
 * window on Android, a closed app on iPhone (ErrorRecoveryHandler.kt `handleContentAppeared`, ErrorRecovery.swift).
 *
 * Imported first by the root layout: the handler is in place before any other module of the app runs.
 */

type Handler = (error: unknown, isFatal?: boolean) => void;
type GlobalErrorUtils = { getGlobalHandler?: () => Handler; setGlobalHandler?: (handler: Handler) => void };
type UpdatesConstants = { isEnabled?: unknown; isEmbeddedLaunch?: unknown; initialContext?: { restartCount?: unknown } | null };

const startedAt = Date.now();
/**
 * expo-updates watches for ten seconds after the first frame of the PROCESS. This is counted from the start of
 * JavaScript, which comes before that frame, so inside it the native watch is certainly still armed.
 */
const NATIVE_WATCH_MS = 8_000;

function readNativeWatch(): boolean {
  if (__DEV__) return false;
  try {
    const native = requireOptionalNativeModule('ExpoUpdates') as UpdatesConstants | null;
    if (!native || native.isEnabled !== true) return false;
    // The binary's own bundle has nothing older to go back to.
    if (native.isEmbeddedLaunch !== false) return false;
    // The watch is armed once per process: after a reload (restartCount > 0) nobody is watching any more.
    return native.initialContext?.restartCount === 0;
  } catch {
    return false;
  }
}

const nativeWatch = readNativeWatch();

// A rollback is only possible before the first view is mounted: the root layout reports its first commit here.
let firstCommit = false;

/** Called once by the root layout, in an effect of its first commit: from here on every error is caught. */
export function markFirstCommit(): void {
  firstCommit = true;
}

/**
 * True while a fatal error must still reach the native side so that expo-updates can roll a broken update back:
 * the first JavaScript start of the process, on a downloaded update, BEFORE the first commit (and inside the first
 * seconds, as a second bound). False everywhere else (and whenever the state cannot be read), where passing the
 * error on would only leave the dead black window.
 */
export function nativeRollbackStands(): boolean {
  return nativeWatch && !firstCommit && Date.now() - startedAt < NATIVE_WATCH_MS;
}

/** One line per failure in the device log (`adb logcat -s ReactNativeJS`). No server route takes these yet. */
export function noteCrash(where: string, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 4).join(' | ') : '';
    console.warn(`crash guard [${where}]`, message, stack);
  } catch {
    // Reporting a failure must never be a second failure.
  }
}

function install(): void {
  // Development keeps the red box.
  if (__DEV__) return;
  const utils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (!utils?.getGlobalHandler || !utils.setGlobalHandler) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    if (!isFatal || nativeRollbackStands()) {
      previous(error, isFatal);
      return;
    }
    noteCrash('fatal', error);
  });
}

try {
  install();
} catch {
  // Module scope of the launch path: never throw here.
}
