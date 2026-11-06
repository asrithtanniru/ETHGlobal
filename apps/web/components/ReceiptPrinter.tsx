"use client";

import { createContext, useContext, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Icon } from "@/components/ui";

export type ReceiptPrinterStage = "processing" | "printing" | "complete";

const StageContext = createContext<ReceiptPrinterStage>("processing");

const statusLabels: Record<ReceiptPrinterStage, string> = {
  processing: "Finding your receipt",
  printing: "Printing your receipt",
  complete: "Receipt printed",
};

const toothCount = 40;
const toothDepth = 4;
const toothPoints = Array.from({ length: toothCount * 2 }, (_, i) => {
  const x = 100 - ((i + 1) * 100) / (toothCount * 2);
  return `${x}% ${i % 2 === 0 ? "100%" : `calc(100% - ${toothDepth}px)`}`;
}).join(", ");
const paperClipPath = `polygon(0 0, 100% 0, 100% calc(100% - ${toothDepth}px), ${toothPoints})`;

function Root({ stage, children }: { stage: ReceiptPrinterStage; children: ReactNode }) {
  return (
    <StageContext.Provider value={stage}>
      <section aria-label="Receipt printer" className="printer" data-stage={stage}>{children}</section>
    </StageContext.Provider>
  );
}

function Machine({ children }: { children: ReactNode }) {
  return (
    <div className="printer__machine">
      {children}
      <div aria-hidden="true" className="printer__slot" />
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <div className="printer__header">{children}</div>;
}

function Screen({ children }: { children: ReactNode }) {
  return <div className="printer__screen">{children}</div>;
}

function Status() {
  const stage = useContext(StageContext);
  return (
    <div className="printer__status">
      {stage === "complete" ? <Icon.signed className="printer__done" /> : <span aria-hidden="true" className="printer__spinner" />}
      <div aria-live="polite" role="status">
        <span className="printer__label" key={stage}>{statusLabels[stage]}</span>
      </div>
    </div>
  );
}

function Output({ children, onPrinted }: { children: ReactNode; onPrinted: () => void }) {
  const stage = useContext(StageContext);
  return (
    <div className="printer__output">
      <div className="printer__feed" inert={stage !== "complete"} onAnimationEnd={onPrinted}>{children}</div>
    </div>
  );
}

function Paper({ children, ...props }: ComponentPropsWithoutRef<"article">) {
  return <article className="printer__paper" style={{ clipPath: paperClipPath }} {...props}>{children}</article>;
}

export const ReceiptPrinter = { Header, Machine, Output, Paper, Root, Screen, Status };
