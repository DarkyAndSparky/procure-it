/**
 * public/js/meta-fields.js
 *
 * Фаза 5, шаг 6: справочник дополнительных полей по категориям
 * оборудования (IP/MAC/логин и т.д.), вынесенный из public/index.html.
 * Полностью статические данные + чистая функция без побочных эффектов —
 * самый низкий риск среди всех шагов Фазы 5.
 */

const META_FIELDS={
  'Сетевое оборудование':['ip','mac','subnet','winbox','login','password','cabinet'],
  'Wi-Fi':['ip','mac','controller','inv','network'],
  'Принтеры':['ip','mac','hostname','login','password','cartridge','firmware'],
  'Видеонаблюдение':['ip','mac','login','password'],
  'ИБП':['cabinet'],
  'Серверы':['ip','mac','login','password'],
  '_default':['ip','mac','subnet','note2'],
};
// LOC-2: было статичным объектом META_LABELS={...} — значения замораживались
// на языке, который был активен в момент загрузки скрипта, и не менялись
// при переключении языка. Теперь функция — резолвит подпись каждый раз
// заново через t(), всегда на актуальном языке.
function metaLabel(k) {
  return t('meta_' + k) || k;
}

function getMetaFields(category) {
  return META_FIELDS[category] || META_FIELDS['_default'];
}
