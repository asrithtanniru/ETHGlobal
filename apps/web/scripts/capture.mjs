// Captures the landing page at the reference viewport (1722 x 1080) for comparison with frames
// extracted from the design recording. Each section is scrolled so its top rule sits where it
// sits in the matching reference frame. Usage:
//   node scripts/capture.mjs [baseUrl] [outDir]
// Needs the dev or prod server running and Google Chrome installed (uses channel "chrome").
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "capture";
mkdirSync(out, { recursive: true });

// [name, selector of section whose top we align, its top y in the reference frame]
const CHECKPOINTS = [
  ["00_hero", null, 0],
  ["01_problem", "main > section:nth-of-type(3)", 360],
  ["02_how-it-works", "#how", 91],
  ["03_platform", "#vault", 69],
  ["04_solutions", "#bills", 152],
  ["05_security", "#guarantees", 74],
  ["06_customers", "#networks", 214],
  ["07_cta", "main > section:last-of-type", 278],
  ["08_footer", "footer", 124],
  ["09_footer-range", "max", 0],
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1722, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// Load sequence: screenshots at fixed times after navigation start.
await page.goto(base, { waitUntil: "commit" });
const t0 = Date.now();
for (const t of [250, 500, 900, 1200, 1800, 2600]) {
  await page.waitForTimeout(Math.max(0, t - (Date.now() - t0)));
  await page.screenshot({ path: `${out}/load_${t}ms.png` });
}

const scrollTo = async (y) => {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(200);
};

const pageTop = (sel) =>
  page.evaluate((sel) => {
    if (sel === "max") return document.documentElement.scrollHeight - innerHeight;
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().top + scrollY : 0;
  }, sel);

// Walk down the page like the recording so every once-only reveal fires, then shoot each state.
for (const [name, sel, refTop] of CHECKPOINTS) {
  const y = sel ? Math.max(0, Math.round((await pageTop(sel)) - (sel === "max" ? 0 : refTop))) : 0;
  await scrollTo(y);
  await page.waitForTimeout(2200);
  const actual = await page.evaluate(() => scrollY);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name} scrollY=${actual}`);
}

// Motion samples: section enter sequences at ~10 fps right after scrolling into place.
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
for (const [name, sel, refTop] of [["how", "#how", 91], ["guarantees", "#guarantees", 74], ["footer", "max", 0]]) {
  const y = Math.round((await pageTop(sel)) - refTop);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  const s0 = Date.now();
  for (let i = 0; i < 14; i++) {
    await page.screenshot({ path: `${out}/seq_${name}_${String(i).padStart(2, "0")}_${Date.now() - s0}ms.png` });
    await page.waitForTimeout(60);
  }
}

// Responsive and app-screen captures (full page). The recording only shows 1722 px wide.
for (const [w, h] of [[1440, 900], [1280, 800], [768, 1024], [390, 844], [360, 780]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  for (const route of ["/", "/app", "/app/payees", "/app/activity", "/app/nominee", "/app/agent"]) {
    if (w !== 1440 && w !== 390 && route !== "/") continue;
    await p.goto(base + route, { waitUntil: "networkidle" });
    // walk the page so once-only reveals fire before the full-page shot
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += h / 2) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(120); }
    await p.waitForTimeout(1200);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await p.screenshot({ path: `${out}/resp_${w}${route.replaceAll("/", "_") || "_"}.png`, fullPage: true });
    console.log(`resp ${w}x${h} ${route} horizontal overflow ${overflow}px`);
  }
  await p.close();
}

console.log("section heights", await page.evaluate(() => [...document.querySelectorAll("header.band, main > section, footer")].map((e) => `${e.id || e.className.split(" ").pop()}:${Math.round(e.getBoundingClientRect().height)}`).join(" ")));
console.log(`doc height ${await page.evaluate(() => document.documentElement.scrollHeight)}`);
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "console errors: none");
await browser.close();
