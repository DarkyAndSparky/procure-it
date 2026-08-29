/**
 * public/js/views/csv-import.js
 *
 * Хвост Фазы 5/6: клиентский разбор и импорт CSV (детект типа файла +
 * сам парсер оборудования), вынесенный из inline-скрипта в index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 * Самый большой из оставшихся кусков (справочники нормализации типов,
 * фоллбек-списки infra/small, статистика по коллекциям).
 */

let _importType = null; // 'assets' | 'history'
function detectImportType() {
  // Фаза 6: было onchange="detectImportType(this)" — теперь при делегировании
  // через data-onchange-action this уже === элемент (fn.apply(el, args)).
  const input = this;
  _importType = null;
  document.getElementById('import-btn').disabled = true;
  document.getElementById('import-type-hint').style.display = 'none';
  document.getElementById('import-result').innerHTML = '';
  document.getElementById('import-progress').style.display = 'none';
  document.getElementById('import-csv-options').style.display = 'none';
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const first = e.target.result.replace(/^\uFEFF/, '').split('\n')[0] || '';
    const headers = first.toLowerCase();
    const hint = document.getElementById('import-type-hint');
    hint.style.display = 'block';
    if (headers.includes('от кого') || headers.includes('from_who') || headers.includes('тип события')) {
      _importType = 'history';
      hint.innerHTML = t('msg_hint_history');
      hint.style.color = '#6366f1';
    } else if (headers.includes('модель') || headers.includes('model') || headers.includes('вкладка') || headers.includes('тип')) {
      _importType = 'assets';
      hint.innerHTML = t('msg_hint_assets');
      hint.style.color = '#059669';
      // BUG-3: раньше create_orgs/create_employees всегда молча были
      // включены (сервер трактует "не передано" как "создавать") — теперь
      // пользователь явно видит и может выключить это перед импортом.
      document.getElementById('import-csv-options').style.display = 'block';
    } else {
      hint.innerHTML = t('msg_hint_unknown_type');
      hint.style.color = '#dc2626';
      return;
    }
    document.getElementById('import-btn').disabled = false;
  };
  reader.readAsText(file.slice(0, 2048), 'utf-8');
}

async function importAuto() {
  if (_importType === 'history') await importHistory();
  else if (_importType === 'assets') await importCSV();
  else toast(t('msg_choose_file'), 'error');
}

async function importCSV() {
  const file=document.getElementById('csv-file').files[0];
  if (!file) return toast(t('msg_choose_file'),'error');
  const setProgress=(pct,label)=>{
    document.getElementById('import-progress').style.display='block';
    document.getElementById('import-progress-bar').style.width=pct+'%';
    document.getElementById('import-progress-label').textContent=label;
  };
  const btn=document.getElementById('import-btn');
  btn.disabled=true;
  document.getElementById('import-result').innerHTML='';
  setProgress(5,t('msg_reading_file'));
  const text=await file.text();
  const lines=text.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim());
  if (lines.length<2){btn.disabled=false;document.getElementById('import-progress').style.display='none';return toast(t('msg_empty_file'),'error');}
  setProgress(20,t('msg_parsing_rows'));
  const sep=lines[0].includes(';')?';':',';
  function parseRow(line){const res=[];let cur='',inQ=false;
    for(let i=0;i<line.length;i++){const c=line[i];
      if(c==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
      else if(c===sep&&!inQ){res.push(cur);cur='';}else cur+=c;}
    res.push(cur);return res;}
  const headers=parseRow(lines[0]).map(h=>h.trim().toLowerCase());
  const MAP={'инв. номер':'inv','вкладка':'tab','tab':'tab','коллекция':'category','category':'category',
    'филиал':'filial','расположение':'location','ответственный':'responsible',
    'тип':'type','модель':'model','серийный №':'serial','статус':'status',
    'организация':'org','примечание':'note','ip':'ip','mac':'mac',
    'подсеть':'subnet','winbox/url':'winbox','логин':'login','пароль':'password',
    'hostname':'hostname','картриджи':'cartridge','прошивка':'firmware','инв шкаф':'cabinet'};
  // ── Загружаем маппинг тип→коллекция с сервера ────────────────────────────────
  let _typeTabMap = {};
  let _typeNormMap = {};
  try {
    const codes = await fetch(`${API}/api/type-codes`, { headers: ah() }).then(r=>r.json());
    codes.forEach(t => {
      const key = t.name.trim().toLowerCase();
      _typeTabMap[key]  = t.tab  || 'os';
      _typeNormMap[key] = t.name.trim();
    });
  } catch(e) {}

  // Фоллбек если сервер не ответил или тип не в справочнике
  const INFRA_FALLBACK = new Set([
    'коммутатор','маршрутизатор','точка доступа','радиомост',
    'видеорегистратор','камера','ибп','сервер','poe hub','poe-hub','poe инжектор',
    'роутер','свитч','вызывная панель','видеодомофон','dvr','nvr','ups',
    'точка_доступа','wifi роутер','межсетевой экран','firewall','nas','san',
  ]);
  const SMALL_FALLBACK = new Set([
    'мышь','компьютерная мышь','комп мышь','клавиатура','клавиатура+мышь',
    'гарнитура','наушники','колонки','спикерфон',
    'web камера','веб.камера','веб камера','вебкамера',
    'usb-hub','usb hub','usb адаптер','usb wifi adapter',
    'патч-корд','патчкорд','кабель hdmi','кабель',
    'сетевой фильтр','удлинитель',
    'адаптер','адаптер dvi','адаптер dvi-d - hdmi','адаптер dvi-d',
    'ssd','hdd','жёсткий диск','жестский диск','жесткий диск','ssd/hdd',
    'смартфон','телефон','планшет',
    'кронштейн','кронштейн для 1 мон','кронштейн для 2x мон',
    'стилус','сумка','чехол','защитное стекло',
    'я. станция','яндекс станция','яндекс.станция',
    'тсд','сканер',
  ]);

  // Нормализация написания — приводим к каноническому из справочника
  const NORM_OVERRIDE = {
    'комп мышь':'Компьютерная мышь',
    'web камера':'Web камера','веб.камера':'Web камера','веб камера':'Web камера',
    'точка доступа':'Точка доступа','коммутатор':'Коммутатор','свитч':'Коммутатор',
    'маршрутизатор':'Маршрутизатор','роутер':'Маршрутизатор',
    'сервер':'Сервер','ибп':'ИБП','ups':'ИБП',
    'радиомост':'Радиомост','патч-корд':'Патч-корд','патчкорд':'Патч-корд',
    'ноутбук':'Ноутбук','системный блок':'Системный блок',
    'монитор':'Монитор','мфу':'МФУ','телевизор':'Телевизор',
    'смартфон':'Смартфон','планшет':'Планшет','мини пк':'Мини ПК',
    'жёсткий диск':'SSD/HDD','жестский диск':'SSD/HDD','жесткий диск':'SSD/HDD','ssd':'SSD/HDD',
    'видеорегистратор':'Видеорегистратор',
    'poe hub':'PoE инжектор','poe-hub':'PoE инжектор',
    'usb-hub':'USB-hub','usb hub':'USB-hub',
    'usb адаптер':'USB-hub','usb wifi adapter':'USB-hub',
    'адаптер dvi-d - hdmi':'Адаптер','адаптер dvi-d':'Адаптер','адаптер dvi':'Адаптер',
    'кронштейн для 1 мон':'Кронштейн','кронштейн для 2x мон':'Кронштейн',
    'я. станция':'Колонки','яндекс станция':'Колонки',
    'клавиатура+мышь':'Клавиатура',
    'кабель hdmi':'Патч-корд',
  };

  function _autoTab(row) {
    const typeKey = (row.type||'').trim().toLowerCase();
    // 1. Смотрим в справочник с сервера (точное совпадение)
    if (_typeTabMap[typeKey]) return _typeTabMap[typeKey];
    // 2. Фоллбек-списки
    if (INFRA_FALLBACK.has(typeKey)) return 'infra';
    if (SMALL_FALLBACK.has(typeKey)) return 'small';
    // 3. Явная колонка Вкладка
    const explicit = (row.tab||'').trim().toLowerCase();
    if (['os','small','infra'].includes(explicit)) return explicit;
    return 'os';
  }

  function _normType(type) {
    const key = type.trim().toLowerCase();
    // Сначала нормализация из справочника, затем override
    return _typeNormMap[key] || NORM_OVERRIDE[key] || type.trim();
  }

  const rows=lines.slice(1).map(l=>{
    const vals=parseRow(l);const row={};
    headers.forEach((h,i)=>{const k=MAP[h];if(k)row[k]=vals[i]||'';});
    if (!row.model) return null;
    row._origType = row.type || '';
    row.tab  = _autoTab(row);
    row.type = _normType(row.type || '');
    return row;}).filter(Boolean);
  if (!rows.length){btn.disabled=false;document.getElementById('import-progress').style.display='none';return toast(t('msg_no_data'),'error');}
  // Сводка по коллекциям
  const tabCount = rows.reduce((a,r)=>{a[r.tab]=(a[r.tab]||0)+1;return a;},{});
  const tabSummary = Object.entries(tabCount).map(([tb,n])=>`${tabLabel(tb)}: <b>${n}</b>`).join(' &nbsp;·&nbsp; ');

  // Ищем типы не найденные в справочнике — предупреждение
  const unknownTypes = {};
  rows.forEach(r => {
    const key = (r._origType||r.type||'').trim().toLowerCase();
    if (!_typeTabMap[key] && !INFRA_FALLBACK.has(key) && !SMALL_FALLBACK.has(key) && r.tab === 'os') {
      unknownTypes[r._origType||r.type] = (unknownTypes[r._origType||r.type]||0)+1;
    }
  });
  const unknownList = Object.entries(unknownTypes).sort((a,b)=>b[1]-a[1]);

  const resultEl = document.getElementById('import-result');
  if (unknownList.length) {
    resultEl.innerHTML = `<div style="background:var(--warn-bg);border:1px solid var(--warn-border);border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:8px">
      ${t('msg_unknown_types_warning', { n: unknownList.length })}
      <span style="color:var(--warn-text)">${unknownList.map(([tp,n])=>`${tp} (${n})`).join(', ')}</span>
    </div>`;
  }

  setProgress(40,t('msg_found_records', { n: rows.length, summary: tabSummary }));
  // animate bar from 40 to 85 while waiting for server
  let animPct=40;
  const anim=setInterval(()=>{
    if(animPct<85){animPct+=0.5;document.getElementById('import-progress-bar').style.width=animPct+'%';}
  },80);
  const r=await fetch(`${API}/api/import/csv`,{method:'POST',headers:ah(),body:JSON.stringify({
    rows,
    create_orgs: document.getElementById('import-create-orgs')?.checked !== false,
    create_employees: document.getElementById('import-create-employees')?.checked !== false,
  })});
  clearInterval(anim);
  const d=await r.json();
  btn.disabled=false;
  if (r.ok){
    setProgress(100,t('msg_import_done', { added: d.added, skipped: d.skipped }));
    document.getElementById('import-progress-bar').style.background='linear-gradient(90deg,#10b981,#059669)';
    const sr = d.skipReasons || {};
    const skipDetail = d.skipped > 0 ? [
      sr.dupe_serial > 0 ? `${t('msg_dupe_serial')}: ${sr.dupe_serial}` : '',
      sr.dupe_key    > 0 ? `${t('msg_dupe_key')}: ${sr.dupe_key}` : '',
      sr.no_model    > 0 ? `${t('msg_no_model')}: ${sr.no_model}` : '',
    ].filter(Boolean).join(', ') : '';
    const skipHtml = d.skipped > 0
      ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${t('msg_skipped_detail', { n: d.skipped, detail: skipDetail })}</div>`
      : '';
    const invHtml = d.inv_assigned > 0
      ? `<div style="font-size:11px;color:#059669;margin-top:4px">${t('msg_inv_auto_assigned', { n: d.inv_assigned })}</div>`
      : '';
    const orgsHtml = d.created_orgs && d.created_orgs.length
      ? `<div style="font-size:11px;color:var(--info-text);margin-top:4px">${t('msg_orgs_created', { n: d.created_orgs.length, list: d.created_orgs.join(', ') })}</div>`
      : '';
    document.getElementById('import-result').innerHTML=`
      <div style="display:flex;align-items:center;gap:6px;color:#065f46;font-weight:600">
        ${t('msg_added_count', { n: d.added })}
      </div>${invHtml}${orgsHtml}${skipHtml}`;
    toast(t('msg_imported_count', { n: d.added }),'success');
    setTimeout(()=>{ if(currentTab==='dashboard') renderDashboard(); },800);
  } else {
    setProgress(100,t('msg_import_error'));
    document.getElementById('import-progress-bar').style.background='#ef4444';
    toast(d.error||t('msg_error'),'error');
  }
}
