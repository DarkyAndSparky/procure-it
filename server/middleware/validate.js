/**
 * server/middleware/validate.js
 *
 * SEC-9 (VAL-1): единый механизм схемной валидации входных данных.
 * Один и тот же формат ошибки на все роуты — фронту не нужно знать про
 * разницу между "поле пустое" на одном роуте и "неверный тип" на другом,
 * структура ответа всегда одинаковая.
 *
 * Использование в роуте:
 *   const { validate } = require('../middleware/validate');
 *   const { createUserSchema } = require('../validation/schemas');
 *   router.post('/', requireAdmin, validate(createUserSchema), (req, res) => {
 *     // req.body здесь уже проверен И приведён к типам схемой (z.coerce и т.п.)
 *   });
 */
'use strict';

function validate(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Берём только первую проблему — этого достаточно для формы, а
      // выводить сразу все ошибки по всем полям на маленьком экране/тосте
      // не читается. Полный список остаётся в result.error, если когда-то
      // понадобится (например, для более подробного режима в UI).
      const first = result.error.issues[0];
      const field = first.path.join('.') || '(корень)';
      return res.status(400).json({
        error: `Поле «${field}»: ${first.message}`,
        field,
        details: result.error.issues.map(i => ({ field: i.path.join('.') || '(корень)', message: i.message })),
      });
    }
    // Заменяем req.body на распарсенный/приведённый к типам результат —
    // например, z.coerce.number() превращает "5" (строку из формы) в 5.
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
