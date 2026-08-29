/**
 * public/js/router.js
 *
 * Фаза 5, шаг 9: диспетчер вкладок (switchTab, render), вынесенный из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 *
 * ВАЖНО: сами реализации renderDashboard/renderHistory/renderAccounts/
 * renderAlerts/renderSettings/renderAssetTab пока ОСТАЮТСЯ в index.html —
 * это весь view-слой приложения, отдельная большая задача. render() их
 * просто вызывает по имени, что безопасно для classic-скриптов: имя
 * резолвится в момент ВЫЗОВА (когда пользователь кликнул вкладку), а не
 * в момент объявления функции — к этому моменту все синхронные скрипты
 * уже отработали и renderXxx уже определены, независимо от того, в каком
 * файле они физически лежат.
 *
 * Единственный синхронный top-level вызов в этой группе — render() в самом
 * конце index.html; он тоже безопасен по той же причине (router.js
 * подключается раньше и уже определил render() к этому моменту).
 */

function switchTab(tab) {
  const _protected = ['os','small','infra','history','accounts','alerts','settings'];
  if (_protected.includes(tab) && !currentUser) {
    toast(t('msg_login_required'), 'error');
    return;
  }
  currentTab=tab; currentCat=''; searchVal=''; fOrg='Все'; fFilial='Все'; fStatus='Все'; sortCol=''; sortDir=1;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  render();
}
async function render() {
  // Загружаем название компании и версию
  try {
    const s = await fetch(`${API}/api/settings`).then(r=>r.json());
    if (s.company_name) {
      _updateLogoEl(s.company_name, s.logo_svg || '');
    }
    if (s.version) {
      const v = s.version
        .replace(/^alpha-(\d+)-/, 'α$1 · ')
        .replace(/^beta-(\d+)-/,  'β$1 · ')
        .replace(/-/g,'·');
      _appVersion = v;
      const verEl = document.getElementById('app-version');
      if (verEl) verEl.textContent = v;
      const verEl2 = document.getElementById('app-version-detail');
      if (verEl2) verEl2.textContent = v;
    }
  } catch(e) {}
  try {
    if (!catsCache.os) {
      [catsCache, invCodes] = await Promise.all([
        fetch(`${API}/api/categories`, { headers: ah() }).then(r=>r.json()).catch(()=>({os:['Оборудование пользователей','Оргтехника','Мини ПК'],small:['Периферия','Гарнитуры','Колонки'],infra:['Сетевое оборудование','Wi-Fi','Принтеры','Видеонаблюдение','ИБП','Серверы']})),
        fetch(`${API}/api/inv/codes`, { headers: ah() }).then(r=>r.json()).catch(()=>({orgs:{},types:{}}))
      ]);
    }
    if (currentTab==='dashboard') return await renderDashboard();
    if (currentTab==='history')   return await renderHistory();
    if (currentTab==='accounts')  return await renderAccounts();
    if (currentTab==='alerts')    return await renderAlerts();
    if (currentTab==='settings')  return await renderSettings();
    await renderAssetTab(currentTab);
  } catch(e) {
    console.error('render() error:', e);
    document.getElementById('app').innerHTML = `<div class="card" style="max-width:500px">
      <div style="color:var(--danger-text);font-weight:700;margin-bottom:8px">❌ Ошибка отображения</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px">${esc(String(e.message||e))}</div>
      <button class="btn btn-primary" data-action="render">🔄 Обновить</button>
    </div>`;
  }
}
