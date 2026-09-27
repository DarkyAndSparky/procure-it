# Architecture

Коротко: без build-степа, без фреймворка на фронте, одна SQLite-база.
Так и задумано — see `README.md` про масштаб (2 человека, 4-5
пользователей) и `ROADMAP_Q4.md` → «React + TypeScript Prototype»
(намеренно в самом низу приоритетов).

```
Browser
   ↓  (fetch, cookie-based auth + CSRF-токен в заголовке)
Express (server.js)
   ↓  (middleware: helmet/CSP, cors, rate-limit, csrf, body-парсеры)
Routes (src/routes/*.js)
   ↓  (role-check через src/auth/middleware.js, затем бизнес-логика)
Services (src/services/*.js)
   ↓  (внешние интеграции и файловые операции)
DB layer (src/db/*.js)
   ↓  (query/run — параметризованные запросы, ничего сырого)
SQLite (sql.js — компилируемая в WASM версия, файл на диске)
```

Между `Routes` и `SQLite` нет ORM — `src/db/connection.js` даёт тонкую
обёртку (`query()`/`run()`) поверх `sql.js`, роуты пишут SQL сами
(параметризованный, см. `docs/SECURITY.md` → SQL injection review).

## Где что искать

| Область | Путь | Комментарий |
|---|---|---|
| **Auth** | `src/auth/` (`crypto.js`, `sessions.js`, `middleware.js`, `users.js`) + `src/routes/auth.js` | PBKDF2+salt, сессии — в таблице `sessions` той же SQLite (не JWT: токен непрозрачный, проверяется по серверному стору, а не самодостаточной подписью — поэтому логаут/restore могут реально инвалидировать сессию, удалив строку), роли viewer/operator/admin через `requireRole()` |
| **Migrations** | `src/db/schema.js` — `runMigrations(db)` | Выполняется автоматически при каждом старте сервера (`server.js`), идемпотентна. Новая колонка/таблица — это всегда `ALTER TABLE ... ADD COLUMN` в `try/catch` рядом с остальными, а не переписывание `CREATE TABLE` (та уже существующие БД не трогает) |
| **Backup** | `src/services/backupService.js` (сама механика: снапшоты + `files_mirror/` + 30-дневный retention) + `src/routes/backup.js` (`GET /api/backup`, `POST /api/restore`, `GET /api/backup/db`) | Подробный процесс — `docs/OPERATIONS.md` |
| **Uploads** | `src/routes/files.js` (подписанные спецификации, счета), `src/routes/orgs.js` (лист согласования договора) | Файлы — на диске (`data/signed_specs/`, `data/invoices/`, `data/contract_approvals/`), в БД — только служебное имя файла (`<id>.ext`) + опционально оригинальное имя для скачивания. Путь всегда строится из `path.basename()` — защита от path traversal, см. `docs/SECURITY.md` |
| **Audit** | `src/db/audit.js` (`auditLog()`) + `GET /api/audit` (лежит в `src/routes/backup.js`, не в отдельном файле — так сложилось исторически) | Пишется в `audit_log` при создании/изменении/удалении заявки, смене статуса, загрузке файлов. С `26w36-b20` — включая `username` (кто сделал изменение) |
| **Frontend** | `public/zakupki.html` + `public/js/*.js` + `public/css/style.css` | Ванильный JS, без сборки, без фреймворка. Файлы разделены по ответственности (`registry.js` — реестр/фильтры, `request-form.js`/`positions.js` — форма заявки, `save-export.js`/`export-templates.js` — Excel, `config.js` — страница конфига, и т.д.). Обработчики событий централизованы в `inline-events.js` — из-за строгой CSP (`script-src-attr: 'none'`) инлайновые `onclick=...` в HTML не работают вообще, поэтому разметка использует `data-ieNN` атрибуты, а сама привязка `addEventListener` — в одном файле |

## Что почитать дальше

- `docs/OPERATIONS.md` — запуск, обновление, backup/restore, disaster recovery
- `docs/SECURITY.md` — security-модель, что проверено и как
- `docs/index.html` — пользовательская документация + полный REST API reference (открывается прямо из интерфейса приложения)
- `ROADMAP.md` — инженерный журнал (что сделано и как, по версиям)
- `ROADMAP_Q4.md` — квартальный план (что делать дальше)
