"use client";

import { RequireWallet } from "@/components/app/AppShell";
import { ChatView } from "@/components/app/Chat";

export default function ChatHome() {
  return <RequireWallet>{(a) => <ChatView address={a} />}</RequireWallet>;
}
