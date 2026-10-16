#!/usr/bin/env bash
# Pre-flight «Утренней вкладки».
#   preflight.sh                 — окружение: Bun, зависимости, браузер для скриншотов, сеть
#   preflight.sh <config.json>   — плюс конфиг темы и вход на площадку из publish.target
# По каждому пункту печатает OK или FAIL со способом исправить. Код выхода 1, если есть FAIL.
set -u
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
CFG="${1:-}"
fails=0
ok() { printf 'OK    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n      → %s\n' "$1" "$2"; fails=$((fails + 1)); }
cli() { # cli <команда> <npm-пакет> <аргументы…>: глобальная команда или npx
  local bin="$1" pkg="$2"; shift 2
  if command -v "$bin" >/dev/null 2>&1; then "$bin" "$@"; else npx --yes "$pkg" "$@"; fi
}

if command -v bun >/dev/null 2>&1; then ok "bun $(bun --version)"
else fail "нет Bun" "установить: curl -fsSL https://bun.sh/install | bash, затем открыть новый терминал"; fi

if [ -d "$SKILL/node_modules/playwright" ]; then ok "зависимости скилла"
else fail "зависимости скилла не установлены" "cd \"$SKILL\" && bun install"; fi

if command -v bun >/dev/null 2>&1 && [ -d "$SKILL/node_modules/playwright" ]; then
  exe=$(cd "$SKILL" && bun -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())' 2>/dev/null)
  if [ -n "$exe" ] && [ -e "$exe" ]; then ok "браузер для скриншотов"
  else fail "нет браузера для скриншотов" "cd \"$SKILL\" && bunx playwright install chromium"; fi
fi

# Любой HTTP-ответ (включая редирект) значит, что сеть есть; 000 — ответа нет.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://news.google.com/rss || true)
if [ -n "$code" ] && [ "$code" != "000" ]; then ok "сеть"
else fail "нет доступа к интернету (news.google.com не ответил)" "проверить сеть или прокси; без сети выпуск невозможен"; fi

if [ -n "$CFG" ]; then
  if [ ! -f "$CFG" ]; then
    fail "нет конфига $CFG" "это первый запуск темы: references/setup.md"
  else
    if msg=$(bun "$SKILL/scripts/config.ts" --config "$CFG" 2>&1); then ok "${msg#OK  }"; else fail "конфиг с ошибками" "$msg"; fi
    target=$(CFG="$CFG" bun -e 'const c = await Bun.file(process.env.CFG).json(); console.log(c.publish?.target ?? "")' 2>/dev/null)
    project=$(CFG="$CFG" bun -e 'const c = await Bun.file(process.env.CFG).json(); console.log(c.publish?.project ?? "")' 2>/dev/null)
    case "$target" in
      vercel)
        if cli vercel vercel@latest whoami ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"} </dev/null >/dev/null 2>&1; then ok "вход в Vercel"
        else fail "нет входа в Vercel" "выполнить: npx vercel login (или задать VERCEL_TOKEN для запуска без человека)"; fi ;;
      netlify)
        if cli netlify netlify-cli api getCurrentUser </dev/null >/dev/null 2>&1; then ok "вход в Netlify"
        else fail "нет входа в Netlify" "выполнить: npx netlify-cli login (или задать NETLIFY_AUTH_TOKEN)"; fi ;;
      cloudflare)
        if cli wrangler wrangler whoami </dev/null 2>&1 | grep -qi "logged in"; then ok "вход в Cloudflare"
        else fail "нет входа в Cloudflare" "выполнить: npx wrangler login (или задать CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID)"; fi
        [ -n "$project" ] || fail "нет publish.project" "вписать имя проекта Pages в config.json" ;;
      gh-pages)
        if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then ok "вход в GitHub"
        else fail "нет входа в GitHub" "установить gh и выполнить: gh auth login"; fi
        [ -n "$project" ] || fail "нет publish.project" "вписать репозиторий owner/name в config.json" ;;
      local) ok "публикация: только локальный файл, ссылки не будет" ;;
      "") fail "в конфиге нет publish.target" "спросить пользователя, куда публиковать: references/publish.md" ;;
      *) fail "неизвестная площадка $target" "одна из: vercel, netlify, cloudflare, gh-pages, local" ;;
    esac
  fi
fi

if [ "$fails" -eq 0 ]; then echo "PREFLIGHT: OK"; else echo "PREFLIGHT: FAIL ($fails)"; exit 1; fi
