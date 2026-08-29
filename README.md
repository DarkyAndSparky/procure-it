<div align="center">

# 🖥️ IT Assets — Dev

**Ветка разработки**

![Version](https://img.shields.io/badge/версия-β1·26w35·01-blue?style=flat-square)
![Tests](https://img.shields.io/badge/тесты-283%20passed-brightgreen?style=flat-square&logo=jest)
![E2E](https://img.shields.io/badge/E2E-44%20verified%20%2B%2014%20new-yellow?style=flat-square&logo=playwright)
![Node](https://img.shields.io/badge/Node.js-v22.5%2B-brightgreen?style=flat-square&logo=node.js)
![Branch](https://img.shields.io/badge/ветка-dev%20(разработка)-orange?style=flat-square)

> Это ветка активной разработки. Здесь ведутся эксперименты, пишутся тесты, отлаживаются фичи.
> Стабильный production-код находится в ветке **[`main`](https://github.com/DarkyAndSparky/it-assets/tree/main)**.

📚 **[Документация проекта](https://darkyandsparky.github.io/it-assets/)** — архитектура, API, руководство пользователя, установка

</div>

---

## 📦 Что есть в dev, чего нет в main

| Файл / папка           | Назначение                                      |
|------------------------|-------------------------------------------------|
| `tests/`               | 283 теста (Jest + Supertest)                    |
| `tests-e2e/`           | 58 E2E тестов (Playwright) — 44 проверены, 14 новых ещё не прогонялись (см. ниже) |
| `TEST.bat`             | Запуск Jest тестов на Windows                   |
| `TEST-E2E.bat`         | Запуск E2E тестов на Windows                    |
| `test.sh`              | Запуск тестов на Linux / macOS                  |
| `test-e2e.sh`          | Запуск E2E тестов на Linux / macOS              |
| `release.bat`          | Автоматический релиз из dev в main (без тестов) |
| `playwright.config.js` | Конфигурация Playwright                         |
| `package-lock.json`    | Зафиксированные версии зависимостей             |
| `devDependencies`      | Jest, Supertest, Playwright, jimp, jsqr         |
| `tools/itassets_converter.html` | Автономный HTML-конвертер старых Excel-выгрузок оборудования в CSV для импорта |

---

## 🚀 Быстрый старт (разработка)

```bash
git clone https://github.com/DarkyAndSparky/it-assets.git
cd it-assets
git checkout dev
npm install
npm start
```

Приложение: **`https://localhost:3443`**

Требуется **Node.js 22.5+** (используется встроенный `node:sqlite`, стабилизированный в Node 25.7/26 — на более ранних 22.x/24.x работает с предупреждением `ExperimentalWarning`, это не ошибка).

---

## 🧪 Тесты

```bash
npm test                  # все тесты Jest (283)
npm run test:watch        # watch-режим
npm run test:coverage     # с отчётом покрытия
npm run test:e2e          # E2E тесты Playwright (58)
npm run test:e2e:ui       # E2E с UI-интерфейсом
```

**Windows:** `TEST.bat` / `TEST-E2E.bat`

**Linux / macOS:**
```bash
chmod +x test.sh && ./test.sh
chmod +x test-e2e.sh && ./test-e2e.sh
```

### Результат (Jest)

```
Test Suites: 14 passed, 14 total
Tests:       283 passed, 283 total
```

### Результат (Playwright)

```
smoke.spec.js                    —  7 passed
theme.spec.js                    — 37 passed
backup-import-export.spec.js     — 14 тестов, написаны по коду UI, но ЕЩЁ НЕ ПРОГНАНЫ
                                     в реальном браузере (см. примечание в самом файле) —
                                     нужен локальный npm run test:e2e перед тем как считать
                                     их частью зелёного билда
```

### Покрытие Jest

| Файл                        | Что тестируется                                              |
|------------------------------|--------------------------------------------------------------|
| `api.test.js`               | CRUD активов, фильтры, поиск, пагинация                      |
| `assets.test.js`            | Создание, перемещение, списание                              |
| `backup.test.js`            | Создание/скачивание/восстановление, path traversal, обратная совместимость со старыми (до SQLite) бэкапами, сквозной цикл с реальными данными |
| `config.test.js`            | Орги, филиалы, локации, инициализация БД                     |
| `configExportImport.test.js`| Экспорт/сравнение/импорт config.json между инстансами (кросс-инстанс синхронизация) |
| `csvImportExport.test.js`   | Экспорт активов в CSV, импорт CSV (дедупликация, авто-создание орг/филиалов/локаций/сотрудников) |
| `csvImportHistory.test.js`  | Импорт истории перемещений с авто-сопоставлением по серийному номеру |
| `edge.test.js`              | Граничные случаи, невалидные данные                           |
| `employees.test.js`         | Сотрудники, увольнение с переносом активов                    |
| `history.test.js`           | История, фильтры, сортировка                                  |
| `integrity.test.js`         | Целостность схемы, уникальность id/инв. номеров                |
| `invRules.test.js`          | Правила инвентаризации, генерация номеров                     |
| `qr.test.js`                | Генерация QR-кодов                                            |
| `settings.test.js`          | Настройки, смена пароля, warn_default_pin                     |

### Покрытие E2E (Playwright)

| Файл                            | Тестов | Что покрывает                                                   |
|----------------------------------|--------|-------------------------------------------------------------------|
| `smoke.spec.js`                 | 7      | Логин, вкладки, создание актива, логаут                          |
| `theme.spec.js`                 | 37     | CSS-переменные, переключение темы, утечки цветов, i18n            |
| `backup-import-export.spec.js`  | 14     | Бэкапы (создание/восстановление/confirm-диалог), CSV импорт/экспорт в UI, синхронизация config.json — **не прогонялся в реальном браузере**, нужна проверка перед доверием |

---

## 🔁 Рабочий процесс

### Ежедневная разработка

```bash
git checkout dev              # убедиться что ты на dev
# ... редактируешь файлы в VS Code ...
git add .                     # добавить изменения
git commit -m "описание"      # сохранить
git push origin dev           # отправить на GitHub
```

### Релиз в production (dev → main)

Когда dev стабилен и все тесты проходят — запусти `release.bat` двойным кликом.

Скрипт автоматически:
1. Проверит что ты на `dev` и нет незакоммиченных изменений
2. Переключится на `main`
3. Скопирует только нужные файлы (`server/`, `public/`, скрипты запуска)
4. Обновит `package.json` — уберёт тесты и devDependencies
5. Сделает коммит и запушит в `main`
6. Вернётся обратно в `dev`

---

## 🗂️ Структура проекта

```
it-assets/
├── server/
│   ├── index.js              # веб-сервер (Express + HTTPS)
│   ├── database.js           # композиция репозиториев + config export/diff/apply
│   ├── db/
│   │   ├── store.js          # lowdb-инстанс (только служебные _meta/schema_version)
│   │   └── sqlite.js         # SQLite-подключение (node:sqlite) + автомиграция из lowdb
│   ├── middleware/           # auth.js, rateLimit.js
│   ├── repositories/         # orgs, filials, locations, assets, employees, users,
│   │                         # accounts, settings, history, csv, stats — все на SQLite
│   ├── routes/               # Express Router на каждую сущность
│   ├── migrate.js            # одноразовая миграция lowdb-схемы (v1→v7), выполняется
│   │                         # до SQLite-слоя, затем становится no-op
│   ├── logger.js             # структурированные JSON-логи с ротацией по дате
│   ├── cert.js                # TLS-сертификат
│   └── pin.js                # bcrypt PIN
├── public/
│   ├── index.html            # SPA-оболочка
│   ├── css/main.css          # все стили (светлая/тёмная тема)
│   └── js/
│       ├── theme.js          # тема (подключается в <head>)
│       ├── i18n.js           # локализация EN/RU
│       ├── auth.js           # авторизация
│       ├── ui-utils.js       # утилиты UI
│       ├── qr.js             # QR-генератор
│       ├── meta-fields.js    # MAC/IP/hostname поля (канонический список meta-ключей)
│       ├── global-search.js  # глобальный поиск
│       ├── router.js         # SPA-роутер
│       ├── event-delegation.js  # делегирование событий
│       ├── settings-router.js   # роутер настроек
│       └── views/            # модуль на каждый экран
│           ├── dashboard.js, asset-tab.js, asset-forms.js
│           ├── history.js, employees.js, accounts.js, alerts.js
│           ├── inv-generator.js, qr-print.js, csv-import.js
│           └── settings-general.js, settings-config.js,
│               settings-refdata.js, types-admin.js, users-admin.js
├── tools/
│   └── itassets_converter.html   # автономный конвертер старых Excel-выгрузок в CSV
├── tests/                    # Jest + Supertest (283 теста)
├── tests-e2e/                # Playwright E2E (58 тестов: 44 проверены, 14 новых нет)
│   ├── smoke.spec.js
│   ├── theme.spec.js
│   ├── backup-import-export.spec.js
│   └── fixtures/             # тестовые CSV/JSON для E2E-импорта
├── docs/                     # Документация (GitHub Pages)
├── data/                     # в git не попадает — db.json, config.json, it-assets.sqlite
├── playwright.config.js
├── package.json
├── release.bat               # скрипт релиза dev → main
├── START.bat / start.sh
├── INSTALL.bat / install.sh
├── TEST.bat / test.sh
└── TEST-E2E.bat / test-e2e.sh
```

---

## ⚙️ Переменные окружения

| Переменная                     | По умолчанию | Описание                                                        |
|----------------------------------|--------------|-------------------------------------------------------------------|
| `PORT`                          | `3000`       | HTTP-порт (редирект на HTTPS)                                   |
| `HTTPS_PORT`                    | `3443`       | HTTPS-порт приложения                                           |
| `IT_ASSETS_DATA_DIR`            | `./data`     | Путь к папке с данными (db.json, config.json, it-assets.sqlite) |
| `IT_ASSETS_LOG_RETENTION_DAYS`  | `14`         | Сколько дней хранить файлы логов в `data/logs/`                 |
| `TRUST_PROXY`                   | —            | Установите `1` при работе за nginx/reverse proxy                |
| `CORS_ORIGINS`                  | —            | Разрешённые origins через запятую                               |
| `NODE_ENV`                      | —            | Jest выставляет `test` автоматически, отключает фоновые таймеры/логи |

---

## 🌿 Ветки и релизы

| Ветка  | Назначение                                         |
|--------|----------------------------------------------------|
| `main` | Production — чистый билд без тестов                |
| `dev`  | Разработка — полный код с тестами и инструментами  |

**Текущая версия:** `beta-1-26w29-01`

---

## 🛠️ Технологии

| Слой             | Стек                                                                 |
|------------------|------------------------------------------------------------------------|
| Сервер           | Node.js 22.5+ + Express                                              |
| База данных      | SQLite (встроенный `node:sqlite`, без нативных аддонов) — вся прикладная данные (активы, история, орг-структура, справочники, пользователи). lowdb остаётся только для служебной версии схемы |
| Аутентификация   | Header-based, bcrypt PIN                                              |
| TLS              | selfsigned (авто-генерация)                                           |
| Логирование      | Структурированные JSON-логи с ротацией по дате (`server/logger.js`)   |
| Фронтенд         | Vanilla JS, SPA, 20+ модулей, EN/RU                                  |
| Тесты            | Jest + Supertest (283) + Playwright E2E (44 проверены + 14 новых)    |

---

<div align="center">

Разработано для внутреннего учёта ИТ-оборудования
Автор: **[DarkyAndSparky](https://github.com/DarkyAndSparky)**

</div>
