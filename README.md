# procure-it

> Web-based IT asset procurement tool — manage purchase requests, generate Excel calculation sheets and specifications.

[![Version](https://img.shields.io/badge/version-26w31--b01-blue)](#)
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

**Also included:** drag & drop row reordering · position templates · Excel import · audit log with field-level diff · auto-backup every 6h · token-based auth · Docker support

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
# PROCURE_PASSWORD=yourpassword  # leave empty to disable auth
BACKUP_INTERVAL_MS=21600000      # auto-backup interval (default 6 h)
```

---

## Project structure

```
procure-it/
├── server.js           # Express + SQLite backend
├── public/
│   └── zakupki.html    # Single-page frontend (vanilla JS)
├── docs/
│   └── index.html      # Project documentation site
├── start.bat           # Windows launcher
├── start.sh            # Linux/macOS launcher
├── .env.example
├── CONTRIBUTING.md
└── LICENSE
```

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

# Без пароля
docker compose up -d

# С паролем
PROCURE_PASSWORD=yourpassword docker compose up -d
```

Откройте **https://localhost:9111** (примите предупреждение о сертификате).

### Данные на хосте

```
data/zakupki.db      # База данных
data/certs/          # TLS сертификат
data/backups/        # Автобэкапы каждые 6ч
logs/access.log      # Логи запросов
```

### Команды

```bash
docker compose ps             # статус
docker compose logs -f        # логи
docker compose down           # остановить
docker compose up -d --build  # пересобрать после обновления
```
