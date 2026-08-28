// ─── Org modal ───────────────────────────────────────────────────────────────
function openOrgModal(id) {
  const org = db.orgs.find(o => o.id === id);
  if (!org) return;
  document.getElementById('modal-org-id').value = org.id;
  document.getElementById('modal-org-full').value = org.full || '';
  document.getElementById('modal-org-short').value = org.short || '';
  document.getElementById('modal-org-signatory').value = org.signatory || '';
  document.getElementById('modal-org-contract').value = org.contract || '';
  document.getElementById('modal-org-address').value = org.address || '';
  document.getElementById('modal-org-folder').value = org.folder || '';
  document.getElementById('modal-org-stamp').checked = org.stamp === undefined ? true : (org.stamp === '1' || org.stamp === true);
  document.getElementById('org-modal').style.display = 'flex';
}

function closeOrgModal() {
  document.getElementById('org-modal').style.display = 'none';
}

async function saveOrgModal() {
  const id = document.getElementById('modal-org-id').value;
  const org = db.orgs.find(o => o.id === id);
  const data = {
    full:      document.getElementById('modal-org-full').value.trim(),
    short:     document.getElementById('modal-org-short').value.trim(),
    // Префикс больше не редактируется в UI (номер спецификации теперь
    // зависит от типа документа) — сохраняем прежнее значение как есть.
    prefix:    org?.prefix || '',
    signatory: document.getElementById('modal-org-signatory').value.trim(),
    contract:  document.getElementById('modal-org-contract').value.trim(),
    address:   document.getElementById('modal-org-address').value.trim(),
    folder:    document.getElementById('modal-org-folder').value.trim(),
    stamp:     document.getElementById('modal-org-stamp').checked ? '1' : '0',
  };
  if (!data.full || !data.short) { toast('Заполните обязательные поля'); return; }
  const updated = await api('PUT', '/api/orgs/' + id, data);
  const idx = db.orgs.findIndex(o => o.id === id);
  if (idx !== -1) db.orgs[idx] = updated;
  renderOrgs();
  populateOrgSelect();
  closeOrgModal();
  toast('Организация обновлена');
}

// Close modal on backdrop click
document.addEventListener('click', function(e) {
  const modal = document.getElementById('org-modal');
  if (e.target === modal) closeOrgModal();
});

// ── Logout ───────────────────────────────────────────────────────────────────
async function doLogout() {
  try { await api('POST', '/api/auth/logout'); } catch(e) {}
  authToken = '';
  userRole  = 'viewer';
  userName  = null;
  localStorage.removeItem('procure_token');
  updateRoleUI();
  // Переводим на реестр — гость не имеет права оставаться на страницах
  // config/new/orgs/about, которые требуют operator или admin.
  // showPage('registry') не вызываем напрямую чтобы не зависеть от порядка
  // загрузки скриптов — используем безопасный вызов через setTimeout.
  setTimeout(() => {
    if (typeof showPage === 'function') showPage('registry');
  }, 0);
  showLoginModal();
  toast('Вы вышли из системы');
}

// ─── Autocomplete ───────────────────────────────────────────────────────────
const acData = { mol: [], address: [] };
let acIdx = { mol: -1, address: -1 };

async function loadAcData() {
  const [mols, addrs] = await Promise.all([
    api('GET', '/api/mol').catch(() => []),
    api('GET', '/api/addresses').catch(() => [])
  ]);
  acData.mol = mols;
  acData.address = addrs;
}

function acMatches(key, val) {
  if (!val) return acData[key];
  const q = val.toLowerCase();
  return acData[key].filter(s => s.toLowerCase().includes(q));
}

function acHighlight(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return esc(text);
  return esc(text.slice(0, idx)) + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>' + esc(text.slice(idx + query.length));
}

function acRender(key) {
  const inp = document.getElementById(`f-${key}`);
  const drop = document.getElementById(`ac-${key}-drop`);
  const matches = acMatches(key, inp.value);
  acIdx[key] = -1;
  if (!matches.length) { drop.classList.remove('open'); return; }
  drop.innerHTML = matches.map((m, i) =>
    `<div class="ac-item" data-i="${i}" onmousedown="acPick('${key}','${escJsAttr(m)}')">
      ${acHighlight(m, inp.value)}
    </div>`
  ).join('');
  drop.classList.add('open');
}

function acFilter(key) { acRender(key); }

function acOpen(key) {
  // Добавляем onblur только для mol (address уже имеет)
  if (key === 'mol') {
    const inp = document.getElementById('f-mol');
    if (!inp._acBlur) {
      inp._acBlur = true;
      inp.addEventListener('blur', () => setTimeout(() => acClose('mol'), 180));
    }
  }
  acRender(key);
}

function acClose(key) {
  const drop = document.getElementById(`ac-${key}-drop`);
  if (drop) drop.classList.remove('open');
  acIdx[key] = -1;
  // Сохраняем адрес при закрытии
  if (key === 'address') saveAddress();
}

function acPick(key, val) {
  document.getElementById(`f-${key}`).value = val;
  acClose(key);
  if (key === 'address') saveAddress();
}

function acKey(e, key) {
  const drop = document.getElementById(`ac-${key}-drop`);
  const items = drop.querySelectorAll('.ac-item');
  if (!drop.classList.contains('open') || !items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acIdx[key] = Math.min(acIdx[key] + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acIdx[key] = Math.max(acIdx[key] - 1, 0);
  } else if (e.key === 'Enter' && acIdx[key] >= 0) {
    e.preventDefault();
    acPick(key, items[acIdx[key]].textContent.trim());
    return;
  } else if (e.key === 'Escape') {
    acClose(key); return;
  } else { return; }
  items.forEach((el, i) => el.classList.toggle('ac-active', i === acIdx[key]));
  if (acIdx[key] >= 0) items[acIdx[key]].scrollIntoView({ block: 'nearest' });
}

async function saveAddress() {
  const val = document.getElementById('f-address').value.trim();
  if (!val) return;
  await api('POST', '/api/addresses', { address: val }).catch(() => {});
  if (!acData.address.includes(val)) { acData.address.unshift(val); }
}

async function populateAddressList() {
  // Совместимость — обновляем данные через новую систему
  await loadAcData();
}


// ─── Org defaults ─────────────────────────────────────────────────────────────
function fillOrgDefaults() {
  const orgId = document.getElementById('f-org').value;
  const org = db.orgs.find(o => o.id === orgId);
  if (!org) return;

  // Fill contract if field is empty or was previously auto-filled
  const contractEl = document.getElementById('f-contract');
  if (org.contract) {
    contractEl.value = org.contract;
    const hint = document.getElementById('contract-hint');
    if (hint) hint.textContent = '↑ подставлен по умолчанию для ' + org.short;
  }

  // Fill address if field is empty
  const addrEl = document.getElementById('f-address');
  if (!addrEl.value && org.address) {
    addrEl.value = org.address;
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  new:       { label: '🆕 Новая',     cls: 'badge-blue'   },
  ordered:   { label: '📦 Заказано',  cls: 'badge-yellow' },
  partial:   { label: '🔄 Частично',  cls: 'badge-orange' },
  delivered: { label: '✅ Получено',  cls: 'badge-green'  },
  cancelled: { label: '❌ Отменена',  cls: 'badge-red'    },
};

function statusBadge(s) {
  const m = STATUS_MAP[s] || STATUS_MAP['new'];
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}

async function changeStatus(id, newStatus) {
  if (!newStatus || !STATUS_MAP[newStatus]) return;
  try {
    await api('PATCH', '/api/requests/' + id + '/status', { status: newStatus });
    renderRegistry();
    toast('Статус: ' + STATUS_MAP[newStatus].label);
  } catch(e) {
    toast('Ошибка смены статуса: ' + e.message);
    renderRegistry(); // revert select visually
  }
}
function buildFolderPath(req) {
  if (!req.date || !req.orgShort) return '';
  const d = new Date(req.date);
  const year = d.getFullYear();
  const monthName = RU_MONTHS[d.getMonth()];
  const org = req.orgShort;
  // порядковый номер в месяце из номера спецификации
  const numMatch = req.specNum ? req.specNum.match(/-(\d+)$/) : null;
  const num = numMatch ? parseInt(numMatch[1]) : '?';
  // Sanitize name for folder
  const safeName = (req.name || 'Заявка').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
  return `${year}\\${monthName}\\${org}\\${num}_${safeName}`;
}

function showFolderPath() {
  const req = collectForm();
  const path = buildFolderPath(req);
  if (!path) { toast('Выберите организацию и укажите дату'); return; }
  document.getElementById('folder-path-display').textContent = path;
  document.getElementById('folder-card').style.display = 'block';
  document.getElementById('folder-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function copyFolderPath() {
  const text = document.getElementById('folder-path-display').textContent;
  navigator.clipboard.writeText(text).then(() => toast('Путь скопирован')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('Путь скопирован');
  });
}

