"use client";

import { useEffect } from "react";

/** Registers public/sw.js in production builds only, so dev never serves cached chunks. */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {}); // the app works without it
  }, []);
  return null;
}
