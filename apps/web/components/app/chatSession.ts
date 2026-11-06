"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { useSignMessage } from "wagmi";
import { SESSION_DAYS, sessionMessage } from "@/lib/chatSign";

const keyFor = (a: Address) => `ghar.chat.${a.toLowerCase()}`;
const EVENT = "ghar:session";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVENT, cb); };
};
const readRaw = (a: Address) => { try { return localStorage.getItem(keyFor(a)); } catch { return null; } };
const write = (a: Address, value: string | null) => {
  try { if (value) localStorage.setItem(keyFor(a), value); else localStorage.removeItem(keyFor(a)); } catch { /* storage blocked: sign again next time */ }
  window.dispatchEvent(new Event(EVENT));
};

/**
 * The chat API's sign-in: one free wallet signature, bound to this site and valid for a week.
 * Only the signed header is kept in the browser; it reads chats, it can't move funds.
 */
export function useChatSession(address: Address) {
  const raw = useSyncExternalStore(subscribe, () => readRaw(address), () => null);
  const { mutateAsync: sign } = useSignMessage();
  let header: string | undefined;
  try {
    const s = raw ? (JSON.parse(raw) as { header: string; expires: string }) : undefined;
    if (s && Date.parse(s.expires) > Date.now() + 60_000) header = s.header;
  } catch { /* corrupt entry: sign again */ }

  const ensure = useCallback(async () => {
    if (header) return header;
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    const message = sessionMessage(address, window.location.host, expires);
    const signature = await sign({ message });
    const h = btoa(JSON.stringify({ message, signature }));
    write(address, JSON.stringify({ header: h, expires: expires.toISOString() }));
    return h;
  }, [header, address, sign]);

  return { header, ensure, clear: () => write(address, null) };
}

/** GET a chat API path with the session header; a 401 drops the stale session. */
export async function chatApi<T>(path: string, header: string, clear: () => void): Promise<T> {
  const r = await fetch(path, { headers: { "x-ghar-session": header }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) clear();
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong.");
  return j as T;
}

export type ThreadRow = { thread: string; title: string; at: number };
