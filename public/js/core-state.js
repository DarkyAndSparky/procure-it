/**
 * public/js/core-state.js
 *
 * Хвост Фазы 5/6: последний оставшийся кусок inline-JS в index.html —
 * глобальные переменные состояния приложения + пара мелких функций
 * поиска, которые их используют. Classic script — та же причина, что и
 * в остальных файлах (см. auth.js). Нужен для CSP: это был последний
 * inline <script> без src в index.html, script-src 'self' без
 * unsafe-inline его бы заблокировал.
 */

const API = '';
let authPassword = null;
let currentUser = null; // { id, name, role }
let currentTab = 'dashboard';
let currentCat = '';
let assetsCache = [];
let catsCache = {};
let searchVal = '', fOrg = 'Все', fFilial = 'Все', fStatus = 'Все';
let sortCol = '', sortDir = 1; // 1=asc, -1=desc
let currentPage  = 1;
const PAGE_SIZE  = 50;
let selectedIds  = new Set();
let _companyName = ''; // кэш названия компании
let _appVersion  = ''; // кэш версии приложения
let _searchTimer = null;

function onSearchInput(val, tab) {
  searchVal = val;
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    renderAssetTab(tab).then(() => {
      const inp = document.querySelector('.search-inp');
      if (inp) inp.focus();
    });
  }, 250);
}

let _histSearchTimer = null;
function onHistSearchInput(val) {
  histFilters.search = val;
  histPage = 1;
  clearTimeout(_histSearchTimer);
  _histSearchTimer = setTimeout(() => {
    renderHistory();
    setTimeout(() => {
      const inp = document.querySelector('.search-inp');
      if (inp) inp.focus();
    }, 0);
  }, 250);
}

let currentDetailAsset = null;
let invCodes = { orgs:{}, types:{} };

const ICONS={Ноутбук:'💻','Системный Блок':'🖥️',Монитор:'🖵',МФУ:'🖨️',Планшет:'📱',Телевизор:'📺',
  ИБП:'🔋','Точка доступа':'📡','Мини ПК':'🖥️','Я. СТАНЦИЯ':'🔊',Спикерфон:'🎙️',Радиомост:'📡',
  ТСД:'📟',Колонки:'🔊','Жёсткий диск':'💾',Мышь:'🖱️',Клавиатура:'⌨️',Гарнитура:'🎧',Камера:'📷',
  Коммутатор:'🔀',Маршрутизатор:'🌐',Сервер:'🗄️','POE HUB':'🔌'};
const ic=t=>ICONS[t]||'🔧';
// LOC-2: было статичным объектом TAB_LABELS={...}, замороженным на языке
// загрузки скрипта — теперь функция, всегда берёт актуальный t(). Эмодзи
// оставляю декоративными (те же, что были в исходном объекте).
const TAB_ICONS = { os: '💻', small: '🖱', infra: '🌐' };
function tabLabel(tab) { return `${TAB_ICONS[tab]||''} ${t('tab_' + tab) || tab}`.trim(); }
