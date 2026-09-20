import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { advisorApi, type AdvisorContext, type AdvisorGate, type AdvisorMessage, type AdvisorProfile } from '@/api/advisor';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

const WAITING_POLL_MS = 2000;
const IDLE_POLL_MS = 15000;
/** Messages shown before the hub confirms them get ids above any real hub id, so they stay last. */
const OPTIMISTIC_BASE = 1e15;
const TIMEOUT_TEXT = 'تأخر الرد هذه المرة. أعد إرسال سؤالك بعد قليل.';

export type ChatStatus = 'loading' | 'ready' | 'error';

type ChatState = {
  status: ChatStatus;
  messages: AdvisorMessage[];
  profile: AdvisorProfile | null;
  /** The hub is waiting for the workflow's reply. */
  waiting: boolean;
  /** A staff member took over the conversation from the hub console. */
  human: boolean;
  gate: AdvisorGate | null;
  loadError: string | null;
  sendError: string | null;
  sending: boolean;
};

const initialState: ChatState = {
  status: 'loading',
  messages: [],
  profile: null,
  waiting: false,
  human: false,
  gate: null,
  loadError: null,
  sendError: null,
  sending: false,
};

/** How a send ended. `contextRefused`: the server took the message only without its context, so the «تسأل عن» pill no longer holds. */
export type SendOutcome = { accepted: boolean; contextRefused: boolean };

function mergeMessages(current: AdvisorMessage[], incoming: AdvisorMessage[]): AdvisorMessage[] {
  if (!incoming.length) return current;
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  if (!fresh.length) return current;
  return [...current, ...fresh].sort((a, b) => a.id - b.id);
}

/**
 * The account's hub conversation: loads the history, sends messages, and polls for replies
 * (fast while the workflow is answering, slow otherwise so staff replies from the console still
 * arrive) while the screen is focused.
 */
export function useAdvisorChat() {
  const { setMe } = useAuth();
  const [state, setState] = useState<ChatState>(initialState);
  const [focused, setFocused] = useState(false);
  const lastId = useRef(0);
  const optimisticCount = useRef(0);
  const polling = useRef(false);
  const loadedOnce = useRef(false);

  const noteIds = (messages: AdvisorMessage[]) => {
    for (const message of messages) {
      if (message.id < OPTIMISTIC_BASE) lastId.current = Math.max(lastId.current, message.id);
    }
  };

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: prev.messages.length ? prev.status : 'loading', loadError: null }));
    try {
      const result = await advisorApi.history();
      lastId.current = 0;
      noteIds(result.messages);
      setState((prev) => ({ ...prev, status: 'ready', messages: result.messages, profile: result.profile, loadError: null }));
      if (result.me) setMe(result.me);
    } catch (error) {
      setState((prev) => ({ ...prev, status: prev.messages.length ? 'ready' : 'error', loadError: errorMessage(error) }));
    }
  }, [setMe]);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const result = await advisorApi.poll(lastId.current);
      noteIds(result.messages);
      setState((prev) => ({
        ...prev,
        messages: mergeMessages(prev.messages, result.messages),
        waiting: result.waiting,
        human: result.human,
        sendError: result.timeout && !result.messages.length ? TIMEOUT_TEXT : prev.sendError,
      }));
      if (result.me) setMe(result.me);
    } catch {
      // A failed tick is silent; the next one tries again.
    } finally {
      polling.current = false;
    }
  }, [setMe]);

  /** Sends a message; `accepted` when the hub took it. */
  const send = useCallback(
    async (text: string, context: AdvisorContext | null): Promise<SendOutcome> => {
      const trimmed = text.trim();
      if (!trimmed) return { accepted: false, contextRefused: false };
      optimisticCount.current += 1;
      const tempId = OPTIMISTIC_BASE + optimisticCount.current;
      const draft: AdvisorMessage = { id: tempId, role: 'user', text: trimmed, at: new Date().toISOString(), by: null, image: null, audio: null, actions: [] };
      setState((prev) => ({ ...prev, messages: [...prev.messages, draft], sending: true, sendError: null, gate: null }));
      try {
        const result = await advisorApi.send(trimmed, context);
        const contextRefused = result.contextRefused;
        if (result.me) setMe(result.me);
        if (result.gate) {
          const gate = result.gate;
          setState((prev) => ({ ...prev, messages: prev.messages.filter((message) => message.id !== tempId), sending: false, gate }));
          return { accepted: false, contextRefused };
        }
        const id = result.messageId;
        if (id !== null) lastId.current = Math.max(lastId.current, id);
        setState((prev) => ({
          ...prev,
          messages:
            id === null
              ? prev.messages.filter((message) => message.id !== tempId)
              : prev.messages.map((message) => (message.id === tempId ? { ...message, id } : message)),
          sending: false,
          waiting: result.waiting,
          human: result.human,
        }));
        if (id === null) void load();
        return { accepted: true, contextRefused };
      } catch (error) {
        setState((prev) => ({ ...prev, messages: prev.messages.filter((message) => message.id !== tempId), sending: false, sendError: errorMessage(error) }));
        // The hub may have stored the message even when its workflow failed: resync.
        void load();
        return { accepted: false, contextRefused: false };
      }
    },
    [load, setMe],
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (!loadedOnce.current) {
        loadedOnce.current = true;
        void load();
      } else {
        void poll();
      }
      return () => setFocused(false);
    }, [load, poll]),
  );

  useEffect(() => {
    if (!focused || state.status !== 'ready') return;
    const timer = setInterval(() => void poll(), state.waiting ? WAITING_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [focused, state.status, state.waiting, poll]);

  const dismissGate = useCallback(() => setState((prev) => ({ ...prev, gate: null })), []);
  const dismissError = useCallback(() => setState((prev) => ({ ...prev, sendError: null })), []);

  return { ...state, load, send, dismissGate, dismissError };
}
