# Публикация

Страница — одна папка `out/site/` со статическим `index.html`. Адрес остаётся тем же каждый день: пользователь сохраняет ссылку один раз, а каждый выпуск обновляет страницу по ней.

Вход на площадку проверяет `scripts/preflight.sh <config.json>`. Ключи и токены живут в окружении или в залогиненном CLI, в конфиг и в репозиторий их не класть. Если входа нет — попросить пользователя войти (команда в выводе pre-flight) или дать токен; площадку молча не менять.

Команды выполнять из рабочей папки темы.

| `publish.target` | Первый раз | Каждый выпуск | Адрес | Токен для запуска без человека |
|---|---|---|---|---|
| `vercel` | `cd out/site && npx --yes vercel link --yes --project <имя>` | `cd out/site && npx --yes vercel deploy --prod --yes` | `https://<имя>.vercel.app` | `VERCEL_TOKEN` |
| `netlify` | `npx --yes netlify-cli sites:create --name <имя>`; id сайта в `publish.project` | `npx --yes netlify-cli deploy --prod --dir out/site --site <id>` | `https://<имя>.netlify.app` | `NETLIFY_AUTH_TOKEN` |
| `cloudflare` | `npx --yes wrangler pages project create <имя> --production-branch main` | `npx --yes wrangler pages deploy out/site --project-name <имя> --branch main` | `https://<имя>.pages.dev` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `gh-pages` | публичный репозиторий `owner/name`; после первого пуша: `gh api repos/<owner>/<name>/pages -X POST -f "source[branch]=gh-pages" -f "source[path]=/"` | `cd out/site && rm -rf .git && git init -q -b gh-pages && git add -A && git commit -qm "выпуск $(date +%F)" && git push -fq https://github.com/<owner>/<name>.git gh-pages` | `https://<owner>.github.io/<name>/` | `GH_TOKEN` |
| `local` | — | — | путь к `out/site/index.html`; ссылки нет | — |

После первой публикации вписать адрес в `publish.url` конфига: по нему идёт проверка в каждом выпуске.

## Проверка после выкладки

- [ ] `curl -sI <url>` → `200` (GitHub Pages после первого включения отвечает 404 до пары минут — подождать и повторить);
- [ ] `curl -s <url> | grep -o "<title>[^<]*"` показывает сегодняшнюю дату: старая дата значит, что выложилась прошлая версия.
