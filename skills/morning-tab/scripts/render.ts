// Вёрстка: bun <skill>/scripts/render.ts --config <рабочая папка>/config.json --out <рабочая папка>/out [--no-shot]
// Читает out/items.json + out/texts.json, пишет out/site/index.html и скриншоты.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_LABELS, loadConfig, type Items, type OutItem, type TextItem, type Texts } from "./config.ts";

const { cfg, out: OUT } = loadConfig();
const L = { ...DEFAULT_LABELS, ...cfg.labels };
const data = JSON.parse(readFileSync(join(OUT, "items.json"), "utf8")) as Items;
const tx = JSON.parse(readFileSync(join(OUT, "texts.json"), "utf8")) as Texts;

// ---- проверка: падаем громко, если агент что-то не дописал
const txMap = new Map(tx.items.map((r) => [r.id, r]));
const missing = data.items.filter((i) => { const r = txMap.get(i.id); return !r || !r.title.trim() || !r.summary.trim(); }).map((i) => `${i.id} (${i.source}: ${i.title.slice(0, 60)})`);
const errs: string[] = [];
if (missing.length) errs.push(`Нет title/summary для ${missing.length} id:\n  ${missing.join("\n  ")}`);
const ids = new Set(data.items.map((i) => i.id));
if (tx.digest.length < 3 || tx.digest.length > 5) errs.push(`digest: нужно 3–5 пунктов, сейчас ${tx.digest.length}`);
const badDigest = tx.digest.filter((d) => !ids.has(d.id) || !d.text.trim());
if (badDigest.length) errs.push(`digest: неизвестный id или пустой text: ${badDigest.map((d) => d.id).join(", ")}`);
if (!tx.lead_paragraph.trim()) errs.push("lead_paragraph пуст");
if (errs.length) { console.error(`texts.json не прошёл проверку:\n${errs.join("\n")}`); process.exit(1); }

const T = (i: OutItem): TextItem => txMap.get(i.id) as TextItem;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tz = cfg.timezone;
const d0 = new Date(data.generatedAt);
const wd = new Intl.DateTimeFormat(cfg.locale, { timeZone: tz, weekday: "long" }).format(d0);
const dm = new Intl.DateTimeFormat(cfg.locale, { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(d0);
const dateStr = `${wd[0]?.toUpperCase() ?? ""}${wd.slice(1)}, ${dm}`;
const hm = new Intl.DateTimeFormat(cfg.locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d0);
const issueNo = Math.floor((+d0 - +new Date(`${d0.getUTCFullYear()}-01-01`)) / 86400e3) + 1;
const w = data.weather;
const city = cfg.city?.name ?? "";
const weather = w.temp !== null ? `${city}: ${Math.round(w.temp)}°${w.max !== null ? `, ${L.dayUpTo} ${Math.round(w.max)}°` : ""}` : city;

const secTitle = new Map(cfg.sections.map((s) => [s.id, s.title]));
const kick = (i: OutItem): string => esc(secTitle.get(i.section) ?? i.source).toUpperCase();
const age = (h: number | null): string => h === null ? "" : h < 1 ? "<1h" : h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
const by = (i: OutItem): string => [`${L.via} ${i.source}`, i.points !== null ? `${i.points} ${L.points}` : "",
  i.comments !== null ? `${i.comments} ${L.comments}` : "", i.extra, age(i.ageHours)].filter(Boolean).join(" · ").toUpperCase();
const A = (i: OutItem, inner: string): string => `<a href="${esc(i.url)}" target="_blank" rel="noopener">${inner}</a>`;
const disc = (i: OutItem): string => i.discussUrl ? ` · <a class="cm" href="${esc(i.discussUrl)}" target="_blank" rel="noopener">${esc(L.discuss)}</a>` : "";
const IMG = (i: OutItem, cls: string): string => i.image ? `<a class="${cls}" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></a>` : "";
const byId = new Map(data.items.map((i) => [i.id, i]));
const lead = data.leadId ? byId.get(data.leadId) : undefined;
const second = data.secondId ? byId.get(data.secondId) : undefined;
const used = new Set([lead?.id, second?.id]);
const briefs = data.items.filter((i) => !used.has(i.id)).slice(0, 4);
briefs.forEach((i) => used.add(i.id));

const leadHtml = lead ? (() => { const t = T(lead).title; return `<article class="lead">${IMG(lead, "fig big")}<div class="kick">${kick(lead)}</div>
<h2 style="font-size:${t.length > 90 ? 32 : t.length > 60 ? 37 : 42}px">${A(lead, esc(t))}</h2><p class="body drop">${esc(tx.lead_paragraph)}</p><div class="by">${esc(by(lead))}${disc(lead)}</div></article>`; })() : "";
const secondHtml = second ? `<article class="second">${IMG(second, "fig mid")}<div class="kick">${kick(second)}</div><h3>${A(second, esc(T(second).title))}</h3>
<p class="body">${esc(T(second).summary)}</p><div class="by">${esc(by(second))}${disc(second)}</div></article>` : "";
const brief = (i: OutItem): string => `<div class="brief">${IMG(i, "thumb")}<h4>${A(i, esc(T(i).title))}</h4><div class="by">${esc(by(i))}${disc(i)}</div></div>`;
const digest = tx.digest.map((d, n) => { const i = byId.get(d.id) as OutItem; return `<li><span class="n">${n + 1}</span><div>${A(i, esc(T(i).title))}<small>${esc(d.text)}</small></div></li>`; }).join("");
const counts = cfg.sections.map((s) => [s.title, data.items.filter((i) => i.section === s.id).length] as const).filter(([, c]) => c > 0);
const sections = cfg.sections.map((sec) => {
  const its = data.items.filter((i) => i.section === sec.id && !used.has(i.id));
  if (!its.length) return "";
  return `<section class="desk"><div class="deskhead"><span>${esc(sec.title)}</span><i>${its.length}</i></div>${its.map((i) => `<div class="story">${IMG(i, "thumb")}
<div class="kick">${kick(i)}</div><h5>${A(i, esc(T(i).title))}</h5><p>${esc(T(i).summary)}</p><div class="by">${esc(by(i))}${disc(i)}</div></div>`).join("")}</section>`;
}).join("");

const cssPath = resolve(import.meta.dir, "..", "templates", "style.css");
const css = readFileSync(cssPath, "utf8");
const html = `<!doctype html><html lang="${esc(cfg.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.title)} · ${esc(dm)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;0,800;1,400&family=PT+Serif:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body><div class="w">
<div class="top"><span>${esc(L.volume)} ${issueNo}</span><span>${esc(cfg.topline)}</span></div>
<div class="mast"><h1>${esc(cfg.title)}</h1></div>
<div class="tag">${esc(cfg.tagline)}</div>
<div class="date"><span>${esc(dateStr)}</span><span>${esc(L.edition)} · ${hm}</span>${weather ? `<span>${esc(L.weather)}: ${esc(weather)}</span>` : ""}</div>
<div class="front"><div>${leadHtml}</div><div>${secondHtml}${briefs.map(brief).join("")}</div>
<aside class="side"><div class="boxx"><h6>${esc(L.digest)}</h6><ol>${digest}</ol></div>
<div class="boxx"><h6>${esc(L.almanac)}</h6>${cfg.city ? `<div class="row"><span>${esc(L.sunrise)}</span><b>${w.sunrise}</b></div><div class="row"><span>${esc(L.sunset)}</span><b>${w.sunset}</b></div>` : ""}
${counts.map(([t, c]) => `<div class="row"><span>${esc(t)}</span><b>${c}</b></div>`).join("")}</div></aside></div>
<div class="desks">${sections}</div>
<footer>${esc(L.footer)}: ${esc(data.status.join(" · "))}</footer>
</div></body></html>`;
const SITE = join(OUT, "site");
mkdirSync(SITE, { recursive: true });
writeFileSync(join(SITE, "index.html"), html);
console.log(`OK: ${SITE}/index.html (${html.length} байт, ${data.items.length} материалов)`);

if (!process.argv.includes("--no-shot")) {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`file://${join(SITE, "index.html")}`, { waitUntil: "load", timeout: 60000 });
    await p.evaluate(async () => { for (const im of Array.from(document.images)) im.loading = "eager"; await document.fonts.ready; await new Promise((r) => setTimeout(r, 4000)); });
    await p.screenshot({ path: join(OUT, "screenshot-top.png") });
    await p.screenshot({ path: join(OUT, "screenshot.png"), fullPage: true });
    await b.close();
    console.log(`OK: ${OUT}/screenshot-top.png, screenshot.png`);
  } catch (e) {
    // Без скриншота проверить страницу нельзя, поэтому код выхода 1.
    console.error(`Скриншот не снят (${e instanceof Error ? e.message.split("\n")[0] : String(e)}). Установите браузер: bunx playwright install chromium`);
    process.exit(1);
  }
}
