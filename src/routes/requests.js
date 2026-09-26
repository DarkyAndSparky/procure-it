const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { getDb, query, run, rowToRequest, saveDb } = require('../db/connection');
const { auditLog } = require('../db/audit');
const { operatorOrAdmin } = require('../auth/middleware');
const { sendStatusWebhook } = require('../services/bitrixService');
const { calcRowPricing } = require('../../public/js/pricing-core');
const { SIGNED_DIR, INVOICE_DIR } = require('../config');

const ALLOWED_STATUSES = ['new','ordered','partial','delivered','cancelled'];

// Матрица переходов статуса (ROADMAP_Q4.md, раздел 7 — «Жизненный цикл
// заявки»). Терминальные статусы (delivered/cancelled) — без дальнейших
// переходов через этот механизм; чтобы поправить реальную ошибку
// (например, по невнимательности отметили «Получено» раньше времени),
// это осознанно оставлено доступным только admin — см. isValidStatusTransition.
// operator в таком случае обращается к admin, а не тихо чинит статус сам —
// это тоже часть смысла аудита переходов (иначе история переходов
// перестаёт что-либо гарантировать).
const STATUS_TRANSITIONS = {
  new:       ['ordered', 'cancelled'],
  ordered:   ['partial', 'delivered', 'cancelled'],
  partial:   ['delivered'],
  delivered: [],
  cancelled: [],
};

// Единая проверка — используется и в PATCH /requests/:id/status (основной
// путь смены статуса), и в PUT /requests/:id (полное редактирование тоже
// пишет status в БД и было бы лазейкой в обход матрицы, если проверять
// только PATCH — см. аудит-находку в CHANGELOG 26w36-b19).
function isValidStatusTransition(oldStatus, newStatus, userRole) {
  if (oldStatus === newStatus) return true; // не переход, а no-op — всегда ок
  if (userRole === 'admin') return true;    // осознанный обход для исправления ошибок
  return (STATUS_TRANSITIONS[oldStatus] || []).includes(newStatus);
}

// Баг (найден при аудите перед слиянием dev→main): POST /requests
// валидировал каждую позицию (name — строка, qty>=0, purchasePrice —
// число), а PUT /requests/:id — только «массив ли вообще positions»,
// без проверки полей внутри. Через редактирование существующей заявки
// можно было сохранить то, что create отклонил бы (например,
// qty: "много" или отрицательную цену) — расхождение в строгости между
// create и update для одних и тех же данных. Вынесено в общую функцию,
// чтобы дальше эти две проверки не могли разойтись снова.
function validatePositions(positions) {
  if (positions === undefined) return null;
  if (!Array.isArray(positions)) return 'positions должен быть массивом';
  for (const p of positions) {
    if (typeof p.name !== 'string') return 'Некорректная позиция: name';
    if (p.qty !== undefined && (isNaN(p.qty) || p.qty < 0)) return 'Некорректное кол-во';
    if (p.purchasePrice !== undefined && isNaN(p.purchasePrice)) return 'Некорректная цена';
  }
  return null;
}

// Уязвимость/находка аудита: сервер писал total/totalPurchase/deliveryCost
// из тела запроса как есть, без сверки с positions — баг в клиентском
// расчёте (или намеренно изменённый через devtools запрос от operator)
// тихо сохранялся бы как «official» сумма заявки и уходил дальше в
// спецификацию/счёт/Bitrix без единой проверки. Раньше это только
// логировалось (см. историю в CHANGELOG/ROADMAP) — сознательно отложенное
// решение, которое перед слиянием в main решили не откладывать дальше:
// теперь сервер сам считает totalPurchase/total из positions той же
// формулой (calcRowPricing — общий модуль для браузера и Node, см. его
// комментарий) и полностью игнорирует то, что прислал клиент в этих двух
// полях. Позиционные суммы (purchaseSum/sellPerUnit/sellSum ВНУТРИ каждой
// строки) по-прежнему приходят от клиента как есть — не трогаем: это 1:1
// то же самое отображение, что видел пользователь в форме перед
// сохранением, и трогать их — отдельная, более крупная правка (пришлось
// бы тащить на сервер весь calcRowPricing-пайплайн для каждой строки,
// включая распределение доли доставки), не обязательная для закрытия
// именно этой дыры — итоговые total/totalPurchase проверяются, что
// решает вопрос «нельзя тихо подделать сумму заявки».
function computeAuthoritativeTotals(id, r) {
  const positions = Array.isArray(r.positions) ? r.positions : [];
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const roundToRuble = !!r.roundToRuble;
  try {
    const totalPurchase = round2(positions.reduce((s, p) => s + (Number(p.purchasePrice)||0) * (Number(p.qty)||0), 0));
    const markupFrac = (r.markup !== undefined && r.markup !== null ? Number(r.markup) : 5) / 100;
    const total = round2(positions.reduce((s, p) => {
      const pricing = calcRowPricing({
        purchasePrice: Number(p.purchasePrice) || 0,
        qty: Number(p.qty) || 0,
        totalPurchase,
        deliveryCost: Number(r.deliveryCost) || 0,
        markup: markupFrac,
        roundToRuble,
      });
      // Сервер — единственный источник истины для sellPerUnit/sellSum,
      // которые уходят в БД как часть positions (JSON) и оттуда читаются
      // и Excel-экспортом (save-export.js), и DOCX-спецификацией
      // (docxService.js) — оба ЧИТАЮТ уже посчитанное, не пересчитывают
      // сами. Раньше здесь считался только агрегат (totalPurchase/total)
      // для сверки с тем, что прислал клиент, а сами p.sellPerUnit/p.sellSum
      // сохранялись как есть — то, что вычислил браузер. Для обычного
      // режима разницы в этом нет (округление то же самое), но для
      // roundToRuble — критично: без перезаписи здесь Excel/DOCX могли бы
      // показать нецелые копейки, если клиент почему-то прислал их без
      // применённого округления (устаревший фронт, прямой вызов API).
      p.sellPerUnit = pricing.sellPerUnit;
      p.sellSum      = pricing.sellSum;
      return s + pricing.sellSum;
    }, 0));

    // Расхождение с тем, что прислал клиент, больше не решает, что попадёт
    // в БД — но по-прежнему полезный сигнал: подсказывает баг в форме или
    // рассинхронившуюся версию фронтенда, а не только попытку подделки.
    const EPS = 0.05 * positions.length + 0.02; // накопление копеечных округлений по строкам
    const gotTotalPurchase = Number(r.totalPurchase) || 0;
    const gotTotal = Number(r.total) || 0;
    if (Math.abs(totalPurchase - gotTotalPurchase) > EPS || Math.abs(total - gotTotal) > EPS) {
      console.warn(
        `[requests] Пересчитана сумма заявки ${id}: ` +
        `клиент прислал totalPurchase=${gotTotalPurchase}/total=${gotTotal}, ` +
        `сервер сохраняет totalPurchase=${totalPurchase}/total=${total}`
      );
    }
    return { totalPurchase, total };
  } catch(e) {
    // Даже если calcRowPricing упал на каких-то экзотических данных —
    // не откатываемся на «доверять клиенту», а считаем максимально грубо,
    // но всё ещё из positions, не из тела запроса.
    console.warn(`[requests] computeAuthoritativeTotals упал на заявке ${id}, грубый пересчёт:`, e.message);
    const totalPurchase = round2(positions.reduce((s, p) => s + (Number(p.purchasePrice)||0) * (Number(p.qty)||0), 0));
    return { totalPurchase, total: totalPurchase };
  }
}

// ── REQUESTS ──────────────────────────────────────────────────────────────────
router.get('/requests', (req, res) => {
  let sql = 'SELECT * FROM requests WHERE 1=1';
  const params = [];
  if (req.query.org)    { sql += ' AND org_id=?';    params.push(req.query.org); }
  if (req.query.month)  { sql += ' AND date LIKE ?';  params.push(req.query.month + '%'); }
  if (req.query.status)   { sql += ' AND status=?';     params.push(req.query.status); }
  if (req.query.supplier) { sql += ' AND supplier=?'; params.push(req.query.supplier); }
  if (req.query.counterparty) { sql += ' AND counterparty=?'; params.push(req.query.counterparty); }
  // Свободный текстовый поиск (q) НЕ идёт через SQL LIKE: SQLite делает
  // регистронезависимое сравнение в LIKE только для ASCII — для кириллицы
  // (и любого другого не-ASCII) регистр учитывается буквально. Из-за этого
  // поиск "закуп" не находил сохранённое "Закуп" (баг, найден реальным e2e-
  // прогоном: фронтенд приводит запрос к нижнему регистру через JS
  // toLowerCase(), который корректно ICU-aware, а SQLite LIKE — нет).
  // Фильтруем в JS уже после остальных SQL-фильтров — набор для конкретной
  // организации/месяца/статуса в self-hosted инструменте небольшой (БД и
  // так целиком в памяти у sql.js), так что это не проблема производительности.
  sql += ' ORDER BY created_at DESC';

  let rows = query(sql, params);

  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    rows = rows.filter(row =>
      (row.name      || '').toLowerCase().includes(q) ||
      (row.mol       || '').toLowerCase().includes(q) ||
      (row.spec_num  || '').toLowerCase().includes(q) ||
      (row.bitrix    || '').toLowerCase().includes(q) ||
      (row.positions || '').toLowerCase().includes(q)
    );
  }

  // Server-side pagination — default 100 per page, max 500
  const limit  = Math.min(parseInt(req.query.limit  || '100'), 500);
  const offset = Math.max(parseInt(req.query.offset || '0'),   0);
  const total  = rows.length;

  res.json({
    items: rows.slice(offset, offset + limit).map(rowToRequest),
    total,
    limit,
    offset,
  });
});


router.get('/requests/:id', (req, res) => {
  const row = query('SELECT * FROM requests WHERE id=?', [req.params.id])[0];
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  res.json(rowToRequest(row)); // PDF served via /api/requests/:id/signed-spec
});

router.post('/requests', operatorOrAdmin, (req, res) => {
  const r = req.body;
  if (!r.name) return res.status(400).json({ error: 'Название обязательно' });
  const positionsError = validatePositions(r.positions);
  if (positionsError) return res.status(400).json({ error: positionsError });
  // Уязвимость (найдена при аудите): раньше id можно было задать в теле
  // запроса (`r.id || Date.now()...`). Фронтенд этим никогда не пользовался
  // (id для новой заявки не отправляется — только при PUT/обновлении, и там
  // используется req.params.id из URL, а не тело), то есть легитимной нужды
  // в клиентском id на создании нет. При этом id напрямую попадает в имя
  // файла при загрузке подписанной спецификации/счёта (`${req.params.id}.pdf`),
  // и id вида "../../../../tmp/evil" позволял записать файл ЗА пределами
  // data/signed_specs — path traversal, подтверждено на практике. Теперь id
  // всегда генерируется на сервере (randomUUID() — заодно исключает и
  // теоретическую гонку двух Date.now() в одну и ту же миллисекунду).
  const id = require('crypto').randomUUID();
  if (r.status && !ALLOWED_STATUSES.includes(r.status)) r.status = 'new';
  // Аудит-находка (26w36-b25, при добавлении Dashboard/§11): дата заявки
  // не имела дефолта на сервере — только на клиенте (request-form.js уже
  // подставляет сегодня, если поле пустое). Через обычный UI это никогда
  // не всплывало, но прямой вызов API (скрипт, интеграция, ручной curl)
  // мог создать заявку с пустой датой — а такая заявка тогда не попадала
  // НИ В ОДИН период-фильтр Dashboard (`date >= ?`/`date LIKE ?` не
  // матчат пустую строку), оставаясь только в «за всё время». Дублируем
  // тот же дефолт на сервере — не полагаемся на то, что дату всегда
  // подставит клиент.
  const requestDate = r.date || new Date().toISOString().slice(0, 10);
  // Guard against spec_num collisions — e.g. a stale client-side registry cache
  // suggesting a number that was already taken by another request in the meantime.
  // Область уникальности — организация + номер (не глобально по всей системе):
  // у разных организаций один и тот же номер («П202608-01») — это нормально,
  // конфликт только если он повторяется у ОДНОЙ и той же организации.
  if (r.specNum) {
    const dup = query('SELECT id FROM requests WHERE spec_num=? AND org_id=?', [r.specNum, r.orgId||''])[0];
    if (dup) return res.status(409).json({ error: `Спецификация с номером «${r.specNum}» уже существует у этой организации. Обновите страницу и попробуйте снова.` });
  }
  const { totalPurchase, total } = computeAuthoritativeTotals(id, r);
  const ok = run(`INSERT INTO requests (id,spec_num,org_id,org_full,org_short,org_signatory,org_stamp,bitrix,name,mol,date,address,supplier,invoice_num,contract,status,comment,is_realization,delivery_cost,markup,total_purchase,total,positions,doc_type,counterparty,warranty_period,round_to_ruble) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'', r.orgStamp !== undefined ? (r.orgStamp?'1':'0') : '1',
     r.bitrix||'', r.name, r.mol||'', requestDate, r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
     r.status||'new', r.comment||'', r.isRealization?1:0,
     r.deliveryCost||0, (r.markup!==undefined&&r.markup!==null?r.markup:5), totalPurchase, total,
     JSON.stringify(r.positions||[]), r.docType || 'goods', r.counterparty||'', r.warrantyPeriod||'', r.roundToRuble?1:0]);
  if (!ok) return res.status(500).json({ error: 'Не удалось сохранить заявку. Возможно, номер спецификации уже занят — обновите страницу и попробуйте снова.' });
  auditLog('CREATE', id, null, null, r.specNum, { name: r.name, org: r.orgShort }, req.username);
  res.json(rowToRequest(query('SELECT * FROM requests WHERE id=?', [id])[0]));
});

router.put('/requests/:id', operatorOrAdmin, (req, res) => {
  const r = req.body;
  if (!r.name) return res.status(400).json({ error: 'Название обязательно' });
  const positionsError = validatePositions(r.positions);
  if (positionsError) return res.status(400).json({ error: positionsError });
  if (r.status && !ALLOWED_STATUSES.includes(r.status)) r.status = 'new';
  // См. isValidStatusTransition выше — та же матрица переходов, что и в
  // PATCH /requests/:id/status. Полное редактирование заявки тоже пишет
  // status в UPDATE ниже, и без этой проверки было бы способом обойти
  // матрицу — просто открыть заявку на редактирование и выбрать в
  // выпадающем списке f-status любое значение вместо кнопки смены статуса.
  {
    const prevStatusRow = query('SELECT status FROM requests WHERE id=?', [req.params.id])[0];
    if (prevStatusRow && r.status && !isValidStatusTransition(prevStatusRow.status, r.status, req.userRole)) {
      const allowed = STATUS_TRANSITIONS[prevStatusRow.status] || [];
      const allowedLabel = allowed.length ? allowed.join(', ') : 'нет (финальный статус)';
      return res.status(400).json({ error: `Недопустимый переход статуса: «${prevStatusRow.status}» → «${r.status}». Допустимо отсюда: ${allowedLabel}.` });
    }
  }
  // Считаем authoritative-суммы ДО diff-блока ниже — сравнение изменений
  // должно идти против того, что реально попадёт в БД, а не против
  // непроверенных чисел из тела запроса (см. computeAuthoritativeTotals).
  const { totalPurchase, total } = computeAuthoritativeTotals(req.params.id, r);
  // Compute field-level diff against current state
  const prev = query('SELECT * FROM requests WHERE id=?', [req.params.id])[0];
  if (!prev) return res.status(404).json({ error: 'Заявка не найдена' });
  const diffFields = [];
  if (prev) {
    const fieldMap = {
      name:          [prev.name,          r.name],
      mol:           [prev.mol,           r.mol],
      date:          [prev.date,          r.date],
      address:       [prev.address,       r.address],
      supplier:      [prev.supplier,      r.supplier],
      contract:      [prev.contract,      r.contract],
      invoice_num:   [prev.invoice_num,   r.invoiceNum],
      counterparty:  [prev.counterparty,  r.counterparty],
      delivery_cost: [prev.delivery_cost, r.deliveryCost],
      markup:        [prev.markup,        r.markup],
      comment:       [prev.comment,       r.comment],
      round_to_ruble: [prev.round_to_ruble, r.roundToRuble?1:0],
    };
    for (const [field, [oldV, newV]] of Object.entries(fieldMap)) {
      const o = String(oldV ?? ''), n = String(newV ?? '');
      if (o !== n) diffFields.push({ field, old: o, new: n });
    }
    // Positions diff — detailed: added, removed, changed items
    // Как и в rowToRequest (см. src/db/connection.js) — не даём битому JSON
    // в старой записи уронить весь запрос 500-й ошибкой, деградируем в [].
    let prevPos = [];
    try {
      const parsed = JSON.parse(prev.positions || '[]');
      if (Array.isArray(parsed)) prevPos = parsed;
      else console.warn(`[requests] positions заявки ${req.params.id} — не массив после JSON.parse, подставлен []`);
    } catch(e) {
      console.warn(`[requests] Битый JSON в positions заявки ${req.params.id}, подставлен []:`, e.message);
    }
    const newPos  = r.positions || [];

    const prevNames = new Set(prevPos.map(p => p.name));
    const newNames  = new Set(newPos.map(p => p.name));

    const added   = newPos.filter(p => !prevNames.has(p.name)).map(p => p.name);
    const removed = prevPos.filter(p => !newNames.has(p.name)).map(p => p.name);

    // Changed: same name but different qty or price
    const changed = [];
    for (const np of newPos) {
      const pp = prevPos.find(p => p.name === np.name);
      if (!pp) continue;
      const changes = [];
      if (String(pp.qty) !== String(np.qty))
        changes.push(`кол-во: ${pp.qty}→${np.qty}`);
      if (String(pp.purchasePrice) !== String(np.purchasePrice))
        changes.push(`цена: ${pp.purchasePrice}→${np.purchasePrice}`);
      if (changes.length) changed.push(`${np.name} (${changes.join(', ')})`);
    }

    if (added.length)   diffFields.push({ field: 'positions_added',   old: '', new: added.join('; ') });
    if (removed.length) diffFields.push({ field: 'positions_removed', old: removed.join('; '), new: '' });
    if (changed.length) diffFields.push({ field: 'positions_changed', old: '', new: changed.join('; ') });
    if (prevPos.length !== newPos.length) {
      diffFields.push({ field: 'positions_count', old: String(prevPos.length), new: String(newPos.length) });
    }
    if (String(prev.total) !== String(total)) {
      diffFields.push({ field: 'total', old: String(prev.total), new: String(total) });
    }
  }

  // Guard against spec_num collisions with a DIFFERENT request (same org only)
  if (r.specNum && r.specNum !== prev.spec_num) {
    const dup = query('SELECT id FROM requests WHERE spec_num=? AND org_id=? AND id!=?', [r.specNum, r.orgId||prev.org_id||'', req.params.id])[0];
    if (dup) return res.status(409).json({ error: `Спецификация с номером «${r.specNum}» уже существует у этой организации. Обновите страницу и попробуйте снова.` });
  }

  const ok = run(`UPDATE requests SET spec_num=?,org_id=?,org_full=?,org_short=?,org_signatory=?,org_stamp=?,bitrix=?,name=?,mol=?,date=?,address=?,supplier=?,invoice_num=?,contract=?,status=?,comment=?,is_realization=?,delivery_cost=?,markup=?,total_purchase=?,total=?,positions=?,doc_type=?,counterparty=?,warranty_period=?,round_to_ruble=?,updated_at=datetime('now') WHERE id=?`,
    [r.specNum||'', r.orgId||'', r.orgFull||'', r.orgShort||'', r.orgSignatory||'', r.orgStamp !== undefined ? (r.orgStamp?'1':'0') : '1',
     r.bitrix||'', r.name, r.mol||'', r.date||'', r.address||'', r.supplier||'', r.invoiceNum||'', r.contract||'',
     r.status||'new', r.comment||'', r.isRealization?1:0,
     r.deliveryCost||0, (r.markup!==undefined&&r.markup!==null?r.markup:5), totalPurchase, total,
     JSON.stringify(r.positions||[]), r.docType || 'goods', r.counterparty||'', r.warrantyPeriod||'', r.roundToRuble?1:0, req.params.id]);
  if (!ok) return res.status(500).json({ error: 'Не удалось сохранить заявку. Возможно, номер спецификации уже занят — обновите страницу и попробуйте снова.' });
  auditLog('UPDATE', req.params.id, 'request', null, r.specNum, { name: r.name, diff: diffFields }, req.username);
  res.json(rowToRequest(query('SELECT * FROM requests WHERE id=?', [req.params.id])[0]));
});

router.patch('/requests/:id/status', operatorOrAdmin, (req, res) => {
  const { status } = req.body;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Недопустимый статус. Допустимые: ${ALLOWED_STATUSES.join(', ')}` });
  }
  const old = query('SELECT status, spec_num, name, org_short, total FROM requests WHERE id=?', [req.params.id])[0];
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  if (!isValidStatusTransition(old.status, status, req.userRole)) {
    const allowed = STATUS_TRANSITIONS[old.status] || [];
    const allowedLabel = allowed.length ? allowed.join(', ') : 'нет (финальный статус)';
    return res.status(400).json({ error: `Недопустимый переход статуса: «${old.status}» → «${status}». Допустимо отсюда: ${allowedLabel}.` });
  }
  run("UPDATE requests SET status=?,updated_at=datetime('now') WHERE id=?", [status, req.params.id]);
  auditLog('STATUS', req.params.id, 'status', old.status, status, { specNum: old.spec_num }, req.username);

  // Fire status webhook asynchronously — don't block response
  (async () => {
    try {
      const whRows = getDb().exec("SELECT value FROM settings WHERE key='statusWebhook'");
      const webhookUrl = whRows[0]?.values?.[0]?.[0] || '';
      if (!webhookUrl) return;
      const payload = {
        event:    'status_changed',
        specNum:  old.spec_num,
        name:     old.name,
        org:      old.org_short,
        total:    old.total,
        oldStatus: old.status,
        newStatus: status,
        changedAt: new Date().toISOString(),
      };
      await sendStatusWebhook(webhookUrl, payload);
    } catch(e) { console.warn('[statusWebhook]', e.message); }
  })();

  res.json({ ok: true });
});

router.delete('/requests/:id', operatorOrAdmin, (req, res) => {
  const old = query('SELECT spec_num, name, signed_spec_pdf, invoice_file FROM requests WHERE id=?', [req.params.id])[0];
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  // Аудит-находка (26w36-b16): удаление заявки не подчищало прикреплённые
  // файлы с диска (signed_spec_pdf/invoice_file) — тот же класс проблемы,
  // что была у организаций (см. approval-pdf, исправлено раньше в этом же
  // аудите). Пропускаем legacy-формат (base64 прямо в колонке БД,
  // startsWith('data:') — см. routes/files.js) — там нечего удалять с
  // диска, эти байты уйдут вместе со строкой в БД.
  const cleanupFile = (dir, val) => {
    if (!val || val.startsWith('data:')) return;
    try { fs.unlinkSync(path.join(dir, path.basename(val))); }
    catch(e) { console.warn('[requests] Не удалось удалить прикреплённый файл при удалении заявки:', e.message); }
  };
  cleanupFile(SIGNED_DIR, old.signed_spec_pdf);
  cleanupFile(INVOICE_DIR, old.invoice_file);
  run('DELETE FROM requests WHERE id=?', [req.params.id]);
  auditLog('DELETE', req.params.id, null, old.spec_num, null, { name: old.name }, req.username);
  res.json({ ok: true });
});

// ── ADDRESSES / MOL ───────────────────────────────────────────────────────────
router.get('/mol', operatorOrAdmin, (req, res) => {
  const rows = query(`SELECT DISTINCT mol FROM requests WHERE mol != '' ORDER BY mol LIMIT 50`);
  res.json(rows.map(r => r.mol));
});

router.get('/addresses', operatorOrAdmin, (req, res) => {
  res.json(query('SELECT address FROM addresses ORDER BY used_at DESC LIMIT 30').map(r => r.address));
});

router.post('/addresses', operatorOrAdmin, (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  run(`INSERT INTO addresses (address, used_at) VALUES (?, datetime('now'))
       ON CONFLICT(address) DO UPDATE SET used_at=datetime('now')`, [address]);
  res.json({ ok: true });
});

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
router.get('/templates', operatorOrAdmin, (req, res) => {
  res.json(query('SELECT * FROM templates ORDER BY created_at DESC')
    .map(r => {
      let positions = [];
      try {
        const parsed = JSON.parse(r.positions || '[]');
        if (Array.isArray(parsed)) positions = parsed;
      } catch(e) {
        console.warn(`[templates] Битый JSON в positions шаблона ${r.id}, подставлен []:`, e.message);
      }
      return { ...r, positions };
    }));
});

router.post('/templates', operatorOrAdmin, (req, res) => {
  const { name, positions=[] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  db.run('INSERT INTO templates (name, positions) VALUES (?,?)', [name, JSON.stringify(positions)]);
  saveDb();
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  res.json({ id, name, positions });
});

router.delete('/templates/:id', operatorOrAdmin, (req, res) => {
  run('DELETE FROM templates WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
// Период для Dashboard (ROADMAP_Q4.md §11) — опциональный ?period=, ничего
// не передано → поведение как раньше (весь период, без фильтра). "today"/
// "week" ограничены сверху сегодняшним днём (иначе будущей датой попортить
// себе выборку — редкий, но реальный кейс ошибки при вводе даты). "month"/
// "year" — через LIKE-префикс, тот же приём, что уже был у thisMonth ниже.
function buildPeriodFilter(period) {
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now = new Date();
  if (period === 'today') {
    const t = iso(now);
    return { where: 'WHERE date >= ? AND date <= ?', params: [t, t] };
  }
  if (period === 'week') {
    const from = new Date(now); from.setDate(from.getDate() - 6);
    return { where: 'WHERE date >= ? AND date <= ?', params: [iso(from), iso(now)] };
  }
  if (period === 'month') {
    const ym = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
    return { where: 'WHERE date LIKE ?', params: [ym + '%'] };
  }
  if (period === 'quarter') {
    const from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    return { where: 'WHERE date >= ?', params: [iso(from)] };
  }
  if (period === 'year') {
    return { where: 'WHERE date LIKE ?', params: [`${now.getFullYear()}%`] };
  }
  return { where: '', params: [] }; // не распознан / не передан — весь период, как и раньше
}

router.get('/stats', (req, res) => {
  const { where, params: p } = buildPeriodFilter(req.query.period);
  const total    = query(`SELECT COUNT(*) as c, SUM(total) as s, SUM(total_purchase) as p FROM requests ${where}`, p)[0] || {};
  // thisMonth — отдельная, не завязанная на ?period= метрика (был счётчик
  // "заявок в этом месяце" ещё до Dashboard, менять его смысл вслед за
  // period не стал — сломал бы то, что уже показывает registry.js).
  const thisMonth = new Date().toISOString().slice(0,7);
  const month    = query("SELECT COUNT(*) as c FROM requests WHERE date LIKE ?", [thisMonth+'%'])[0] || {};
  const byOrg    = query(`SELECT org_short, COUNT(*) as count, SUM(total) as sell, SUM(total_purchase) as purchase, SUM(delivery_cost) as delivery FROM requests ${where} GROUP BY org_id ORDER BY sell DESC`, p);
  const byStatusRows = query(`SELECT status, COUNT(*) as c FROM requests ${where} GROUP BY status`, p);
  // Все статусы явно, даже с нулём — иначе на Dashboard карточка "Отменена"
  // просто исчезала бы вместо честного "0", если отменённых заявок в
  // выбранном периоде не нашлось.
  const byStatusMap = Object.fromEntries(byStatusRows.map(r => [r.status, r.c]));
  const byStatus = ALLOWED_STATUSES.map(s => ({ status: s, count: byStatusMap[s] || 0 }));
  // Динамика по месяцам — намеренно НЕ фильтруется по ?period= (это и есть
  // весь смысл тренда: видеть соседние месяцы для сравнения, а не только
  // выбранное окно). Последние 12 месяцев с данными, по возрастанию даты.
  const byMonth = query(`SELECT substr(date,1,7) as month, COUNT(*) as count, SUM(total) as sell, SUM(total_purchase) as purchase FROM requests GROUP BY month ORDER BY month DESC LIMIT 12`).reverse();
  res.json({
    totalRequests: total.c || 0,
    totalSell:     total.s || 0,
    totalPurchase: total.p || 0,
    thisMonth:     month.c || 0,
    byOrg,
    byStatus,
    byMonth,
  });
});

// Экспортирован как свойство роутера (не меняя module.exports = router,
// на который завязаны все существующие `app.use(...)`) — чтобы можно было
// протестировать напрямую, без поднятия HTTP-сервера ради чистой функции.
router.validatePositions = validatePositions;
router.isValidStatusTransition = isValidStatusTransition;
router.STATUS_TRANSITIONS = STATUS_TRANSITIONS;
router.buildPeriodFilter = buildPeriodFilter;
router.computeAuthoritativeTotals = computeAuthoritativeTotals;

module.exports = router;
