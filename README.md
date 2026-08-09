# procure-it

> Web-based IT asset procurement tool — manage purchase requests, generate Excel calculation sheets and specifications.

[![Version](https://img.shields.io/badge/version-<!--VERSION_SHIELDS-->26w31--b01<!--/VERSION_SHIELDS-->-blue)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-blue)](https://www.sqlite.org/)
[![Branch](https://img.shields.io/badge/default%20branch-dev-orange)](https://github.com/DarkyAndSparky/procure-it/tree/dev)

**[📖 Documentation](https://darkyAndsparky.github.io/procure-it)** · **[🐳 Docker](#docker)** · **[🐛 Issues](https://github.com/DarkyAndSparky/procure-it/issues)**

---

## What it does

`procure-it` is a self-hosted LAN tool for IT procurement specialists. It replaces manual Excel tracking and reduces repetitive data entry when creating equipment purchase requests.

**Core workflow:**
1. Fill in a request form (organization, items, prices, links)
2. Tool calculates sell prices (purchase + delivery share + markup %)
3. Export a 2-sheet Excel workbook: _расчёты_ + _спецификация_ (with formulas)
4. Print specification as PDF or download as .docx
5. Optionally send request to Bitrix24 CRM via webhook
6. All data in a local SQLite database, accessible from any LAN device

**Also included:** drag & drop row reordering · position templates · Excel import · audit log with field-level diff · auto-backup every 6h (including attached files) · role-based auth (viewer/operator/admin) · Docker support

---

## Quick start

### Windows
```
Double-click start.bat
```

### Linux / macOS
```bash
chmod +x start.sh && ./start.sh
```

First run installs npm dependencies (~1 min) and generates a self-signed TLS certificate.

**Open:** https://localhost:9111

> First visit shows a browser certificate warning — click **Advanced → Proceed**.

---

## Requirements

- **Node.js 18+** — https://nodejs.org/

---

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Stable releases only |
| `dev`  | Active development (default) |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release workflow.

---

## Configuration

```bash
cp .env.example .env
```

```env
PORT=9111                        # HTTPS port (default 9111); HTTP redirect = PORT+1 (9112)
# PROCURE_PASSWORD=yourpassword  # legacy fallback only — see "Authentication" below
BACKUP_INTERVAL_MS=21600000      # auto-backup interval (default 6 h)
```

---

## Authentication

The app has a built-in multi-user system with three roles:

| Role | Can do |
|------|--------|
| `viewer` | Read-only — no login needed at all |
| `operator` | Create/edit requests, orgs, upload files |
| `admin` | Everything operator can, plus users, settings, restore |

On first run a default admin account is created automatically — **login `admin` / password `admin0000`** — and the app forces a password change on first login. Manage additional users from the sidebar (admin only).

`PROCURE_PASSWORD` is a **legacy fallback**, not the primary auth mechanism: it only takes effect if the `users` table is still empty (e.g. a fresh install where you haven't logged in via the UI yet). Once any user exists, `PROCURE_PASSWORD` is ignored — manage access through the UI instead.

---

## Project structure

```
procure-it/
├── server.js                    # Entry point: Express app assembly, middleware, mount routers, listen
├── src/
│   ├── config.js                 # Paths, ports, default settings
│   ├── certs.js                  # Self-signed TLS cert generation (openssl → selfsigned fallback)
│   ├── db/
│   │   ├── connection.js         # sql.js instance, query()/run()/saveDb(), rowToRequest()
│   │   ├── schema.js             # CREATE TABLE + all migrations
│   │   └── audit.js              # audit_log writer
│   ├── auth/
│   │   ├── crypto.js             # Password hashing (PBKDF2 + legacy migration), token generation
│   │   ├── users.js              # User lookup / credential check
│   │   ├── sessions.js           # Session create/lookup/delete
│   │   └── middleware.js         # Role-based route guards (viewer/operator/admin)
│   ├── services/
│   │   ├── docxService.js        # Specification .docx generation
│   │   ├── fileLayoutService.js  # Network folder / WebDAV file layout
│   │   ├── backupService.js      # Scheduled DB backup + attached-files mirror sync
│   │   └── bitrixService.js      # Bitrix24 deal creation + status webhook
│   ├── utils/
│   │   └── docFormat.js          # RU month names, currency formatting, number-to-words
│   └── routes/                   # One Express router per resource — thin, delegate to services/db
│       ├── auth.js, orgs.js, requests.js, files.js,
│       └── backup.js, settings.js, docx.js, bitrix.js
├── public/
│   ├── zakupki.html              # Markup only — no inline styles/scripts
│   ├── css/style.css
│   └── js/                       # Loaded as plain <script src> (shared global scope, no bundler)
│       ├── auth.js, positions.js, request-form.js, users.js, save-export.js,
│       ├── request-detail.js, registry.js, files.js, modals-misc.js,
│       ├── helpers.js, export-templates.js, config.js
│       └── main.js               # Bootstrap — must load last
├── docs/
│   └── index.html                # Project documentation site
├── data/                          # Runtime data (gitignored, Docker volume)
│   ├── zakupki.db
│   ├── certs/                    # TLS cert (auto-generated)
│   ├── backups/                  # .db snapshots (30-day retention) + files_mirror/ (attached-file mirror)
│   ├── signed_specs/              # Uploaded signed specification PDFs
│   └── invoices/                  # Uploaded invoice files
├── start.bat                      # Windows launcher
├── start.sh                       # Linux/macOS launcher
├── .env.example
├── CONTRIBUTING.md
└── LICENSE
```

**Layering rule:** `routes/` handle HTTP concerns (validation, status codes) and delegate everything else; `services/` hold the actual business logic (docx building, file layout, backups); `db/connection.js` is the only module that touches the live sql.js instance directly — everything else goes through `query()`/`run()`/`saveDb()`. Frontend JS files share one global scope on purpose (loaded in dependency order, `main.js` last) so the many `onclick="..."` handlers in the markup keep working without a bundler.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+S` | Save request |
| `Ctrl+N` | New request |
| `Ctrl+R` | Open registry |
| `Ctrl+Enter` | Add position row |
| `Escape` | Close modal / cancel edit |
| `?` | Shortcut reference |

---

## Bitrix24

Set a webhook URL in **Конфиг → Интеграция Bitrix24**. The **🔗 Bitrix24** button on the request form sends the request as a CRM deal. Webhook URL is never included in backups.

---

## License

[MIT](LICENSE) © [DarkyAndSparky](https://github.com/DarkyAndSparky)

*Node.js · Express · SQLite · Vanilla JS · No build step*

---

## Docker

### Быстрый старт

```bash
git clone https://github.com/DarkyAndSparky/procure-it.git
cd procure-it

# Запуск (без пароля — используется встроенная система ролей)
docker compose up -d

# Первый вход: admin / admin0000  — система сразу попросит сменить пароль
```

Откройте **https://localhost:9111** (примите предупреждение о самоподписанном сертификате).

> **Права на файлы:** контейнер запускается через `docker-entrypoint.sh` — он автоматически устанавливает нужные права на `./data` и `./logs` при старте, поэтому `sudo` не требуется.

### Переменные окружения

```bash
# Создайте .env файл (docker compose подхватит автоматически):
PORT=9111                        # HTTPS порт (HTTP redirect = PORT+1)
PROCURE_PASSWORD=                # legacy single-password режим (оставьте пустым — используйте UI)
BACKUP_INTERVAL_MS=21600000      # интервал автобэкапа (6 часов)
```

### Данные на хосте

```
data/zakupki.db               # База данных (SQLite)
data/certs/                   # TLS сертификат (генерируется автоматически)
data/backups/                 # Автобэкапы .db каждые 6 часов, хранятся 30 дней
data/backups/files_mirror/    # Зеркало прикреплённых файлов (см. ниже) — актуально всегда, не версионируется
data/signed_specs/            # Подписанные спецификации (PDF)
data/invoices/                # Приложенные файлы счетов
logs/access.log                # Логи запросов (morgan combined)
```

> **О бэкапах прикреплённых файлов:** сами PDF (подписанные спецификации, счета) хранятся на диске отдельно от SQLite, поэтому `.db`-снапшот их не содержит. При каждом автобэкапе `data/backups/files_mirror/` синхронизируется с текущим содержимым `signed_specs/`/`invoices/` (копируются только новые/изменённые файлы). При восстановлении (`POST /api/restore`) сервер сначала пытается найти файл на месте, а если его нет — берёт из `files_mirror/`.

### Команды

```bash
docker compose ps              # статус контейнера
docker compose logs -f         # логи в реальном времени
docker compose down            # остановить
docker compose up -d --build   # пересобрать после обновления кода
docker compose restart         # перезапустить без пересборки
```

### Обновление

```bash
git pull
docker compose up -d --build
```

Данные в `./data` сохраняются между обновлениями.
