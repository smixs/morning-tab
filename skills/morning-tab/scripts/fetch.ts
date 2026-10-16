// Сбор: bun <skill>/scripts/fetch.ts --config <рабочая папка>/config.json --out <рабочая папка>/out
// -> out/items.json + out/texts.template.json (никакого машинного перевода: тексты пишет агент).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type OutItem, type Source, type Weather } from "./config.ts";

interface Item { source: string; section: string; title: string; url: string; date: Date | null; summary: string; points: number | null; comments: number | null; discussUrl: string; extra: string; image: string; boost: number }

const { cfg, out: OUT } = loadConfig();
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36";

const decode = (s: string): string =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
   .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
   .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
   .replace(/&amp;/g, "&");
const strip = (s: string): string => decode(decode(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (block: string, name: string): string => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function feedImage(b: string): string {
  const m = b.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i)?.[1]
    ?? b.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i)?.[1]
    ?? b.match(/<enclosure[^>]*url="([^"]+\.(?:jpe?g|png|webp|gif)[^"]*)"/i)?.[1]
    ?? decode(b).match(/<img[^>]*src="(https?:[^"]+)"/i)?.[1] ?? "";
  return decode(m);
}

const CACHE_FILE = join(OUT, "og-cache.json");
async function ogImage(url: string, cache: Record<string, string>): Promise<string> {
  if (url in cache && `d:${url}` in cache) return cache[url] ?? "";
  let img = "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000), redirect: "follow" });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("html")) {
      const h = (await r.text()).slice(0, 300000);
      const raw = h.match(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i)?.[1]
        ?? h.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i)?.[1] ?? "";
      if (raw) img = new URL(decode(raw), r.url).href;
      const ds = h.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*content=["']([^"']+)["']/i)?.[1]
        ?? h.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:description|description)["']/i)?.[1] ?? "";
      cache[`d:${url}`] = strip(ds).slice(0, 1500);
    }
  } catch { /* картинка не обязательна */ }
  cache[url] = img;
  cache[`d:${url}`] ??= "";
  return img;
}
async function pool<T>(xs: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const x = xs[i++]; if (x !== undefined) await f(x); } }));
}

// RSS/Atom: подходит для блогов, СМИ, arXiv (rss.arxiv.org/rss/cs.AI), Google News RSS, hnrss.
function parseFeed(xml: string, src: Source): Item[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b): Item => {
    let link = strip(tag(b, "link"));
    if (!link) link = b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ?? b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const ds = strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const d = ds ? new Date(ds) : null;
    const desc = strip(tag(b, "description") || tag(b, "summary") || tag(b, "content"));
    const isHn = src.type === "hn";
    const pts = isHn ? desc.match(/Points:\s*(\d+)/)?.[1] : undefined;
    const cm = isHn ? desc.match(/# Comments:\s*(\d+)/)?.[1] : undefined;
    return { source: src.name, section: src.section, title: strip(tag(b, "title")), url: decode(link).trim(), date: d && !isNaN(+d) ? d : null,
      summary: isHn ? "" : desc.slice(0, 1500), points: pts ? Number(pts) : null, comments: cm ? Number(cm) : null,
      discussUrl: isHn ? (desc.match(/Comments URL:\s*(\S+)/)?.[1] ?? "") : "", extra: "", image: feedImage(b), boost: src.boost ?? 0 };
  }).filter((i) => i.title && i.url);
}

function parseTrending(html: string, src: Source): Item[] {
  return (html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) ?? []).map((a): Item => {
    const repo = (a.match(/<h2[\s\S]*?href="\/([^"]+)"/)?.[1] ?? "").trim();
    const lang = strip(a.match(/itemprop="programmingLanguage">([^<]*)</)?.[1] ?? "");
    const today = strip(a.match(/([\d,]+) stars today/)?.[1] ?? "");
    return { source: src.name, section: src.section, title: repo, url: `https://github.com/${repo}`, date: null,
      summary: strip(a.match(/<p class="[^"]*">([\s\S]*?)<\/p>/)?.[1] ?? ""), points: null, comments: null, discussUrl: "",
      extra: [lang, today ? `+${today} ★` : ""].filter(Boolean).join(" · "), image: `https://opengraph.githubassets.com/1/${repo}`, boost: src.boost ?? 0 };
  }).filter((i) => i.title);
}

async function bodyText(url: string): Promise<string> {
  try {
    const h = await get(url);
    const scope = h.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? h.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? h;
    const ps = (scope.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, "").match(/<p[\s>][\s\S]*?<\/p>/gi) ?? []).map(strip).filter((t) => t.length > 40);
    return ps.join("\n\n").slice(0, 4000);
  } catch { return ""; }
}

async function main(): Promise<void> {
  const now = Date.now();
  const status: string[] = [];
  const results = await Promise.all(cfg.sources.map(async (s): Promise<Item[]> => {
    try {
      const body = await get(s.url);
      let items = s.type === "github-trending" ? parseTrending(body, s) : parseFeed(body, s);
      const win = (s.windowHours ?? cfg.windowHours) * 3600e3;
      items = items.filter((i) => !i.date || now - +i.date <= win).slice(0, s.limit);
      status.push(`${s.name}: ${items.length}${items.length ? "" : " — ПУСТО"}`);
      return items;
    } catch (e) { status.push(`${s.name}: ошибка (${e instanceof Error ? e.message : String(e)})`); return []; }
  }));
  const seen = new Set<string>();
  const all = results.flat().filter((i) => {
    const k = i.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (seen.has(i.url) || seen.has(k)) return false; seen.add(i.url); seen.add(k); return true;
  });

  mkdirSync(OUT, { recursive: true });
  let cache: Record<string, string> = {};
  try { cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, string>; } catch { /* пусто */ }
  await pool(all, 12, async (i) => {
    const og = await ogImage(i.url, cache);
    if (!i.image) i.image = og;
    const d = cache[`d:${i.url}`] ?? "";
    if (d.length > i.summary.length && !/^(points|article url)/i.test(d)) i.summary = d;
  });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));

  const kw = cfg.keywords.length ? new RegExp(`(${cfg.keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "iu") : null;
  const score = (i: Item): number => {
    let s = i.boost;
    if (kw?.test(`${i.title} ${i.summary.slice(0, 300)}`)) s += 30;
    s += Math.min((i.points ?? 0) / 10, 60);
    if (i.image) s += 5;
    if (i.date) s += Math.max(0, 24 - (now - +i.date) / 3600e3);
    return Math.round(s);
  };
  const out: OutItem[] = all.map((i) => ({ id: Bun.hash(i.url).toString(36).slice(0, 8), source: i.source, section: i.section, url: i.url,
    discussUrl: i.discussUrl, points: i.points, comments: i.comments, ageHours: i.date ? Math.round((now - +i.date) / 3600e3) : null,
    image: i.image, title: i.title, summary: i.summary, extra: i.extra, score: score(i) })).sort((a, b) => b.score - a.score);
  const [l0, l1] = out;
  for (const t of [l0, l1]) if (t) t.body = await bodyText(t.url);

  interface Meteo { current?: { temperature_2m?: number }; daily?: { sunrise?: string[]; sunset?: string[]; temperature_2m_max?: number[] } }
  const weather: Weather = { temp: null, max: null, sunrise: "—", sunset: "—" };
  if (cfg.city) {
    try { // Open-Meteo: бесплатно, без ключа
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.city.lat}&longitude=${cfg.city.lon}&current=temperature_2m&daily=sunrise,sunset,temperature_2m_max&timezone=${encodeURIComponent(cfg.timezone)}&forecast_days=1`;
      const w = JSON.parse(await get(u)) as Meteo;
      weather.temp = w.current?.temperature_2m ?? null; weather.max = w.daily?.temperature_2m_max?.[0] ?? null;
      weather.sunrise = w.daily?.sunrise?.[0]?.slice(11) ?? "—"; weather.sunset = w.daily?.sunset?.[0]?.slice(11) ?? "—";
    } catch { /* погода не обязательна */ }
  }

  writeFileSync(join(OUT, "items.json"), JSON.stringify({ generatedAt: new Date().toISOString(), leadId: l0?.id ?? null, secondId: l1?.id ?? null,
    status, weather, items: out }, null, 1));
  writeFileSync(join(OUT, "texts.template.json"), JSON.stringify({ lead_paragraph: "", digest: out.slice(0, 5).map((i) => ({ id: i.id, text: "" })),
    items: out.map((i) => ({ id: i.id, title: "", summary: "" })) }, null, 1));
  if (!out.length) { console.error(`Ни одного материала:\n${status.join("\n")}`); process.exit(1); }
  console.log(`items: ${out.length}, images: ${out.filter((i) => i.image).length}\n${status.join("\n")}\n-> ${OUT}/items.json, ${OUT}/texts.template.json`);
}
await main();
