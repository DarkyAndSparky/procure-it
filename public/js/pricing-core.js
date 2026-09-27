// ─── Формула расчёта цены продажи с учётом доли доставки ───────────────────
// Единственный источник истины для этой формулы — раньше она была продублирована
// в positions.js (живой пересчёт в форме) и save-export.js (генерация Excel),
// что уже приводило к рассинхрону (см. историю правок round2/ROUND). Работает
// и в браузере (обычный <script>), и в Node (module.exports) — без обращений
// к document/window, чистая математика.
//
// purchasePrice — закупочная цена ЗА ЕДИНИЦУ этой строки
// qty           — количество в строке
// totalPurchase — сумма закупки по всем позициям заявки (без доставки)
// deliveryCost  — общая стоимость доставки на всю заявку
// markup        — наценка в ДОЛЯХ (0.05 = 5%), не в процентах
// roundToRuble  — режим «округление до рубля» (клиентский запрос, не путать
//   с обычным округлением до копеек выше): цена продажи ЗА ЕДИНИЦУ округляется
//   вверх (Math.ceil, даже 1 копейка сверху уходит в следующий рубль) ДО
//   умножения на qty — сумма по строке = округлённая цена × qty, а не
//   независимо округлённая сумма. Пример: 2 шт. по расчётной цене 1400.13 →
//   округление до 1401 → сумма строки = 1401×2 = 2802.00 (не 2801, не 2800.26).
//   Доставка тоже округляется вверх до целого рубля — ДО распределения по
//   позициям (иначе copeck-остаток от доставки просочился бы в позиции).
//   Округляется только сторона ПРОДАЖИ (клиенту) — закупочная себестоимость
//   (purchaseSum, ppWithDelivery) остаётся точной, это реальные деньги
//   поставщику, их округлять нельзя.
//
// Возвращает округлённые до 2 знаков значения — так же, как в Excel-экспорте
// (см. round2() в save-export.js), чтобы UI и выгрузка не расходились.
function calcRowPricing({ purchasePrice, qty, totalPurchase, deliveryCost, markup, roundToRuble }) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const ceilRuble = (n) => Math.ceil(Number(n) - 1e-9); // -epsilon: 1401.00 не должно стать 1402 из-за float-мусора

  const dc = roundToRuble ? ceilRuble(deliveryCost) : deliveryCost;

  const purchaseSum    = round2(purchasePrice * qty);
  const pctOfOrder      = totalPurchase > 0 ? purchaseSum / totalPurchase : 0;
  const deliveryShare   = round2(pctOfOrder * dc);
  const ppWithDelivery  = round2(qty > 0 ? purchasePrice + deliveryShare / qty : purchasePrice);

  if (roundToRuble) {
    const sellPerUnit = ceilRuble(ppWithDelivery * (1 + markup));
    const sellSum      = round2(sellPerUnit * qty);
    return { purchaseSum, pctOfOrder, deliveryShare, ppWithDelivery, sellPerUnit, sellSum, effectiveDeliveryCost: dc };
  }

  const sellPerUnit     = round2(ppWithDelivery * (1 + markup));
  // Сумма по строке считается от (purchaseSum + deliveryShare) — обе уже честно округлены
  // до копеек и НЕ делились на qty — а не от sellPerUnit*qty или ppWithDelivery*qty.
  // Деление deliveryShare на qty (для ppWithDelivery/sellPerUnit, которые остаются
  // справочной ценой "за единицу" в интерфейсе) само по себе теряет копейки при нецелых
  // долях, и умножение обратно на qty их не возвращает. Пример: deliveryShare=350.72,
  // qty=3 → 350.72/3=116.9066.. → округление до 116.91/шт → ×3 = 350.73 (лишняя копейка).
  // Через purchaseSum+deliveryShare копейка не возникает, т.к. это готовая сумма по строке.
  const sellSum         = round2((purchaseSum + deliveryShare) * (1 + markup));

  // effectiveDeliveryCost — то значение доставки, которое реально участвовало
  // в расчёте deliveryShare выше (в обычном режиме — то же, что передали;
  // в roundToRuble — уже округлённое вверх dc). Нужно потребителям (Excel-
  // экспорт), которым нужно показать/сослаться на ТУ ЖЕ базу, что легла в
  // формулы каждой строки — иначе ячейка с «общей доставкой» и то, что
  // реально использовали формулы строк, разойдутся.
  return { purchaseSum, pctOfOrder, deliveryShare, ppWithDelivery, sellPerUnit, sellSum, effectiveDeliveryCost: dc };
}

// Прибыль по заявке целиком. Доставка без единой позиции закупки не должна
// уводить прибыль в минус (нечего делить долю доставки на) — поэтому при
// totalPurchase === 0 считаем прибыль нулевой, а не -deliveryCost.
function calcProfit({ totalPurchase, totalSell, deliveryCost }) {
  return totalPurchase > 0 ? (totalSell - totalPurchase - deliveryCost) : 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcRowPricing, calcProfit };
}
