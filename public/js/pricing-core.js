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
//
// Возвращает округлённые до 2 знаков значения — так же, как в Excel-экспорте
// (см. round2() в save-export.js), чтобы UI и выгрузка не расходились.
function calcRowPricing({ purchasePrice, qty, totalPurchase, deliveryCost, markup }) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  const purchaseSum    = round2(purchasePrice * qty);
  const pctOfOrder      = totalPurchase > 0 ? purchaseSum / totalPurchase : 0;
  const deliveryShare   = round2(pctOfOrder * deliveryCost);
  const ppWithDelivery  = round2(qty > 0 ? purchasePrice + deliveryShare / qty : purchasePrice);
  const sellPerUnit     = round2(ppWithDelivery * (1 + markup));
  // Сумма по строке считается от (purchaseSum + deliveryShare) — обе уже честно округлены
  // до копеек и НЕ делились на qty — а не от sellPerUnit*qty или ppWithDelivery*qty.
  // Деление deliveryShare на qty (для ppWithDelivery/sellPerUnit, которые остаются
  // справочной ценой "за единицу" в интерфейсе) само по себе теряет копейки при нецелых
  // долях, и умножение обратно на qty их не возвращает. Пример: deliveryShare=350.72,
  // qty=3 → 350.72/3=116.9066.. → округление до 116.91/шт → ×3 = 350.73 (лишняя копейка).
  // Через purchaseSum+deliveryShare копейка не возникает, т.к. это готовая сумма по строке.
  const sellSum         = round2((purchaseSum + deliveryShare) * (1 + markup));

  return { purchaseSum, pctOfOrder, deliveryShare, ppWithDelivery, sellPerUnit, sellSum };
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
