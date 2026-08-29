/**
 * public/js/views/accounts.js
 *
 * Фаза 5, шаг 12: экран "Учётные записи" целиком (не только render,
 * но и CRUD-модалки — это одна цельная фича), вынесенный из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 */

const ACC_CATEGORIES = ['Сетевое оборудование','Принтеры','Планшеты / Телефоны','Серверы / NAS','Облачные сервисы','Прочее'];

// Фаза 6: было onclick="if(this.classList.contains('revealed')){...}else{...}" —
// самомодифицирующий переключатель показа пароля, выношу в именованную функцию.
function _togglePasswordReveal() {
  if (this.classList.contains('revealed')) {
    this.textContent = '••••••';
    this.classList.remove('revealed');
  } else {
    this.textContent = this.dataset.v;
    this.classList.add('revealed');
  }
}

async function renderAccounts() {
  const app=document.getElementById('app');
  if (!canEdit()) {
    app.innerHTML=`<div class="card" style="max-width:400px;text-align:center;padding:40px">
      <div style="font-size:40px;margin-bottom:14px">🔑</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:8px">${t('section_protected')}</div>
      <div style="color:var(--muted);margin-bottom:18px;font-size:14px">${t('msg_login_to_edit')}</div>
      <button class="btn btn-primary" data-action="toggleAuth">${t('btn_login')}</button></div>`;
    return;
  }
  app.innerHTML='<div class="spinner"></div>';
  const accs=await fetch(`${API}/api/accounts`,{headers:ah()}).then(r=>r.json());

  // Группируем по category
  const groups = {};
  accs.forEach(a => {
    const cat = a.category || 'Прочее';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(a);
  });

  const catOrder = [...ACC_CATEGORIES, ...Object.keys(groups).filter(k => !ACC_CATEGORIES.includes(k))];
  const sortedGroups = catOrder.filter(c => groups[c]);

  const catIcons = {
    'Сетевое оборудование':'🌐','Принтеры':'🖨','Планшеты / Телефоны':'📱',
    'Серверы / NAS':'🖥','Облачные сервисы':'☁️','Прочее':'🔑'
  };

  app.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:16px;font-weight:700">${t('modal_accounts_title', { n: accs.length })}</div>
      <button class="btn btn-primary btn-sm" data-action="showAddAccount">${t('btn_add')}</button>
    </div>
    <div style="background:var(--surface2);border:1px solid var(--border);border-left:3px solid #6366f1;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--muted);display:flex;gap:10px;align-items:flex-start">
      <span style="font-size:16px;flex-shrink:0">ℹ️</span>
      <div>
        ${t('msg_accounts_info')}
      </div>
    </div>
    ${sortedGroups.map(cat => `
    <div class="card" style="margin-bottom:14px;padding:0;overflow:hidden">
      <div style="padding:10px 16px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">${catIcons[cat]||'🔑'}</span>
        <span style="font-weight:700;font-size:14px">${esc(cat)}</span>
        <span style="color:var(--muted);font-size:12px">(${groups[cat].length})</span>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>${t('field_name')}</th><th>${t('field_login')}</th><th>${t('field_password')}</th><th>${t('field_note')}</th><th></th></tr></thead>
        <tbody>${groups[cat].map(a=>`<tr>
          <td><b>${esc(a.name)}</b></td>
          <td class="mono">
            ${a.login ? `<span style="display:inline-flex;align-items:center;gap:4px">
              ${esc(a.login)}
              <button class="btn-icon" style="font-size:11px;padding:1px 4px" title="${t('tooltip_copy_login')}"
                data-action="copyToClipboard" data-args='${JSON.stringify([a.login, t('msg_login_copied')])}'>⎘</button>
            </span>` : (a.has_login ? `<span title="${t('tooltip_no_access')}" style="color:var(--muted)">🔒</span>` : '—')}
          </td>
          <td>
            <span style="display:inline-flex;align-items:center;gap:4px">
              ${a.password !== undefined ? `
              <span class="pw-mask mono" title="${t('tooltip_click_to_reveal')}"
                data-action="_togglePasswordReveal"
                data-v="${esc(a.password)}">${a.password?'••••••':'—'}</span>
              ${a.password ? `<button class="btn-icon" style="font-size:11px;padding:1px 4px" title="${t('tooltip_copy_password')}"
                data-action="copyToClipboard" data-args='${JSON.stringify([a.password, t('msg_password_copied')])}'>⎘</button>` : ''}
              ` : (a.has_password ? `<span title="${t('tooltip_no_access')}" style="color:var(--muted)">🔒</span>` : '—')}
            </span>
          </td>
          <td style="color:var(--muted);font-size:12px">${esc(a.note)}</td>
          <td style="white-space:nowrap">
            <button class="btn-icon" data-action="showEditAccount" data-args='${JSON.stringify([a.id, esc(a.name), esc(a.login||""), esc(a.password!==undefined?a.password:""), esc(a.note), esc(a.category||""), a.password===undefined])}' title="${t('btn_edit')}">✏️</button>
            <button class="btn-icon" data-action="deleteAccount" data-args='${JSON.stringify([a.id])}' title="${t('btn_delete')}">🗑</button>
          </td></tr>`).join('')}
        </tbody></table></div>
    </div>`).join('')}`;
}

function _accCategorySelect(selected='') {
  return `<select id="ac-cat" style="width:100%">
    <option value="">${t('opt_select_type')}</option>
    ${ACC_CATEGORIES.map(c=>`<option value="${c}" ${selected===c?'selected':''}>${c}</option>`).join('')}
  </select>`;
}

function showAddAccount() {
  showModal(`<h2>${t('modal_add_account_title')}</h2>
    <div class="form-row"><label>${t('field_type_required')}</label>${_accCategorySelect()}</div>
    <div class="form-row"><label>${t('field_name_required')}</label><input id="ac-name" placeholder="${t('msg_account_name_placeholder')}"/></div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_login')}</label><input id="ac-login"/></div>
      <div class="form-row"><label>${t('field_password')}</label><input id="ac-pwd" type="text"/></div>
    </div>
    <div class="form-row"><label>${t('field_note')}</label><input id="ac-note" placeholder="${t('msg_account_note_placeholder')}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAddAccount">${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doAddAccount() {
  const data={
    category:document.getElementById('ac-cat').value.trim(),
    name:document.getElementById('ac-name').value.trim(),
    login:document.getElementById('ac-login').value.trim(),
    password:document.getElementById('ac-pwd').value.trim(),
    note:document.getElementById('ac-note').value.trim()
  };
  if (!data.category) return toast(t('msg_select_type'),'error');
  if (!data.name) return toast(t('msg_enter_name'),'error');
  const r=await fetch(`${API}/api/accounts`,{method:'POST',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_added'),'success');renderAccounts();}
  else toast(t('msg_error'),'error');
}
function showEditAccount(id,name,login,pwd,note,category,noAccess) {
  showModal(`<h2>${t('modal_edit_account_title')}</h2>
    <div class="form-row"><label>${t('field_type')}</label>${_accCategorySelect(category)}</div>
    <div class="form-row"><label>${t('field_name')}</label><input id="ae-name" value="${name}"/></div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_login')}</label><input id="ae-login" value="${login}" ${noAccess?`disabled placeholder="${t('msg_no_access_placeholder')}"`:''}/></div>
      <div class="form-row"><label>${t('field_password')}</label><input id="ae-pwd" type="text" value="${pwd}" ${noAccess?`disabled placeholder="${t('msg_no_access_placeholder')}"`:''}/></div>
    </div>
    ${noAccess ? `<div style="font-size:11px;color:var(--muted);margin:-6px 0 8px">${t('msg_no_access_note')}</div>` : ''}
    <div class="form-row"><label>${t('field_note')}</label><input id="ae-note" value="${note}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doEditAccount" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doEditAccount(id) {
  const data={
    category:document.getElementById('ac-cat').value.trim(),
    name:document.getElementById('ae-name').value.trim(),
    login:document.getElementById('ae-login').value.trim(),
    password:document.getElementById('ae-pwd').value.trim(),
    note:document.getElementById('ae-note').value.trim()
  };
  const r=await fetch(`${API}/api/accounts/${id}`,{method:'PUT',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_saved'),'success');renderAccounts();}
  else toast(t('msg_error'),'error');
}
async function deleteAccount(id) {
  if (!confirm(t('msg_confirm_delete_account'))) return;
  const r = await fetch(`${API}/api/accounts/${id}`,{method:'DELETE',headers:ah()});
  if (r.ok) { toast(t('msg_deleted')); renderAccounts(); }
  else toast(t('msg_delete_error'),'error');
}
