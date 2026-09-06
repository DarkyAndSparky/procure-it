const token = new URLSearchParams(location.search).get('token');

  if (!token) {
    document.getElementById('view-form').style.display = 'none';
    document.getElementById('view-expired').style.display = 'block';
    document.getElementById('expired-msg').textContent = 'Ссылка недействительна — токен не найден.';
  }

  async function doReset() {
    const pw      = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;
    const errEl   = document.getElementById('err');
    const btn     = document.getElementById('submit-btn');

    errEl.style.display = 'none';

    if (!pw || !confirm) { showErr('Заполните оба поля'); return; }
    if (pw.length < 6)   { showErr('Минимум 6 символов'); return; }
    if (pw !== confirm)  { showErr('Пароли не совпадают'); return; }

    btn.disabled = true;
    btn.textContent = 'Сохраняем…';

    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const data = await r.json();
      if (data.ok) {
        document.getElementById('view-form').style.display = 'none';
        document.getElementById('view-success').style.display = 'block';
      } else {
        showErr(data.error || 'Ошибка');
        btn.disabled = false;
        btn.textContent = 'Сохранить пароль';
      }
    } catch(e) {
      showErr('Ошибка соединения');
      btn.disabled = false;
      btn.textContent = 'Сохранить пароль';
    }
  }

  function showErr(msg) {
    const el = document.getElementById('err');
    el.textContent = msg;
    el.style.display = 'block';
  }
