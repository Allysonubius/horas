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

  let state = M.normalizar(null);
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

  function parse(raw) {
    try {
      return M.normalizar(raw ? JSON.parse(raw) : null);
    } catch (err) {
      console.error('Falha ao ler os dados salvos', err);
      return M.normalizar(null);
    }
  }

  /** Versão para navegador: lê do localStorage. No aplicativo, os dados chegam ao desbloquear. */
  function loadFromBrowser() {
    try {
      return parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY));
    } catch (err) {
      return parse(null);
    }
  }

  function save() {
    const json = JSON.stringify(state);
    try {
      if (desktop) desktop.salvar(json).then((r) => { if (!r.ok) saveFailed(r.erro); }, saveFailed);
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
    const feriados = config().feriados;

    for (let d = 1; d <= H.daysInMonth(year, month); d++) {
      const iso = H.isoDate(year, month, d);
      const rec = dias[iso] || {};
      const tr = el('tr');
      if (H.isWeekend(year, month, d)) tr.classList.add('weekend');
      if (iso === today) tr.classList.add('is-today');

      const label = String(d).padStart(2, '0') + ' ' + WEEKDAYS[H.weekday(year, month, d)];
      const dia = el('td', { className: 'num', textContent: label });
      if (feriados[iso]) {
        tr.classList.add('holiday');
        dia.append(el('span', { className: 'tag', textContent: feriados[iso] }));
      }
      tr.append(dia);

      const select = el('select', { ariaLabel: 'Tipo do dia ' + d });
      for (const [value, text] of TIPO_LABELS) select.append(el('option', { value, textContent: text }));
      select.value = rec.tipo || H.TIPOS.TRABALHO;
      select.addEventListener('change', () => {
        setField(iso, 'tipo', select.value);
        refresh();
      });
      tr.append(el('td', null, [select]));

      const prevs = {}; // horário previsto, exibido abaixo de cada campo ainda não preenchido
      for (const f of M.FIELDS) {
        const input = el('input', { type: 'time', value: rec[f] || '', ariaLabel: FIELD_NAMES[f] + ' dia ' + d });
        input.addEventListener('input', () => {
          setField(iso, f, input.value);
          refresh();
        });
        prevs[f] = el('small', { className: 'prev' });
        tr.append(el('td', null, [input, prevs[f]]));
      }

      const lunch = el('td', { className: 'num' });
      const total = el('td', { className: 'num' });
      const balance = el('td', { className: 'num' });
      const obs = el('input', { type: 'text', value: rec.obs || '', maxLength: M.MAX_OBS, ariaLabel: 'Observação dia ' + d });
      obs.addEventListener('change', () => setField(iso, 'obs', obs.value.trim()));
      tr.append(lunch, total, balance, el('td', { className: 'obs' }, [obs]));

      const msgCell = el('td', { colSpan: 10 });
      const msgRow = el('tr', { className: 'msg', hidden: true }, [msgCell]);
      body.append(tr, msgRow);
      rows.set(iso, { tr, prevs, lunch, total, balance, msgRow, msgCell });
    }
  }

  // ---------- Atualização dos cálculos ----------

  function setSigned(node, minutes) {
    node.textContent = H.formatDuration(minutes, true);
    node.classList.toggle('pos', minutes > 0);
    node.classList.toggle('neg', minutes < 0);
  }

  function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /** "almoço 12:15 às 13:15 (01:00) · saída 17:15 · total 08:00" */
  function forecastText(fc) {
    const partes = [];
    if (fc.saidaAlmoco !== null) {
      partes.push('almoço ' + clock(fc.saidaAlmoco) + ' às ' + clock(fc.retornoAlmoco) + ' (' + H.formatDuration(fc.almoco) + ')');
    }
    partes.push('saída ' + clock(fc.saida));
    partes.push('total ' + H.formatDuration(fc.total));
    return partes.join(' · ');
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
      r.lunch.textContent = p.lunch ? H.formatDuration(p.lunch) : '';
      r.total.textContent = p.empty ? '' : H.formatDuration(p.minutes);
      r.balance.className = 'num';
      if (p.balance === null) r.balance.textContent = '';
      else setSigned(r.balance, p.balance);

      // Previsão do dia em andamento: horários estimados abaixo dos campos vazios e resumo na linha.
      const emAndamento = !p.errors.length && !p.complete && !p.empty && p.tipo === H.TIPOS.TRABALHO;
      const fc = emAndamento ? H.dayForecast(rec, s, p.iso === today ? nowMinutes() : null) : null;
      for (const f of M.FIELDS) r.prevs[f].textContent = fc && fc.previsto[f] ? 'prev. ' + clock(fc[f]) : '';

      let msg = '';
      if (p.errors.length) {
        msg = p.errors.join(' ');
      } else if (fc) {
        msg = 'Previsão do dia: ' + forecastText(fc) +
          (fc.ateAgora !== null ? ' · trabalhado até agora ' + H.formatDuration(fc.ateAgora) : '');
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
    $('sumGoal').textContent = pct + '% da meta de ' + H.formatDuration(sum.goal) +
      (sum.lunchTotal ? ' · almoço no mês: ' + H.formatDuration(sum.lunchTotal) : '');

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
    renderEmpresas(today);
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

    if (p.feriado) {
      line('Hoje é feriado: ', bold(p.feriado), '. Não há jornada prevista; o que for trabalhado conta como saldo.');
    }
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
      const fc = H.dayForecast(rec, s, nowMinutes());
      line('Previsão de hoje: entrada ', bold(rec.entrada), ' · ', forecastText(fc), '.');
      const faltaHoje = Math.max(s.jornadaDiaria - fc.ateAgora, 0);
      line('Trabalhado até agora: ', bold(H.formatDuration(fc.ateAgora)),
        faltaHoje ? ' (faltam ' + H.formatDuration(faltaHoje) + ' para a jornada).' : ' (jornada cumprida).');
      const mesPrevisto = sum.worked - p.minutes + fc.total;
      line('Fechando o dia como previsto, o mês vai a ', bold(H.formatDuration(mesPrevisto)), ' de ',
        H.formatDuration(sum.goal), Math.max(sum.goal - mesPrevisto, 0)
          ? ' (faltarão ' + H.formatDuration(sum.goal - mesPrevisto) + ').' : ' (meta atingida).');
      const assumed = H.parseTime(rec.retornoAlmoco) === null
        ? ' (considerando almoço de ' + H.formatDuration(s.almocoPadrao) + ')' : '';
      const saiuAlmoco = H.parseTime(rec.saidaAlmoco);
      if (saiuAlmoco !== null && H.parseTime(rec.retornoAlmoco) === null) {
        line('Em horário de almoço desde ', bold(rec.saidaAlmoco), ': retorno previsto para ',
          bold(clock(saiuAlmoco + s.almocoPadrao)), '. Registre o retorno para contar o almoço real.');
      }
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

  // ---------- Visão geral das empresas ----------

  /** Tabela com a situação de todas as empresas no mês em exibição (aparece a partir de duas). */
  function renderEmpresas(today) {
    const panel = $('empresasPanel');
    panel.hidden = state.empresas.length < 2;
    if (panel.hidden) return;
    const tot = { goal: 0, worked: 0, missing: 0, balance: 0 };
    const signed = (minutes) => {
      const td = el('td', { className: 'num' });
      setSigned(td, minutes);
      return td;
    };
    const linhas = state.empresas.map((e) => {
      const sum = H.summarizeMonth(view.year, view.month, e.dias, M.configDoMes(e, view.year, view.month), today);
      for (const k of Object.keys(tot)) tot[k] += sum[k];
      const ativa = e.id === state.empresaAtiva;
      const abrir = el('button', { type: 'button', textContent: ativa ? 'Em uso' : 'Abrir', disabled: ativa });
      abrir.addEventListener('click', () => selecionarEmpresa(e.id));
      return el('tr', { className: ativa ? 'ativa' : '' }, [
        el('td', { textContent: e.nome }),
        el('td', { className: 'num', textContent: H.formatDuration(sum.goal) }),
        el('td', { className: 'num', textContent: H.formatDuration(sum.worked) }),
        el('td', { className: 'num', textContent: sum.missing ? H.formatDuration(sum.missing) : 'Meta atingida' }),
        signed(sum.balance),
        el('td', null, [abrir]),
      ]);
    });
    $('empresasBody').replaceChildren(...linhas);
    $('empresasFoot').replaceChildren(el('tr', null, [
      el('td', { textContent: 'Total (' + state.empresas.length + ' empresas)' }),
      el('td', { className: 'num', textContent: H.formatDuration(tot.goal) }),
      el('td', { className: 'num', textContent: H.formatDuration(tot.worked) }),
      el('td', { className: 'num', textContent: H.formatDuration(tot.missing) }),
      signed(tot.balance),
      el('td'),
    ]));
  }

  function selecionarEmpresa(id) {
    state.empresaAtiva = id;
    save();
    render();
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
    $('cfgFeriados').checked = e.feriadosNacionais;
    $('cfgFacultativos').checked = e.pontosFacultativos;
    $('cfgFacultativos').disabled = !e.feriadosNacionais;
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

    for (const [id, key] of [['cfgFeriados', 'feriadosNacionais'], ['cfgFacultativos', 'pontosFacultativos']]) {
      $(id).addEventListener('change', () => {
        empresa()[key] = $(id).checked;
        save();
        render();
      });
    }

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
    $('novaCancelar').textContent = 'Cancelar';
    $('novaImportar').hidden = !primeira;
    $('novaLista').textContent = '';
    limparEmpresaForm();
    dialog.showModal();
    $('novaNome').focus();
  }

  function limparEmpresaForm() {
    $('novaNome').value = '';
    $('novaMeta').value = H.formatDuration(H.DEFAULT_SETTINGS.metaMensal);
    $('novaJornada').value = H.formatDuration(H.DEFAULT_SETTINGS.jornadaDiaria);
    $('novaErro').textContent = '';
  }

  /** Valida o formulário e cadastra a empresa. Retorna a empresa criada ou null se houver erro. */
  function criarEmpresaDoForm() {
    const nome = $('novaNome').value.trim();
    const meta = H.parseDuration($('novaMeta').value);
    const jornada = H.parseDuration($('novaJornada').value);
    let erro = '';
    if (!nome) erro = 'Informe o nome da empresa.';
    else if (state.empresas.some((e) => e.nome.toLowerCase() === nome.toLowerCase())) erro = 'Já existe uma empresa com esse nome.';
    else if (!meta) erro = 'Horas por mês: use o formato hh:mm (ex.: 152:00).';
    else if (!jornada) erro = 'Jornada diária: use o formato hh:mm (ex.: 08:00).';
    $('novaErro').textContent = erro;
    if (erro) return null;
    const nova = M.novaEmpresa({ nome, metaMensal: meta, jornadaDiaria: jornada });
    state.empresas.push(nova);
    if (!empresa()) state.empresaAtiva = nova.id;
    save();
    return nova;
  }

  function bindEmpresaDialog() {
    const dialog = $('empresaDialog');
    // Sem empresa cadastrada não há o que exibir: o diálogo não pode ser dispensado com Esc.
    dialog.addEventListener('cancel', (ev) => {
      if (state.empresas.length === 0) ev.preventDefault();
    });
    $('novaCancelar').addEventListener('click', () => {
      dialog.close();
      render();
    });
    $('novaImportar').addEventListener('click', () => $('importFile').click());
    $('empresaForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const nova = criarEmpresaDoForm();
      if (!nova) return;
      state.empresaAtiva = nova.id;
      save();
      dialog.close();
      render();
    });
    // Cadastro em sequência: grava a empresa e mantém o diálogo aberto para a próxima.
    $('novaOutra').addEventListener('click', () => {
      const nova = criarEmpresaDoForm();
      if (!nova) return;
      limparEmpresaForm();
      $('novaCancelar').hidden = false;
      $('novaCancelar').textContent = 'Concluir';
      $('novaImportar').hidden = true;
      $('novaLista').textContent = 'Cadastradas: ' +
        state.empresas.map((e) => e.nome + ' (' + H.formatDuration(e.metaMensal) + ')').join(', ') + '.';
      $('novaNome').focus();
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
    const lines = [['Data', 'Tipo', 'Entrada', 'Saída almoço', 'Retorno', 'Saída', 'Almoço', 'Total', 'Saldo', 'Observação']];
    for (const p of sum.perDay) {
      const rec = e.dias[p.iso] || {};
      lines.push([
        p.iso, p.tipo, rec.entrada, rec.saidaAlmoco, rec.retornoAlmoco, rec.saida,
        p.lunch ? H.formatDuration(p.lunch) : '',
        p.empty ? '' : H.formatDuration(p.minutes),
        p.balance === null ? '' : H.formatDuration(p.balance, true),
        rec.obs,
      ]);
    }
    lines.push(['Total', e.nome, '', '', '', '', H.formatDuration(sum.lunchTotal), H.formatDuration(sum.worked), H.formatDuration(sum.balance, true),
      'Meta ' + H.formatDuration(sum.goal)]);
    const csv = '﻿' + lines.map((l) => l.map(quote).join(';')).join('\r\n');
    download('horas-' + M.chaveMes(view.year, view.month) + '.csv', csv, 'text/csv;charset=utf-8');
  }

  // ---------- Senha (aplicativo instalado) ----------

  const MIN_SENHA = 6;
  let authModo = 'entrar'; // 'criar' | 'entrar' | 'recuperar'

  function setAuthModo(modo) {
    authModo = modo;
    const textos = {
      criar: ['Crie sua senha', 'Ela protege seus registros neste computador e será pedida sempre que o aplicativo abrir. Mínimo de ' + MIN_SENHA + ' caracteres.', 'Senha', 'Criar senha', ''],
      entrar: ['Digite sua senha', '', 'Senha', 'Entrar', 'Esqueci a senha'],
      recuperar: ['Recuperar acesso', 'Informe o código de recuperação exibido quando a senha foi criada e defina uma nova senha.', 'Nova senha', 'Redefinir senha', 'Voltar'],
    }[modo];
    $('authTitle').textContent = textos[0];
    $('authIntro').textContent = textos[1];
    $('authIntro').hidden = !textos[1];
    $('authSenhaLabel').textContent = textos[2];
    $('authEnviar').textContent = textos[3];
    $('authAlternar').textContent = textos[4];
    $('authAlternar').hidden = !textos[4];
    $('authCodigoWrap').hidden = modo !== 'recuperar';
    $('authConfirmaWrap').hidden = modo === 'entrar';
    for (const id of ['authCodigo', 'authSenha', 'authConfirma']) $(id).value = '';
    $('authErro').textContent = '';
    $(modo === 'recuperar' ? 'authCodigo' : 'authSenha').focus();
  }

  function validarNovaSenha(senha, confirma) {
    if (senha.length < MIN_SENHA) return 'A senha deve ter pelo menos ' + MIN_SENHA + ' caracteres.';
    if (senha !== confirma) return 'As senhas não conferem.';
    return '';
  }

  function entrar(dados) {
    state = parse(dados);
    $('auth').hidden = true;
    document.body.classList.remove('locked');
    render();
  }

  async function enviarAuth(ev) {
    ev.preventDefault();
    const senha = $('authSenha').value;
    let erro = '';
    if (authModo === 'entrar') erro = senha ? '' : 'Digite sua senha.';
    else erro = validarNovaSenha(senha, $('authConfirma').value);
    if (authModo === 'recuperar' && !$('authCodigo').value.trim()) erro = 'Informe o código de recuperação.';
    $('authErro').textContent = erro;
    if (erro) return;

    $('authEnviar').disabled = true;
    let r;
    try {
      if (authModo === 'criar') r = await desktop.criar(senha);
      else if (authModo === 'entrar') r = await desktop.abrir(senha);
      else r = await desktop.recuperar($('authCodigo').value, senha);
    } catch (err) {
      r = { ok: false, erro: String(err && err.message ? err.message : err) };
    }
    $('authEnviar').disabled = false;
    for (const id of ['authSenha', 'authConfirma']) $(id).value = '';
    if (!r.ok) {
      $('authErro').textContent = r.erro;
      $('authSenha').focus();
      return;
    }
    if (authModo !== 'criar') {
      entrar(r.dados);
      return;
    }
    // Senha criada: mostra o código de recuperação uma única vez antes de abrir as telas.
    $('authForm').hidden = true;
    $('authCodigoPanel').hidden = false;
    $('codigoGerado').textContent = r.codigo;
    $('codigoContinuar').onclick = () => {
      $('codigoGerado').textContent = '';
      entrar(r.dados);
    };
    $('codigoContinuar').focus();
  }

  function bindSenha() {
    $('authForm').addEventListener('submit', enviarAuth);
    $('authAlternar').addEventListener('click', () => setAuthModo(authModo === 'entrar' ? 'recuperar' : 'entrar'));
    $('bloquearBtn').hidden = false;
    $('bloquearBtn').addEventListener('click', () => desktop.bloquear());

    const dialog = $('senhaDialog');
    $('trocarSenhaBtn').hidden = false;
    $('trocarSenhaBtn').addEventListener('click', () => {
      for (const id of ['senhaAtual', 'senhaNova', 'senhaConfirma']) $(id).value = '';
      $('senhaErro').textContent = '';
      dialog.showModal();
      $('senhaAtual').focus();
    });
    $('senhaCancelar').addEventListener('click', () => dialog.close());
    $('senhaForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const erro = validarNovaSenha($('senhaNova').value, $('senhaConfirma').value);
      $('senhaErro').textContent = erro;
      if (erro) return;
      $('senhaSalvar').disabled = true;
      const r = await desktop.trocarSenha($('senhaAtual').value, $('senhaNova').value)
        .catch((err) => ({ ok: false, erro: String(err.message || err) }));
      $('senhaSalvar').disabled = false;
      for (const id of ['senhaAtual', 'senhaNova', 'senhaConfirma']) $(id).value = '';
      if (!r.ok) {
        $('senhaErro').textContent = r.erro;
        $('senhaAtual').focus();
        return;
      }
      dialog.close();
      alert('Senha alterada. O código de recuperação continua o mesmo.');
    });
  }

  // ---------- Atualização automática (aplicativo instalado) ----------

  function mostrarAtualizacao(a) {
    const info = a || {};
    const textos = {
      verificando: 'Verificando atualizações…',
      atualizado: 'Você está na versão mais recente.',
      baixando: 'Baixando a versão ' + info.versao + (info.progresso ? ' (' + info.progresso + '%)' : '') + '…',
      pronta: 'Versão ' + info.versao + ' pronta para instalar.',
      erro: 'Não foi possível verificar atualizações.',
    };
    $('updateStatus').textContent = textos[info.estado] || '';
    $('updateBar').hidden = info.estado !== 'pronta';
    if (info.estado === 'pronta') {
      $('updateText').textContent = 'A versão ' + info.versao + ' foi baixada e será instalada ao fechar o aplicativo.';
    }
  }

  function bindAtualizacao() {
    desktop.aoAtualizar(mostrarAtualizacao);
    desktop.atualizacao().then(mostrarAtualizacao, () => {});
    $('updateBtn').addEventListener('click', () => {
      $('updateBtn').disabled = true;
      desktop.instalarAtualizacao();
    });
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
  $('empresaSelect').addEventListener('change', () => selecionarEmpresa($('empresaSelect').value));
  $('novaEmpresaBtn').addEventListener('click', openEmpresaDialog);
  $('exportJson').addEventListener('click', exportJson);
  $('exportCsv').addEventListener('click', exportCsv);
  $('importJson').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (ev) => {
    if (ev.target.files[0]) importJson(ev.target.files[0]);
    ev.target.value = '';
  });

  // Mantém "trabalhado até agora" e as previsões em dia enquanto o aplicativo fica aberto.
  setInterval(() => {
    if (empresa() && !document.hidden && !document.body.classList.contains('locked')) refresh();
  }, 30000);

  $('version').textContent = 'Registro de Horas v' + H.VERSION;
  $('storageHint').textContent = desktop
    ? 'Os registros ficam cifrados com a sua senha, somente neste computador, em ' + desktop.caminho +
      '. O backup exportado em JSON não é cifrado: guarde-o em local seguro.'
    : 'Os registros ficam salvos apenas neste navegador (localStorage), sem senha. Exporte um backup periodicamente.';
  bindSettings();
  bindEmpresaDialog();
  if (desktop) {
    bindAtualizacao();
    bindSenha();
    $('auth').hidden = false;
    setAuthModo(desktop.estado === 'novo' ? 'criar' : 'entrar');
  } else {
    state = loadFromBrowser();
    document.body.classList.remove('locked');
    render();
  }
})();
