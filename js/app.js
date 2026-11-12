/* Interface do registro de horas. Regras de cálculo em calc.js (Horas) e modelo de dados em model.js (HorasModel). */
(function () {
  'use strict';

  const H = window.Horas;
  const M = window.HorasModel;
  const desktop = window.horasDesktop || null; // exposto pelo preload do aplicativo instalado
  const STORAGE_KEY = 'horas:v2';
  const LEGACY_KEY = 'horas:v1';
  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const FIELD_NAMES = { entrada: 'Entrada', saidaAlmoco: 'Saída almoço', retornoAlmoco: 'Retorno', saida: 'Saída' };
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

  const empresa = () => M.empresaAtiva(state);
  const config = () => M.configDoMes(empresa(), view.year, view.month);

  // ---------- Persistência ----------

  function load() {
    try {
      const raw = desktop
        ? desktop.carregar()
        : localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      return M.normalizar(raw ? JSON.parse(raw) : null);
    } catch (err) {
      console.error('Falha ao ler os dados salvos', err);
      return M.normalizar(null);
    }
  }

  function save() {
    const json = JSON.stringify(state);
    try {
      if (desktop) desktop.salvar(json).catch(saveFailed);
      else localStorage.setItem(STORAGE_KEY, json);
    } catch (err) {
      saveFailed(err);
    }
  }

  function saveFailed(err) {
    alert('Não foi possível salvar os dados: ' + (err && err.message ? err.message : err));
  }

  function setField(iso, field, value) {
    const dias = empresa().dias;
    const rec = { ...(dias[iso] || {}) };
    if (value) rec[field] = value;
    else delete rec[field];
    if (rec.tipo === H.TIPOS.TRABALHO) delete rec.tipo;
    if (Object.keys(rec).length) dias[iso] = rec;
    else delete dias[iso];
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
    const dias = empresa().dias;

    for (let d = 1; d <= H.daysInMonth(year, month); d++) {
      const iso = H.isoDate(year, month, d);
      const rec = dias[iso] || {};
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

      for (const f of M.FIELDS) {
        const input = el('input', { type: 'time', value: rec[f] || '', ariaLabel: FIELD_NAMES[f] + ' dia ' + d });
        input.addEventListener('input', () => {
          setField(iso, f, input.value);
          refresh();
        });
        tr.append(el('td', null, [input]));
      }

      const total = el('td', { className: 'num' });
      const balance = el('td', { className: 'num' });
      const obs = el('input', { type: 'text', value: rec.obs || '', maxLength: M.MAX_OBS, ariaLabel: 'Observação dia ' + d });
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
    const s = config();
    const dias = empresa().dias;
    const sum = H.summarizeMonth(year, month, dias, s, today);

    for (const p of sum.perDay) {
      const r = rows.get(p.iso);
      const rec = dias[p.iso] || {};
      r.tr.classList.toggle('off', p.tipo !== H.TIPOS.TRABALHO);
      r.total.textContent = p.empty ? '' : H.formatDuration(p.minutes);
      r.balance.className = 'num';
      if (p.balance === null) r.balance.textContent = '';
      else setSigned(r.balance, p.balance);

      let msg = '';
      if (p.errors.length) {
        msg = p.errors.join(' ');
      } else if (!p.complete && !p.empty) {
        const exit = H.exitTimeFor(rec, s.jornadaDiaria, s);
        if (exit !== null) msg = 'Em andamento — saída prevista para cumprir a jornada: ' + clock(exit);
      }
      r.msgCell.textContent = msg;
      r.msgRow.classList.toggle('info', !!msg && !p.errors.length);
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

    renderToday(sum, today, s);
  }

  function renderToday(sum, today, s) {
    const panel = $('todayPanel');
    const p = sum.perDay.find((x) => x.iso === today);
    panel.hidden = !p;
    if (!p) return;

    const rec = empresa().dias[today] || {};
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
      const b = bold(H.formatDuration(sum.requiredPerDay));
      if (sum.requiredPerDay > s.jornadaDiaria) b.className = 'warn';
      line('Para fechar a meta de ', bold(H.formatDuration(sum.goal)), ' é preciso em média ', b,
        ' por dia nos ', bold(String(sum.remainingWorkdays)), ' dia(s) útil(eis) restante(s).');
    }
    $('todayBody').replaceChildren(el('ul', null, items));
  }

  // ---------- Mês e empresa ----------

  function monthName() {
    const label = new Date(view.year, view.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  /** Redesenha tudo para a empresa ativa e o mês em exibição. */
  function render() {
    $('monthLabel').textContent = monthName();
    const select = $('empresaSelect');
    select.replaceChildren(...state.empresas.map((e) => el('option', { value: e.id, textContent: e.nome })));
    const ativa = empresa();
    $('content').hidden = !ativa;
    select.disabled = !ativa;
    if (!ativa) {
      openEmpresaDialog();
      return;
    }
    select.value = ativa.id;
    fillSettings();
    buildTable();
    refresh();
  }

  function shiftMonth(delta) {
    const d = new Date(view.year, view.month - 1 + delta, 1);
    view = { year: d.getFullYear(), month: d.getMonth() + 1 };
    render();
  }

  // ---------- Empresa e metas ----------

  const CFG = [
    ['cfgMeta', 'metaMensal', 'Meta mensal padrão'],
    ['cfgJornada', 'jornadaDiaria', 'Jornada diária'],
    ['cfgAlmoco', 'almocoPadrao', 'Almoço padrão'],
  ];

  function fillSettings() {
    const e = empresa();
    $('cfgNome').value = e.nome;
    for (const [id, key] of CFG) $(id).value = H.formatDuration(e[key]);
    const especifica = e.metas[M.chaveMes(view.year, view.month)];
    $('cfgMetaMes').value = especifica === undefined ? '' : H.formatDuration(especifica);
    $('cfgMetaMesLabel').textContent = 'Meta só de ' + monthName().toLowerCase() + ' (hh:mm)';
    $('cfgError').textContent = '';
  }

  function bindSettings() {
    $('cfgNome').addEventListener('change', () => {
      const nome = $('cfgNome').value.trim();
      if (!nome) {
        $('cfgError').textContent = 'Informe o nome da empresa.';
        return;
      }
      empresa().nome = nome.slice(0, M.MAX_NOME);
      save();
      render();
    });

    for (const [id, key, name] of CFG) {
      $(id).addEventListener('change', () => {
        const minutes = H.parseDuration($(id).value);
        if (minutes === null || (key !== 'almocoPadrao' && minutes === 0)) {
          $('cfgError').textContent = name + ': informe um valor no formato hh:mm (ex.: ' +
            H.formatDuration(H.DEFAULT_SETTINGS[key]) + ').';
          return;
        }
        empresa()[key] = minutes;
        save();
        fillSettings();
        refresh();
      });
    }

    $('cfgMetaMes').addEventListener('change', () => {
      const text = $('cfgMetaMes').value.trim();
      const chave = M.chaveMes(view.year, view.month);
      if (!text) {
        delete empresa().metas[chave];
      } else {
        const minutes = H.parseDuration(text);
        if (minutes === null) {
          $('cfgError').textContent = 'Meta do mês: informe um valor no formato hh:mm ou deixe em branco.';
          return;
        }
        empresa().metas[chave] = minutes;
      }
      save();
      fillSettings();
      refresh();
    });

    $('excluirEmpresa').addEventListener('click', () => {
      const e = empresa();
      const total = Object.keys(e.dias).length;
      if (!confirm('Excluir a empresa "' + e.nome + '" e seus ' + total + ' dia(s) registrado(s)?\n' +
        'Esta ação não pode ser desfeita. Exporte um backup antes, se precisar.')) return;
      state.empresas = state.empresas.filter((x) => x.id !== e.id);
      state.empresaAtiva = state.empresas.length ? state.empresas[0].id : null;
      save();
      render();
    });
  }

  // ---------- Diálogo de nova empresa ----------

  function openEmpresaDialog() {
    const dialog = $('empresaDialog');
    if (dialog.open) return;
    const primeira = state.empresas.length === 0;
    $('empresaDialogTitle').textContent = primeira ? 'Cadastre sua empresa' : 'Nova empresa';
    $('empresaDialogIntro').textContent = primeira
      ? 'Informe a empresa e as horas a cumprir por mês para começar a registrar.'
      : 'Os registros das outras empresas são mantidos. Você pode alternar entre elas a qualquer momento.';
    $('novaCancelar').hidden = primeira;
    $('novaImportar').hidden = !primeira;
    $('novaNome').value = '';
    $('novaMeta').value = H.formatDuration(H.DEFAULT_SETTINGS.metaMensal);
    $('novaJornada').value = H.formatDuration(H.DEFAULT_SETTINGS.jornadaDiaria);
    $('novaErro').textContent = '';
    dialog.showModal();
    $('novaNome').focus();
  }

  function bindEmpresaDialog() {
    const dialog = $('empresaDialog');
    // Sem empresa cadastrada não há o que exibir: o diálogo não pode ser dispensado com Esc.
    dialog.addEventListener('cancel', (ev) => {
      if (state.empresas.length === 0) ev.preventDefault();
    });
    $('novaCancelar').addEventListener('click', () => dialog.close());
    $('novaImportar').addEventListener('click', () => $('importFile').click());
    $('empresaForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const nome = $('novaNome').value.trim();
      const meta = H.parseDuration($('novaMeta').value);
      const jornada = H.parseDuration($('novaJornada').value);
      let erro = '';
      if (!nome) erro = 'Informe o nome da empresa.';
      else if (!meta) erro = 'Horas por mês: use o formato hh:mm (ex.: 152:00).';
      else if (!jornada) erro = 'Jornada diária: use o formato hh:mm (ex.: 08:00).';
      $('novaErro').textContent = erro;
      if (erro) return;
      const nova = M.novaEmpresa({ nome, metaMensal: meta, jornadaDiaria: jornada });
      state.empresas.push(nova);
      state.empresaAtiva = nova.id;
      save();
      dialog.close();
      render();
    });
  }

  // ---------- Importação / exportação ----------

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportJson() {
    const payload = { app: 'horas', version: H.VERSION, exportedAt: new Date().toISOString(), ...state };
    download('horas-backup-' + todayISO() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let incoming;
      try {
        incoming = M.normalizar(JSON.parse(reader.result));
      } catch (err) {
        alert('Arquivo inválido: não é um JSON.');
        return;
      }
      if (!incoming.empresas.length) {
        alert('Arquivo inválido: não é um backup do Registro de Horas.');
        return;
      }
      const dias = incoming.empresas.reduce((acc, e) => acc + Object.keys(e.dias).length, 0);
      const aviso = state.empresas.length ? ' Os registros atuais serão substituídos.' : '';
      if (!confirm('Importar ' + incoming.empresas.length + ' empresa(s) e ' + dias + ' dia(s)?' + aviso)) return;
      state = incoming;
      save();
      if ($('empresaDialog').open) $('empresaDialog').close();
      render();
    };
    reader.readAsText(file);
  }

  function exportCsv() {
    const e = empresa();
    const sum = H.summarizeMonth(view.year, view.month, e.dias, config(), todayISO());
    const quote = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Data', 'Tipo', 'Entrada', 'Saída almoço', 'Retorno', 'Saída', 'Total', 'Saldo', 'Observação']];
    for (const p of sum.perDay) {
      const rec = e.dias[p.iso] || {};
      lines.push([
        p.iso, p.tipo, rec.entrada, rec.saidaAlmoco, rec.retornoAlmoco, rec.saida,
        p.empty ? '' : H.formatDuration(p.minutes),
        p.balance === null ? '' : H.formatDuration(p.balance, true),
        rec.obs,
      ]);
    }
    lines.push(['Total', e.nome, '', '', '', '', H.formatDuration(sum.worked), H.formatDuration(sum.balance, true),
      'Meta ' + H.formatDuration(sum.goal)]);
    const csv = '﻿' + lines.map((l) => l.map(quote).join(';')).join('\r\n');
    download('horas-' + M.chaveMes(view.year, view.month) + '.csv', csv, 'text/csv;charset=utf-8');
  }

  // ---------- Inicialização ----------

  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  $('todayBtn').addEventListener('click', () => {
    const d = new Date();
    view = { year: d.getFullYear(), month: d.getMonth() + 1 };
    render();
    const row = rows.get(todayISO());
    if (row) row.tr.scrollIntoView({ block: 'center' });
  });
  $('empresaSelect').addEventListener('change', () => {
    state.empresaAtiva = $('empresaSelect').value;
    save();
    render();
  });
  $('novaEmpresaBtn').addEventListener('click', openEmpresaDialog);
  $('exportJson').addEventListener('click', exportJson);
  $('exportCsv').addEventListener('click', exportCsv);
  $('importJson').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (ev) => {
    if (ev.target.files[0]) importJson(ev.target.files[0]);
    ev.target.value = '';
  });

  $('version').textContent = 'Registro de Horas v' + H.VERSION;
  $('storageHint').textContent = desktop
    ? 'Os registros ficam salvos somente neste computador, em ' + desktop.caminho + '. Exporte um backup periodicamente.'
    : 'Os registros ficam salvos apenas neste navegador (localStorage). Exporte um backup periodicamente.';
  bindSettings();
  bindEmpresaDialog();
  render();
})();
