"use client";

// Motion contract: docs/design-reconstruction/MOTION_SPEC.md. Reveals play once, nothing is scrubbed.
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText);

const STICKY_AT = 1100; // M9: compact header shows past this scrollY (measured 4.28 s / 1184 px)

export function Motion() {
  useEffect(() => {
    const root = document.documentElement;
    // M9: compact header; plain scroll listener so it also works with reduced motion (CSS drops the slide).
    const sticky = document.querySelector<HTMLElement>("[data-sticky]");
    const onScroll = () => {
      const on = window.scrollY > STICKY_AT;
      if (sticky && sticky.classList.contains("is-on") !== on) { sticky.classList.toggle("is-on", on); sticky.inert = !on; }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    // Mobile menu is a <details>: close it on a link tap or a tap outside, otherwise it covers the section it opened.
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      document.querySelectorAll<HTMLDetailsElement>("details.menu-btn[open]").forEach((d) => {
        if (!d.contains(t) || t.closest(".mobile-menu a")) d.open = false;
      });
    };
    document.addEventListener("click", onClick);
    const unlisten = () => { window.removeEventListener("scroll", onScroll); document.removeEventListener("click", onClick); };
    if (!root.classList.contains("js")) return unlisten; // reduced motion: everything renders final

    const lenis = new Lenis({ lerp: 0.13, anchors: { offset: -72 } });
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const q = <T extends Element = HTMLElement>(s: string) => Array.from(document.querySelectorAll<T & HTMLElement>(s));
    const delay = (el: HTMLElement) => Number(el.dataset.delay ?? 0);
    // Reveals key off their section entering at ~60% of the viewport (measured 45-55% in the recording), so a
    // section's parts play in order; parts far below the section top use their own position instead.
    // clamp() keeps late-page triggers reachable when the page ends before the start line (mobile footer).
    const once = (el: Element, start = "top 60%") => {
      const band = el.closest("section, footer");
      const far = band ? el.getBoundingClientRect().top - band.getBoundingClientRect().top > 700 : true;
      return { trigger: far || !band ? el : band, start: `clamp(${far ? "top 85%" : start})`, once: true };
    };
    let ctx: gsap.Context | undefined;
    let dead = false;

    document.fonts.ready.then(() => {
      if (dead) return;
      ctx = gsap.context(() => {
        // ----- load sequence M1-M8 -----
        const tl = gsap.timeline();
        const h1 = document.querySelector<HTMLElement>('[data-lines="load"]');
        if (h1) {
          const split = SplitText.create(h1, { type: "lines", mask: "lines", aria: "none" });
          gsap.set(h1, { visibility: "visible" });
          tl.from(split.lines, { yPercent: 100, duration: 0.55, stagger: 0.17, ease: "power3.out" }, 0.37);
        }
        tl.call(() => root.classList.add("go"), [], 0) // starts the CSS grid-line draw on this clock (M1)
          .to(".hero__art", { scale: 1, duration: 1.65, ease: "none" }, 0.2)
          .fromTo('[data-load="logo"]', { opacity: 1, clipPath: "inset(50% 0 50% 0)" }, { clipPath: "inset(0% 0 0% 0)", duration: 0.3, ease: "power3.out" }, 0.63)
          .to('[data-load="nav"]', { opacity: 1, duration: 0.35, stagger: 0.08, ease: "power1.out" }, 0.5)
          .to('[data-load="demo"]', { opacity: 1, duration: 0.4, ease: "power1.out" }, 1.0)
          .to('[data-load="lede"]', { opacity: 1, duration: 0.4, ease: "power1.out" }, 1.0)
          .to('[data-load="cta"]', { opacity: 1, duration: 0.4, stagger: 0.1, ease: "power1.out" }, 1.0);

        // ----- M10 headline line masks -----
        q("[data-lines]:not([data-lines='load'])").forEach((el) => {
          SplitText.create(el, {
            type: "lines",
            mask: "lines",
            aria: "none",
            autoSplit: true,
            onSplit(self) {
              gsap.set(el, { visibility: "visible" });
              return gsap.from(self.lines, { yPercent: 100, duration: 0.6, delay: 0.05 + delay(el), stagger: 0.12, ease: "power3.out", scrollTrigger: once(el) });
            },
          });
        });

        // ----- M11/M12/M14-M19 fades -----
        q("[data-fade]").forEach((el) =>
          gsap.to(el, {
            opacity: 1, duration: 0.5, delay: delay(el), ease: "power1.out", scrollTrigger: once(el, el.closest("footer") ? "top 85%" : "top 60%"),
            onStart: () => el.classList.add("is-in"),
          }),
        );

        // ----- M13 top-down wipe on engravings -----
        q("[data-wipe]").forEach((el) =>
          gsap.to(el, {
            "--p": "106%", duration: el.classList.contains("foot__range") ? 1.1 : 0.9, delay: delay(el),
            ease: "power2.inOut", scrollTrigger: el.classList.contains("foot__range") ? { trigger: el, start: "clamp(top 55%)", once: true } : once(el),
          }),
        );

        // ----- M25 counters -----
        q("[data-count]").forEach((el) => {
          const end = Number(el.dataset.count);
          const v = { n: 0 };
          el.textContent = "0";
          gsap.to(v, {
            n: end, duration: 0.9, delay: 0.3, ease: "power2.out", scrollTrigger: once(el),
            onUpdate: () => { el.textContent = String(Math.round(v.n)); },
          });
        });

        // ----- M20 footer logo -----
        const fl = document.querySelector("[data-footlogo]");
        if (fl) {
          const tl2 = gsap.timeline({ scrollTrigger: once(fl, "top 85%") });
          tl2.from(fl.querySelector(".logo__mark"), { scale: 0.5, rotation: -15, opacity: 0, transformOrigin: "50% 50%", duration: 0.45, ease: "power3.out" })
            .from(fl.querySelector(".logo__word"), { yPercent: 60, clipPath: "inset(0 0 100% 0)", duration: 0.6, ease: "power3.out" }, 0.1)
            .from(fl.querySelectorAll("p"), { opacity: 0, duration: 0.5, stagger: 0.08, ease: "power1.out" }, 0.2);
        }
      });
      ScrollTrigger.refresh();
    });

    return () => {
      dead = true;
      unlisten();
      ctx?.revert();
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);
  return null;
}
