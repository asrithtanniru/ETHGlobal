"use client";

import { useParams } from "next/navigation";
import { RequireWallet } from "@/components/app/AppShell";
import { ChatView } from "@/components/app/Chat";
import { THREAD_ID } from "@/lib/chatSign";

export default function ChatThread() {
  const { id } = useParams<{ id: string }>();
  if (!THREAD_ID.test(id)) return <p className="chat__empty" style={{ padding: "4rem" }}>That conversation link isn&apos;t valid.</p>;
  return <RequireWallet>{(a) => <ChatView key={id} address={a} id={id} />}</RequireWallet>;
}
