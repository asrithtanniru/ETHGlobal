"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ReceiptPrinter, type ReceiptPrinterStage } from "@/components/ReceiptPrinter";
import { Logo } from "@/components/ui";
import { playPrintSound } from "@/lib/printSound";

type Props = {
  heading: string;
  lede: string;
  /** Top line of the printer's screen. */
  title: string;
  detail: string;
  amount?: string;
  reference?: string;
  /** The printed slip. Without it (the route's loading state) the printer stays on "processing". */
  children?: ReactNode;
};

export function PrintedReceipt({ heading, lede, title, detail, amount, reference, children }: Props) {
  const [stage, setStage] = useState<ReceiptPrinterStage>("processing");
  const ready = Boolean(children);

  // Start after hydration, or a slow device could miss the feed's animationend. Reduced motion has no animation to end.
  useEffect(() => {
    if (!ready) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setStage("complete");
    setStage("printing");
    return playPrintSound();
  }, [ready]);

  return (
    <>
      <section className="band band--rule">
        <div className="frame" style={{ padding: "2.4rem var(--pad)" }}><Logo /></div>
      </section>
      <section className="band band--rule">
        <div className="frame page-head">
          <p className="eyebrow">Receipt</p>
          <h1 className="display-s">{heading}</h1>
          <p className="body-l">{lede}</p>
        </div>
      </section>
      <section className="band band--rule">
        <div className="frame panel">
          <ReceiptPrinter.Root stage={stage}>
            <ReceiptPrinter.Machine>
              <ReceiptPrinter.Header>
                <Logo />
                <span className="mono">{reference}</span>
              </ReceiptPrinter.Header>
              <ReceiptPrinter.Screen>
                <div className="printer__bill">
                  <div>
                    <p>{title}</p>
                    <p className="printer__detail">{detail}</p>
                  </div>
                  <strong>{amount}</strong>
                </div>
                <ReceiptPrinter.Status />
              </ReceiptPrinter.Screen>
            </ReceiptPrinter.Machine>
            <ReceiptPrinter.Output onPrinted={() => setStage("complete")}>
              <ReceiptPrinter.Paper>{children}</ReceiptPrinter.Paper>
            </ReceiptPrinter.Output>
          </ReceiptPrinter.Root>
        </div>
      </section>
    </>
  );
}
