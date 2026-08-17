// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Уязвимость (найдена при аудите): esc() экранирует только & < > " — этого
// достаточно для текстового содержимого и для значений внутри обычных
// HTML-атрибутов (двойные кавычки). Но в этом проекте много мест вида
//   onclick="doSomething('${value}')"
// где значение подставляется ВНУТРЬ одинарных кавычек JS-строки, которая
// сама лежит внутри двойных кавычек HTML-атрибута — то есть ДВА вложенных
// контекста экранирования. esc() не трогает одинарные кавычки, поэтому
// значение вида  XSS');alert(1);//  реально вырывалось из JS-строки и
// выполнялось как код при клике — подтверждено на практике (specNum,
// username и т.д. — все обычные текстовые поля, доступные оператору).
// escJsAttr() экранирует сначала для JS-строкового контекста (\ и '),
// затем результат — для HTML-атрибута (esc()). Использовать для ЛЮБОГО
// значения, подставляемого в '...' внутри onclick/onchange/onmousedown и т.п.
function escJsAttr(s) {
  return esc(String(s||'').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// Парсинг числа из поля ввода — убирает пробелы и неразрывные пробелы (вставка из буфера)
function parseNum(val) {
  if (val === null || val === undefined) return 0;
  return parseFloat(String(val).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')) || 0;
}

function fmtRub(n) {
  if (isNaN(n)) return '0,00';
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function numToWords(n) {
  // Simple Russian number-to-words for rubles
  const r = Math.floor(n);
  const k = Math.round((n - r) * 100);
  const ones = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
  const ones_f = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];

  function chunk(n, female) {
    let s = '';
    const h = Math.floor(n/100); n %= 100;
    s += hundreds[h] ? hundreds[h]+' ' : '';
    if (n >= 10 && n < 20) { s += teens[n-10]+' '; }
    else {
      s += tens[Math.floor(n/10)] ? tens[Math.floor(n/10)]+' ' : '';
      n %= 10;
      s += (female ? ones_f[n] : ones[n]) ? (female ? ones_f[n] : ones[n])+' ' : '';
    }
    return s;
  }

  function rubWord(n) {
    const n2 = n % 100; const n1 = n % 10;
    if (n2 >= 11 && n2 <= 19) return 'рублей';
    if (n1 === 1) return 'рубль';
    if (n1 >= 2 && n1 <= 4) return 'рубля';
    return 'рублей';
  }
  function kopWord(n) {
    const n2 = n % 100; const n1 = n % 10;
    if (n2 >= 11 && n2 <= 19) return 'копеек';
    if (n1 === 1) return 'копейка';
    if (n1 >= 2 && n1 <= 4) return 'копейки';
    return 'копеек';
  }

  let result = '';
  const millions = Math.floor(r / 1000000);
  const thousands = Math.floor((r % 1000000) / 1000);
  const rubs = r % 1000;

  if (millions) {
    result += chunk(millions, false);
    const m2 = millions%100; const m1 = millions%10;
    if (m2>=11&&m2<=19) result += 'миллионов ';
    else if (m1===1) result += 'миллион ';
    else if (m1>=2&&m1<=4) result += 'миллиона ';
    else result += 'миллионов ';
  }
  if (thousands) {
    result += chunk(thousands, true);
    const t2 = thousands%100; const t1 = thousands%10;
    if (t2>=11&&t2<=19) result += 'тысяч ';
    else if (t1===1) result += 'тысяча ';
    else if (t1>=2&&t1<=4) result += 'тысячи ';
    else result += 'тысяч ';
  }
  if (rubs || !result) {
    result += chunk(rubs, false);
  }

  result = result.trim();
  if (!result) result = 'ноль';
  result = result.charAt(0).toUpperCase() + result.slice(1);
  result += ' ' + rubWord(r);

  // Копейки — тоже прописью (женский род: одна, две)
  let kopStr = '';
  if (k === 0) {
    kopStr = 'ноль';
  } else {
    kopStr = chunk(k, true).trim();
    if (!kopStr) kopStr = 'ноль';
  }
  kopStr = kopStr.charAt(0).toUpperCase() + kopStr.slice(1);
  result += ' ' + kopStr + ' ' + kopWord(k);
  return result;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function startRealization() {
  clearForm();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-new-real')?.classList.add('active');
  // Set realization org — prefer an org matching the configured supplier
  // (по умолчанию подставляем поставщика, но выбор остаётся свободным),
  // иначе — организация с префиксом 'ИП', иначе — первая в списке
  const supplierName = (appConfig.supplierName || '').toLowerCase().trim();
  const supplierOrg = supplierName
    ? db.orgs.find(o => (o.full||'').toLowerCase().includes(supplierName) || (o.short||'').toLowerCase().includes(supplierName) || supplierName.includes((o.short||'').toLowerCase()))
    : null;
  const ipOrg = supplierOrg || db.orgs.find(o => (o.short||'').toUpperCase().startsWith('ИП') || (o.full||'').toUpperCase().startsWith('ИП')) || db.orgs[0];
  if (ipOrg) { document.getElementById('f-org').value = ipOrg.id; syncOrgSearchDisplay(); }
  updateSpecNum();

  // Show badge
  document.getElementById('realization-badge').style.display = 'flex';

  // Update comment column header
  const th = document.querySelector('#page-new table thead th:nth-child(4)');
  if (th) { th.textContent = 'ЮЛ / Получатель'; th.style.color = 'var(--accent)'; }

  // Hide spec number sub (no spec in realization mode)
  document.getElementById('spec-num-sub').textContent = 'Спецификация не формируется';

  showPage('new');
  // Re-render existing rows with org select instead of text
  const body = document.getElementById('positions-body');
  body.innerHTML = '';
  rowCounter = 0;
  addRow('', 1, 'шт', 0, '', 0, '', '');
  toast('Режим реализации: ЮЛ указывается на каждую строку');
}

function stopRealization() {
  document.getElementById('realization-badge').style.display = 'none';
  const th = document.querySelector('#page-new table thead th:nth-child(4)');
  if (th) { th.textContent = 'Комментарий / ФИО'; th.style.color = ''; }
  clearForm();
  toast('Обычный режим закупки');
}

function cancelEdit() {
  editingId = null;
  setEditingState(false);
  clearForm();
  toast('Редактирование отменено');
}

