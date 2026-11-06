"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Address } from "viem";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { chatApi, useChatSession, type ThreadRow } from "./chatSession";

const DAY = 86_400_000;
function group(at: number, now: number) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (at >= today) return "Today";
  if (at >= today - DAY) return "Yesterday";
  if (at >= today - 7 * DAY) return "Previous 7 days";
  return "Older";
}

/** Sidebar list of the sender's conversations, read back from Arkiv. */
export function ChatHistory() {
  const { address } = useConnection();
  return address ? <History address={address} /> : null;
}

function History({ address }: { address: Address }) {
  const path = usePathname();
  const s = useChatSession(address);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["chats", address],
    enabled: !!s.header,
    queryFn: async () => {
      const rows = (await chatApi<{ threads: ThreadRow[] }>("/api/chat", s.header!, s.clear)).threads;
      // A conversation started in the last few minutes may not have reached Arkiv yet: keep it listed.
      const fresh = (qc.getQueryData<ThreadRow[]>(["chats", address]) ?? []).filter((t) => Date.now() - t.at < 5 * 60_000 && !rows.some((r) => r.thread === t.thread));
      return [...fresh, ...rows];
    },
  });
  const now = Date.now();
  const groups = new Map<string, ThreadRow[]>();
  for (const t of q.data ?? []) groups.set(group(t.at, now), [...(groups.get(group(t.at, now)) ?? []), t]);

  return (
    <nav className="hist" aria-label="Chats">
      {!s.header ? (
        <>
          <p className="hist__h">Chats</p>
          <button className="hist__unlock" onClick={() => s.ensure().catch(() => undefined)}>Sign in to see your chats</button>
        </>
      ) : q.isLoading ? (
        <><p className="hist__h">Chats</p>{[0, 1, 2].map((i) => <span key={i} className="hist__skel" style={{ width: `${70 - i * 15}%` }} />)}</>
      ) : q.error ? (
        <><p className="hist__h">Chats</p><p className="hist__note">{(q.error as Error).message}</p></>
      ) : groups.size === 0 ? (
        <><p className="hist__h">Chats</p><p className="hist__note">Your conversations are kept on Arkiv, encrypted. They show up here.</p></>
      ) : (
        [...groups].map(([label, rows]) => (
          <div key={label}>
            <p className="hist__h">{label}</p>
            {rows.map((t) => (
              <Link key={t.thread} href={`/app/chat/${t.thread}`} title={t.title} aria-current={path === `/app/chat/${t.thread}` ? "page" : undefined}>{t.title}</Link>
            ))}
          </div>
        ))
      )}
    </nav>
  );
}
