// Общая схема конфига темы и аргументов CLI.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SourceType = "rss" | "hn" | "github-trending";
export interface Source { name: string; url: string; section: string; limit: number; type?: SourceType; windowHours?: number; boost?: number }
export interface Section { id: string; title: string }
export interface City { name: string; lat: number; lon: number }
export type PublishTarget = "vercel" | "netlify" | "cloudflare" | "gh-pages" | "local";
export interface Publish { target: PublishTarget; project?: string; url?: string }
export interface TopicConfig {
  title: string; tagline: string; topline: string; lang: string; locale: string; timezone: string;
  city?: City; keywords: string[]; windowHours: number; sections: Section[]; sources: Source[];
  labels?: Partial<Labels>; publish?: Publish;
}
export interface Labels { digest: string; almanac: string; sunrise: string; sunset: string; edition: string; weather: string; volume: string; discuss: string; via: string; points: string; comments: string; dayUpTo: string; footer: string }
export const DEFAULT_LABELS: Labels = { digest: "ГЛАВНОЕ ЗА ДЕНЬ", almanac: "АЛЬМАНАХ", sunrise: "Восход", sunset: "Закат", edition: "Утренний выпуск",
  weather: "Метеослужба", volume: "ТОМ I · №", discuss: "ОБСУЖДЕНИЕ", via: "через", points: "очк.", comments: "комм.", dayUpTo: "днём до", footer: "Тексты написаны агентом · Источники" };

export interface OutItem { id: string; source: string; section: string; url: string; discussUrl: string; points: number | null; comments: number | null;
  ageHours: number | null; image: string; title: string; summary: string; body?: string; extra: string; score: number }
export interface Weather { temp: number | null; max: number | null; sunrise: string; sunset: string }
export interface Items { generatedAt: string; leadId: string | null; secondId: string | null; status: string[]; weather: Weather; items: OutItem[] }
export interface TextItem { id: string; title: string; summary: string }
export interface Texts { lead_paragraph: string; digest: { id: string; text: string }[]; items: TextItem[] }

export function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? def) : def;
}
// Возвращает список ошибок конфига; пустой список = конфиг годен.
export function validateConfig(c: Partial<TopicConfig>): string[] {
  const e: string[] = [];
  for (const k of ["title", "tagline", "topline", "lang", "locale", "timezone"] as const) if (typeof c[k] !== "string" || !c[k]) e.push(`нет поля ${k}`);
  if (typeof c.windowHours !== "number") e.push("нет поля windowHours (число часов)");
  if (!Array.isArray(c.keywords)) e.push("нет поля keywords (массив, можно пустой)");
  if (!Array.isArray(c.sections) || !c.sections.length) e.push("нет sections");
  if (!Array.isArray(c.sources) || !c.sources.length) e.push("нет sources");
  const ids = new Set((c.sections ?? []).map((s) => s.id));
  for (const s of c.sources ?? []) {
    if (!s.name || !/^https?:\/\//.test(s.url ?? "")) e.push(`источник ${s.name ?? "?"}: нет name или url`);
    if (!ids.has(s.section)) e.push(`источник ${s.name}: раздел "${s.section}" не описан в sections`);
    if (typeof s.limit !== "number") e.push(`источник ${s.name}: нет limit`);
  }
  if (c.timezone) try { new Intl.DateTimeFormat("en", { timeZone: c.timezone }); } catch { e.push(`timezone "${c.timezone}" неизвестен`); }
  if (c.publish && !["vercel", "netlify", "cloudflare", "gh-pages", "local"].includes(c.publish.target)) e.push(`publish.target "${c.publish.target}" не поддерживается`);
  return e;
}
export function loadConfig(): { cfg: TopicConfig; out: string } {
  const path = resolve(arg("config", "config.json"));
  const cfg = JSON.parse(readFileSync(path, "utf8")) as TopicConfig;
  const errs = validateConfig(cfg);
  if (errs.length) { console.error(`Конфиг ${path} с ошибками:\n  ${errs.join("\n  ")}`); process.exit(1); }
  return { cfg, out: resolve(arg("out", "out")) };
}

// bun scripts/config.ts --config <путь> — только проверка конфига (используется preflight.sh).
if (import.meta.main) { const { cfg } = loadConfig(); console.log(`OK  конфиг: ${cfg.title}, источников ${cfg.sources.length}, публикация ${cfg.publish?.target ?? "не задана"}`); }
