const nodemailer = require('nodemailer');
const { getDb } = require('../db/connection');

// Читает актуальные SMTP-настройки из БД при каждом вызове — так изменения
// в Настройках применяются сразу, без перезапуска сервера.
function getSmtpConfig() {
  const db = getDb();
  const keys = ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom', 'appName'];
  const rows = db.exec(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`, keys);
  const cfg = {};
  if (rows[0]?.values) rows[0].values.forEach(([k, v]) => { cfg[k] = v; });
  return {
    host:    cfg.smtpHost   || '',
    port:    parseInt(cfg.smtpPort || '587'),
    secure:  cfg.smtpSecure === '1',   // true = SSL/TLS (порт 465), false = STARTTLS (587) или plain (25)
    user:    cfg.smtpUser   || '',
    pass:    cfg.smtpPass   || '',
    from:    cfg.smtpFrom   || cfg.smtpUser || '',
    appName: cfg.appName    || 'procure-it',
  };
}

function isSmtpConfigured() {
  const { host } = getSmtpConfig();
  return !!host;
}

// Создаёт transporter с текущими настройками. Не кешируем — настройки могут
// поменяться в рантайме через Настройки → SMTP.
function createTransporter(cfg) {
  const opts = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
  };
  if (cfg.user && cfg.pass) {
    opts.auth = { user: cfg.user, pass: cfg.pass };
  }
  // В изолированных сетях без валидного TLS-сертификата сервер может иметь
  // self-signed cert. Не отключаем проверку — если нужно, пользователь может
  // настроить смягчённый режим через NODE_TLS_REJECT_UNAUTHORIZED=0 в .env.
  return nodemailer.createTransport(opts);
}

// Проверяет соединение с SMTP-сервером. Используется кнопкой «Тест» в настройках.
async function testSmtpConnection() {
  const cfg = getSmtpConfig();
  if (!cfg.host) throw new Error('SMTP не настроен — укажите хост');
  const transporter = createTransporter(cfg);
  await transporter.verify();
  return true;
}

// Универсальная функция отправки. Все внутренние письма идут через неё.
async function sendMail({ to, subject, html, text }) {
  const cfg = getSmtpConfig();
  if (!cfg.host) throw new Error('SMTP не настроен');
  const transporter = createTransporter(cfg);
  const info = await transporter.sendMail({
    from: cfg.from ? `"${cfg.appName}" <${cfg.from}>` : cfg.from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
  });
  console.log(`[email] Отправлено письмо на ${to}: ${info.messageId}`);
  return info;
}

// Письмо со ссылкой для сброса пароля.
// resetUrl — полный URL вида https://host/reset-password?token=...
async function sendPasswordResetEmail({ to, username, resetUrl, appName }) {
  const name = appName || 'procure-it';
  const subject = `[${name}] Сброс пароля`;
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:8px;border:1px solid #e0e0e0;overflow:hidden">
        <tr>
          <td style="background:#2563eb;padding:24px 32px">
            <span style="color:#fff;font-size:18px;font-weight:700">${escHtml(name)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px">
            <p style="margin:0 0 16px;font-size:15px;color:#111">
              Здравствуйте, <strong>${escHtml(username)}</strong>!
            </p>
            <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.6">
              Мы получили запрос на сброс пароля для вашей учётной записи.
              Нажмите на кнопку ниже — ссылка действует <strong>1 час</strong>.
            </p>
            <div style="text-align:center;margin-bottom:24px">
              <a href="${resetUrl}"
                 style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;
                        border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">
                Сбросить пароль
              </a>
            </div>
            <p style="margin:0 0 8px;font-size:12px;color:#999;line-height:1.5">
              Если кнопка не работает, скопируйте эту ссылку в браузер:
            </p>
            <p style="margin:0;font-size:12px;color:#2563eb;word-break:break-all">
              <a href="${resetUrl}" style="color:#2563eb">${escHtml(resetUrl)}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0">
            <p style="margin:0;font-size:11px;color:#bbb">
              Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendMail({ to, subject, html });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { isSmtpConfigured, testSmtpConnection, sendMail, sendPasswordResetEmail, getSmtpConfig };
