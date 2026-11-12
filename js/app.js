/* Interface do registro de horas. As regras de cálculo ficam em calc.js (Horas). */
(function () {
  'use strict';

  const H = window.Horas;
  const STORAGE_KEY = 'horas:v1';
  const FIELDS = ['entrada', 'saidaAlmoco', 'retornoAlmoco', 'saida'];
  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const TIPO_LABELS = [
    [H.TIPOS.TRABALHO, 'Trabalho'],
    [H.TIPOS.FOLGA, 'Feriado/Folga'],
    [H.TIPOS.ABONO, 'Abono/Atestado'],
  ];

  const $ = (id) => document.getElementById(id);

  let state = load();
  const now = new Date();
  let view = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const rows = new Map(); // iso -> referências dos elementos da linha

  function todayISO() {
    const d = new Date();
    return H.isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // ---------- Persistência ----------

  function normalize(data) {
    const settings = { ...H.DEFAULT_SETTINGS };
    const src = (data && data.settings) || {};
    for (const key of Object.keys(settings)) {
      if (Number.isFinite(src[key]) && src[key] >= 0) settings[key] = src[key];
    }
    const days = {};
    const srcDays = (data && data.days) || {};
    for (const [iso, rec] of Object.entries(srcDays)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !rec || typeof rec !== 'object') continue;
      const clean = {};
      for (const f of FIELDS) if (H.parseTime(rec[f]) !== null) clean[f] = rec[f];
      if (rec.tipo === H.TIPOS.FOLGA || rec.tipo === H.TIPOS.ABONO) clean.tipo = rec.tipo;
      if (typeof rec.obs === 'string' && rec.obs.trim()) clean.obs = rec.obs.slice(0, 200);
      if (Object.keys(clean).length) days[iso] = clean;
    }
    return { settings, days };
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (err) {
      return normalize(null);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      alert('Não foi possível salvar os dados neste navegador: ' + err.message);
    }
  }

  function setField(iso, field, value) {
    const rec = { ...(state.days[iso] || {}) };
    if (value) rec[field] = value;
    else delete rec[field];
    if (rec.tipo === H.TIPOS.TRABALHO) delete rec.tipo;
    if (Object.keys(rec).length) state.days[iso] = rec;
    else delete state.days[iso];
    save();
  }

  // ---------- Tabela ----------

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props || {});
    for (const child of children || []) node.append(child);
    return node;
  }

  function buildTable() {
    const body = $('daysBody');
    body.replaceChildren();
    rows.clear();
    const { year, month } = view;
    const today = todayISO();

    for (let d = 1; d <= H.daysInMonth(year, month); d++) {
      const iso = H.isoDate(year, month, d);
      const rec = state.days[iso] || {};
      const tr = el('tr');
      if (H.isWeekend(year, month, d)) tr.classList.add('weekend');
      if (iso === today) tr.classList.add('is-today');

      const label = String(d).padStart(2, '0') + ' ' + WEEKDAYS[H.weekday(year, month, d)];
      tr.append(el('td', { className: 'num', textContent: label }));

      const select = el('select', { ariaLabel: 'Tipo do dia ' + d });
      for (const [value, text] of TIPO_LABELS) select.append(el('option', { value, textContent: text }));
      select.value = rec.tipo || H.TIPOS.TRABALHO;
      select.addEventListener('change', () => {
        setField(iso, 'tipo', select.value);
        refresh();
      });
      tr.append(el('td', null, [select]));

      const names = { entrada: 'Entrada', saidaAlmoco: 'Saída almoço', retornoAlmoco: 'Retorno', saida: 'Saída' };
      for (const f of FIELDS) {
        const input = el('input', { type: 'time', value: rec[f] || '', ariaLabel: names[f] + ' dia ' + d });
        input.addEventListener('input', () => {
          setField(iso, f, input.value);
          refresh();
        });
        tr.append(el('td', null, [input]));
      }

      const total = el('td', { className: 'num' });
      const balance = el('td', { className: 'num' });
      const obs = el('input', { type: 'text', value: rec.obs || '', maxLength: 200, ariaLabel: 'Observação dia ' + d });
      obs.addEventListener('change', () => setField(iso, 'obs', obs.value.trim()));
      tr.append(total, balance, el('td', { className: 'obs' }, [obs]));

      const msgCell = el('td', { colSpan: 9 });
      const msgRow = el('tr', { className: 'msg', hidden: true }, [msgCell]);
      body.append(tr, msgRow);
      rows.set(iso, { tr, total, balance, msgRow, msgCell });
    }
  }

  // ---------- Atualização dos cálculos ----------

  function setSigned(node, minutes) {
    node.textContent = H.formatDuration(minutes, true);
    node.classList.toggle('pos', minutes > 0);
    node.classList.toggle('neg', minutes < 0);
  }

  function clock(minutes) {
    return H.formatClock(minutes) || 'após 23:59';
  }

  function refresh() {
    const { year, month } = view;
    const today = todayISO();
    const s = state.settings;
    const sum = H.summarizeMonth(year, month, state.days, s, today);

    for (const p of sum.perDay) {
      const r = rows.get(p.iso);
      const rec = state.days[p.iso] || {};
      r.tr.classList.toggle('off', p.tipo !== H.TIPOS.TRABALHO);
      r.total.textContent = p.empty ? '' : H.formatDuration(p.minutes);
      r.balance.className = 'num';
      if (p.balance === null) r.balance.textContent = '';
      else setSigned(r.balance, p.balance);

      let msg = '';
      let isError = false;
      if (p.errors.length) {
        msg = p.errors.join(' ');
        isError = true;
      } else if (!p.complete && !p.empty) {
        const exit = H.exitTimeFor(rec, s.jornadaDiaria, s);
        if (exit !== null) msg = 'Em andamento — saída prevista para cumprir a jornada: ' + clock(exit);
      }
      r.msgCell.textContent = msg;
      r.msgCell.style.color = isError ? '' : 'var(--muted)';
      r.msgRow.hidden = !msg;
      r.tr.classList.toggle('has-msg', !!msg);
    }

    $('sumWorked').textContent = H.formatDuration(sum.worked);
    const pct = sum.goal > 0 ? Math.min(100, Math.round((sum.worked / sum.goal) * 100)) : 100;
    $('progressBar').style.width = pct + '%';
    $('progress').setAttribute('aria-valuenow', String(pct));
    $('sumGoal').textContent = pct + '% da meta de ' + H.formatDuration(sum.goal);

    const missing = $('sumMissing');
    if (sum.missing > 0) {
      missing.textContent = H.formatDuration(sum.missing);
      missing.className = 'value';
    } else {
      missing.textContent = 'Meta atingida';
      missing.className = 'value pos';
    }
    let remainingText = sum.remainingWorkdays + ' dia(s) útil(eis) restante(s)';
    if (sum.missing > 0 && sum.requiredPerDay !== null) {
      remainingText += ' · média necessária: ' + H.formatDuration(sum.requiredPerDay) + '/dia';
    } else if (sum.surplus > 0) {
      remainingText = 'Excedente de ' + H.formatDuration(sum.surplus);
    }
    $('sumRemaining').textContent = remainingText;

    const bal = $('sumBalance');
    bal.className = 'value';
    setSigned(bal, sum.balance);
    $('sumBalanceHint').textContent =
      sum.daysDone + ' dia(s) concluído(s), frente a ' + H.formatDuration(s.jornadaDiaria) + '/dia' +
      (sum.invalidDays ? ' · ' + sum.invalidDays + ' dia(s) com erro' : '');

    const proj = $('sumProjected');
    proj.textContent = H.formatDuration(sum.projected);
    proj.className = 'value ' + (sum.projected >= sum.goal ? 'pos' : 'neg');
    const diff = sum.projected - sum.goal;
    $('sumProjectedHint').textContent =
      'Cumprindo ' + H.formatDuration(s.jornadaDiaria) + ' nos dias restantes: ' +
      (diff >= 0 ? 'sobra ' : 'falta ') + H.formatDuration(Math.abs(diff));

    renderToday(sum, today);
  }

  function renderToday(sum, today) {
    const panel = $('todayPanel');
    const p = sum.perDay.find((x) => x.iso === today);
    panel.hidden = !p;
    if (!p) return;

    const s = state.settings;
    const rec = state.days[today] || {};
    const items = [];
    const line = (...parts) => items.push(el('li', null, parts));
    const bold = (text) => el('b', { textContent: text });

    if (p.tipo !== H.TIPOS.TRABALHO) {
      line('Dia marcado como ', bold(p.tipo === H.TIPOS.FOLGA ? 'feriado/folga' : 'abono/atestado'), '.');
    } else if (p.errors.length) {
      line('Corrija os horários de hoje para ver a saída sugerida.');
    } else if (p.complete) {
      line('Dia concluído: total ', bold(H.formatDuration(p.minutes)), ', saldo do dia ',
        bold(H.formatDuration(p.balance, true)), '.');
    } else if (p.empty) {
      line('Registre a entrada para ver o horário de saída sugerido.');
    } else {
      const sug = H.exitSuggestions(rec, sum.balance, s);
      const assumed = H.parseTime(rec.retornoAlmoco) === null
        ? ' (considerando almoço de ' + H.formatDuration(s.almocoPadrao) + ')' : '';
      line('Para cumprir ', bold(H.formatDuration(s.jornadaDiaria)), ' hoje, saia às ', bold(clock(sug.normal)), assumed, '.');
      if (sum.balance > 0) {
        line('Saldo acumulado de ', bold(H.formatDuration(sum.balance, true)), ': você pode sair mais cedo, às ',
          bold(clock(sug.compensated)), ', e zerar o saldo.');
      } else if (sum.balance < 0) {
        line('Saldo acumulado de ', bold(H.formatDuration(sum.balance, true)), ': para compensar tudo hoje, saia mais tarde, às ',
          bold(clock(sug.compensated)), '.');
      }
    }

    if (p.tipo === H.TIPOS.TRABALHO && !p.complete && sum.missing > 0 && sum.requiredPerDay !== null) {
      const cls = sum.requiredPerDay > s.jornadaDiaria ? 'warn' : '';
      const b = bold(H.formatDuration(sum.requiredPerDay));
      b.className = cls;
      line('Para fechar a meta de ', bold(H.formatDuration(sum.goal)), ' é preciso em média ', b,
        ' por dia nos ', bold(String(sum.remainingWorkdays)), ' dia(s) útil(eis) restante(s).');
    }
    $('todayBody').replaceChildren(el('ul', null, items));
  }

  // ---------- Mês ----------

  function renderMonth() {
    const label = new Date(view.year, view.month - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    $('monthLabel').textContent = label.charAt(0).toUpperCase() + label.slice(1);
    buildTable();
    refresh();
  }

  function shiftMonth(delta) {
    const d = new Date(view.year, view.month - 1 + delta, 1);
    view = { year: d.getFullYear(), month: d.getMonth() + 1 };
    renderMonth();
  }

  // ---------- Configurações ----------

  const CFG = [
    ['cfgMeta', 'metaMensal', 'Meta mensal'],
    ['cfgJornada', 'jornadaDiaria', 'Jornada diária'],
    ['cfgAlmoco', 'almocoPadrao', 'Almoço padrão'],
  ];

  function fillSettings() {
    for (const [id, key] of CFG) $(id).value = H.formatDuration(state.settings[key]);
  }

  function bindSettings() {
    for (const [id, key, name] of CFG) {
      $(id).addEventListener('change', () => {
        const minutes = H.parseDuration($(id).value);
        if (minutes === null || (key !== 'almocoPadrao' && minutes === 0)) {
          $('cfgError').textContent = name + ': informe um valor no formato hh:mm (ex.: ' +
            H.formatDuration(H.DEFAULT_SETTINGS[key]) + ').';
          return;
        }
        $('cfgError').textContent = '';
        state.settings[key] = minutes;
        save();
        fillSettings();
        refresh();
      });
    }
  }

  // ---------- Importação / exportação ----------

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    const payload = { app: 'horas', version: H.VERSION, exportedAt: new Date().toISOString(), ...state };
    download('horas-backup-' + todayISO() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (err) {
        alert('Arquivo inválido: não é um JSON.');
        return;
      }
      if (!data || typeof data.days !== 'object') {
        alert('Arquivo inválido: não é um backup do Registro de Horas.');
        return;
      }
      const incoming = normalize(data);
      const count = Object.keys(incoming.days).length;
      if (!confirm('Importar ' + count + ' dia(s)? Os registros atuais deste navegador serão substituídos.')) return;
      state = incoming;
      save();
      fillSettings();
      renderMonth();
    };
    reader.readAsText(file);
  }

  function exportCsv() {
    const sum = H.summarizeMonth(view.year, view.month, state.days, state.settings, todayISO());
    const quote = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Data', 'Tipo', 'Entrada', 'Saída almoço', 'Retorno', 'Saída', 'Total', 'Saldo', 'Observação']];
    for (const p of sum.perDay) {
      const rec = state.days[p.iso] || {};
      lines.push([
        p.iso, p.tipo, rec.entrada, rec.saidaAlmoco, rec.retornoAlmoco, rec.saida,
        p.empty ? '' : H.formatDuration(p.minutes),
        p.balance === null ? '' : H.formatDuration(p.balance, true),
        rec.obs,
      ]);
    }
    lines.push(['Total', '', '', '', '', '', H.formatDuration(sum.worked), H.formatDuration(sum.balance, true),
      'Meta ' + H.formatDuration(sum.goal)]);
    const csv = '﻿' + lines.map((l) => l.map(quote).join(';')).join('\r\n');
    download('horas-' + view.year + '-' + String(view.month).padStart(2, '0') + '.csv', csv, 'text/csv;charset=utf-8');
  }

  // ---------- Inicialização ----------

  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  $('todayBtn').addEventListener('click', () => {
    const d = new Date();
    view = { year: d.getFullYear(), month: d.getMonth() + 1 };
    renderMonth();
    const row = rows.get(todayISO());
    if (row) row.tr.scrollIntoView({ block: 'center' });
  });
  $('exportJson').addEventListener('click', exportJson);
  $('exportCsv').addEventListener('click', exportCsv);
  $('importJson').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (ev) => {
    if (ev.target.files[0]) importJson(ev.target.files[0]);
    ev.target.value = '';
  });

  $('version').textContent = 'Registro de Horas v' + H.VERSION;
  bindSettings();
  fillSettings();
  renderMonth();
})();
