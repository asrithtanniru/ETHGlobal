import Link from "next/link";
import type { ReactNode, SVGProps } from "react";

export const REPO = "https://github.com/asrithtanniru/ETHGlobal";
export const DOCS = `${REPO}#readme`;
export const VAULT_EXPLORER = "https://explorer.testnet.whitechain.io/address/0xA855E5b5152F7C7c824dc5c8EF034696a65587Ae";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" prefetch={false} className={`logo ${className}`} aria-label="Ghar home">
      <svg className="logo__mark" viewBox="0 0 31 31" aria-hidden="true">
        <path fillRule="evenodd" d="M0 0h31v31H0zM9.5 9.5v12h12v-12z" fill="currentColor" />
      </svg>
      <span className="logo__word">Ghar</span>
    </Link>
  );
}

/** Headline lines: one block per line on desktop (as composed in the recording), flowing text with real spaces on small screens. */
export function Lines({ children }: { children: string[] }) {
  return (
    <>
      {children.map((l, i) => (
        <span key={i} className="ln">{l}{i < children.length - 1 ? " " : ""}</span>
      ))}
    </>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a className="link" href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}

type IconProps = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

// Thin line icons in the reference's stroke weight (shapes follow Lucide, MIT).
export const Icon = {
  grant: (p: IconProps) => (
    <svg {...base} {...p}><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 8.65-8.65M18 5l2 2M15 8l2 2" /></svg>
  ),
  reclaim: (p: IconProps) => (
    <svg {...base} {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
  ),
  signed: (p: IconProps) => (
    <svg {...base} {...p}><path d="M12 3l2.4 1.6 2.9-.2 1 2.7 2.3 1.8-.9 2.7.9 2.8-2.3 1.7-1 2.7-2.9-.2L12 21l-2.4-1.6-2.9.2-1-2.7-2.3-1.7.9-2.8-.9-2.7 2.3-1.8 1-2.7 2.9.2z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  payee: (p: IconProps) => (
    <svg {...base} {...p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /><circle cx="12" cy="9" r="2.5" /><path d="M8.5 15a3.5 3.5 0 0 1 7 0" /></svg>
  ),
  cap: (p: IconProps) => (
    <svg {...base} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  nominee: (p: IconProps) => (
    <svg {...base} {...p}><circle cx="10" cy="8" r="4" /><path d="M2 21a8 8 0 0 1 12.5-6.6M16 19l2 2 4-4" /></svg>
  ),
  receipt: (p: IconProps) => (
    <svg {...base} {...p}><path d="M5 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
  ),
};
