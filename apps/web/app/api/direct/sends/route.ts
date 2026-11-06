import { sessionFrom } from "@/lib/assistant";
import { sendsOf } from "@/lib/directSend";
import { json } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/** The signed-in sender's Direct sends, with live status and their share links. */
export async function GET(req: Request) {
  const sender = await sessionFrom(req);
  if (!sender) return json({ error: "Sign in with your wallet first." }, 401);
  try {
    return json({ sends: await sendsOf(sender, new URL(req.url).origin) });
  } catch {
    return json({ error: "Couldn't read your sends right now." }, 502);
  }
}
