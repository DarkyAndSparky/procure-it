/**
 * public/js/global-search.js
 *
 * Фаза 5, шаг 8: глобальный поиск по всем вкладкам, вынесенный из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 *
 * Своё приватное состояние (_gsTimer, _gsLastQuery) — не пересекается
 * с остальным приложением. Внешние зависимости — switchTab(), showDetail(),
 * esc(), ic() — остаются глобальными функциями в других файлах/index.html,
 * резолвятся в момент вызова (не в момент объявления), поэтому порядок
 * подключения скриптов не критичен.
 *
 * Фаза 6: onclick/onmouseenter/onmouseleave переведены на data-action
 * (event-delegation.js) + CSS-класс .hover-surface — нужно для CSP.
 * Заодно починен баг, найденный и задокументированный в Фазе 5: битый
 * onclick="event.stopPrshowDetail('${a.id}')tle=..." у кнопки "→" —
 * похоже, "event.stopPropagation()" был случайно разорван вставкой
 * "showDetail(...)". Восстановлено очевидно задуманное поведение
 * (stopPropagation + showDetail + title), т.к. эту же строку всё равно
 * приходилось трогать для конвертации onclick → data-action.
 */

// ─── ГЛОБАЛЬНЫЙ ПОИСК ────────────────────────────────────────────────────────
let _gsTimer = null;
let _gsLastQuery = '';

function globalSearchDebounce(q) {
  clearTimeout(_gsTimer);
  _gsTimer = setTimeout(() => runGlobalSearch(q.trim()), 280);
}

async function runGlobalSearch(q) {
  const resultsEl = document.getElementById('global-search-results');
  const clearBtn  = document.getElementById('global-search-clear');
  if (!resultsEl) return;

  if (!q || q.length < 2) {
    resultsEl.style.maxHeight = '0';
    resultsEl.style.marginTop = '0';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (clearBtn) clearBtn.style.display = '';
  _gsLastQuery = q;

  resultsEl.style.marginTop = '12px';
  resultsEl.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:4px 0">${t('msg_searching')}</div>`;
  resultsEl.style.maxHeight = '60px';

  try {
    const resp = await fetch(`${API}/api/assets/search?q=${encodeURIComponent(q)}`, { headers: ah() });
    if (!resp.ok) throw new Error(resp.status);
    const items = await resp.json();

    if (q !== _gsLastQuery) return; // устаревший результат

    if (!items.length) {
      resultsEl.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:6px 0">${t('msg_nothing_found_for', { q: esc(q) })}</div>`;
      resultsEl.style.maxHeight = '60px';
      return;
    }

    const TAB_LABEL = { os:t('nav_os'), small:t('nav_small'), infra:t('nav_infra') };

    // Группируем по вкладке
    const byTab = {};
    items.forEach(a => { (byTab[a.tab] = byTab[a.tab]||[]).push(a); });

    const rows = items.slice(0, 30).map(a => {
      const hl = (s) => {
        if (!s) return '—';
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
        return esc(s).replace(re, '<mark style="background:var(--mark-bg);border-radius:2px;padding:0 1px">$1</mark>');
      };
      return `<tr class="hover-surface" style="cursor:pointer" data-action="openAssetFromSearch" data-args='${JSON.stringify([a.tab, a.id])}'>
        <td style="white-space:nowrap">
          <span style="font-size:10px;padding:2px 6px;border-radius:10px;background:var(--surface);color:var(--muted)">${TAB_LABEL[a.tab]||a.tab}</span>
        </td>
        <td><code style="font-size:11px;color:var(--indigo)">${hl(a.inv||'—')}</code></td>
        <td style="font-size:12px">${ic(a.type)} ${hl(a.type)}</td>
        <td style="font-weight:600;font-size:13px">${hl(a.model)}</td>
        <td style="font-size:12px;color:var(--muted)">${hl(a.serial||'—')}</td>
        <td style="font-size:12px">${hl(a.responsible||'—')}</td>
        <td style="font-size:12px;color:var(--muted)">${esc(a.org||'—')} · ${esc(a.filial||'—')}</td>
        <td><span class="badge-s ${a.status==='используется'?'s-used':a.status==='резерв'?'s-reserve':'s-off'}">${esc(a.status)}</span></td>
        <td><button class="btn-icon" data-action="showDetail" data-args='${JSON.stringify([a.id])}' data-stop="1" title="${t('tooltip_open_card')}">→</button></td>
      </tr>`;
    }).join('');

    const moreNote = items.length > 30
      ? `<tr><td colspan="9" style="text-align:center;color:var(--muted);font-size:12px;padding:8px">
           ${t('msg_showing_first_30', { n: items.length })}
         </td></tr>`
      : '';

    resultsEl.innerHTML = `
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">
        ${t('msg_found_records', { n: items.length, q: esc(q) })}
      </div>
      <div class="tbl-wrap" style="border-radius:8px;border:1px solid var(--border)">
        <table style="font-size:13px">
          <thead><tr><th>${t('th_tab')}</th><th>${t('th_inv_no')}</th><th>${t('th_type')}</th><th>${t('th_model')}</th><th>${t('th_serial_no')}</th><th>${t('th_responsible')}</th><th>${t('th_org_filial')}</th><th>${t('th_status')}</th><th></th></tr></thead>
          <tbody>${rows}${moreNote}</tbody>
        </table>
      </div>`;
    resultsEl.style.maxHeight = '600px';

  } catch(e) {
    resultsEl.innerHTML = `<div style="color:var(--noInv-text);font-size:13px">${t('msg_search_error', { msg: e.message })}</div>`;
    resultsEl.style.maxHeight = '60px';
  }
}

function clearGlobalSearch() {
  const inp = document.getElementById('global-search-inp');
  const resultsEl = document.getElementById('global-search-results');
  const clearBtn = document.getElementById('global-search-clear');
  if (inp) inp.value = '';
  if (resultsEl) { resultsEl.style.maxHeight='0'; resultsEl.style.marginTop='0'; }
  if (clearBtn) clearBtn.style.display = 'none';
  _gsLastQuery = '';
}

function openAssetFromSearch(tab, id) {
  // Переходим на нужную вкладку и открываем карточку
  clearGlobalSearch();
  switchTab(tab);
  setTimeout(() => showDetail(id), 450);
}
