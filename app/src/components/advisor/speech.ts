import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';

import { advisorApi } from '@/api/advisor';

import { audio } from './VoiceButton';

/**
 * M148 «المستشار يرد بالصوت»: one speaker per reply. The server synthesises the clip (OpenAI TTS), the
 * app keeps it in the cache folder for the session and plays it through expo-audio — the same native
 * module the mic uses, so binaries without it simply show no speaker (OTA-safe).
 */
export type SpeechState = 'idle' | 'loading' | 'playing';

type Player = ReturnType<NonNullable<typeof audio>['createAudioPlayer']>;

const clips = new Map<number, string>();
const listeners = new Set<() => void>();
let active: { id: number; state: SpeechState; player: Player | null; run: number } | null = null;
let runs = 0;

export function speechAvailable(): boolean {
  return audio !== null;
}

function notify() {
  for (const listener of listeners) listener();
}

function stateOf(id: number): SpeechState {
  return active && active.id === id ? active.state : 'idle';
}

/** Stops whatever plays (or loads) and frees the native player. */
export function stopSpeech() {
  const current = active;
  active = null;
  if (current?.player) {
    try {
      current.player.pause();
      current.player.remove();
    } catch {
      // Already released.
    }
  }
  notify();
}

async function clipFor(id: number, text: string): Promise<string> {
  const known = clips.get(id);
  if (known) return known;
  const { audio: base64 } = await advisorApi.speak(text);
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('no_cache_dir');
  const uri = `${dir}advisor-speech-${id}.mp3`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  clips.set(id, uri);
  return uri;
}

/** Plays the reply, or stops it when it is the one playing. Rejects when the clip cannot be made. */
export async function toggleSpeech(id: number, text: string): Promise<void> {
  const mod = audio;
  if (!mod) return;
  if (active && active.id === id) {
    stopSpeech();
    return;
  }
  stopSpeech();
  const run = ++runs;
  active = { id, state: 'loading', player: null, run };
  notify();
  try {
    const uri = await clipFor(id, text);
    if (!active || active.run !== run) return; // stopped or replaced while loading
    await mod.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!active || active.run !== run) return;
    const player = mod.createAudioPlayer({ uri });
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && active && active.run === run) stopSpeech();
    });
    active = { id, state: 'playing', player, run };
    player.play();
    notify();
  } catch (error) {
    if (active && active.run === run) stopSpeech();
    throw error;
  }
}

/** The reply's speech state, live. */
export function useSpeechState(id: number): SpeechState {
  const [state, setState] = useState<SpeechState>(() => stateOf(id));
  useEffect(() => {
    const listener = () => setState(stateOf(id));
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, [id]);
  return state;
}
