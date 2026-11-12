/*
 * Regras de cálculo do registro de horas.
 * Sem dependência de DOM: usado pelo navegador (globalThis.Horas) e pelos testes (module.exports).
 * Todas as durações e horários são tratados em minutos.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Horas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  const DEFAULT_SETTINGS = Object.freeze({
    metaMensal: 152 * 60, // 152:00
    jornadaDiaria: 8 * 60, // 08:00
    almocoPadrao: 60, // usado na previsão de saída enquanto o almoço não foi registrado
  });

  const TIPOS = Object.freeze({
    TRABALHO: 'trabalho',
    FOLGA: 'folga', // feriado/folga: não soma horas e não é dia de trabalho
    ABONO: 'abono', // atestado/abono: credita a jornada diária
  });

  /** "08:30" -> 510. Retorna null para vazio ou inválido. */
  function parseTime(text) {
    if (typeof text !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /** "152:00" ou "8" (horas) -> minutos. Aceita durações acima de 24h. */
  function parseDuration(text) {
    if (typeof text !== 'string') return null;
    const m = /^(\d{1,4})(?::(\d{2}))?$/.exec(text.trim());
    if (!m) return null;
    const min = m[2] === undefined ? 0 : Number(m[2]);
    if (min > 59) return null;
    return Number(m[1]) * 60 + min;
  }

  /** 9120 -> "152:00"; -45 -> "-00:45"; com sinal: 30 -> "+00:30". */
  function formatDuration(minutes, withSign) {
    const abs = Math.abs(Math.round(minutes));
    const body = String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
    if (minutes < 0) return '-' + body;
    return withSign && minutes > 0 ? '+' + body : body;
  }

  /** Horário do dia (0..1439) -> "17:05". Fora do intervalo retorna null. */
  function formatClock(minutes) {
    if (minutes === null || minutes < 0 || minutes >= 24 * 60) return null;
    return formatDuration(minutes, false);
  }

  function isoDate(year, month, day) {
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /** 0 = domingo ... 6 = sábado */
  function weekday(year, month, day) {
    return new Date(year, month - 1, day).getDay();
  }

  function isWeekend(year, month, day) {
    const w = weekday(year, month, day);
    return w === 0 || w === 6;
  }

  /**
   * Avalia o registro de um dia.
   * rec: { entrada, saidaAlmoco, retornoAlmoco, saida, tipo }
   * Retorna { minutes, complete, empty, errors[] }.
   * - Almoço é opcional, mas saída e retorno do almoço precisam ser informados juntos.
   */
  function evaluateDay(rec, settings) {
    const s = settings || DEFAULT_SETTINGS;
    const r = rec || {};
    const tipo = r.tipo || TIPOS.TRABALHO;
    if (tipo === TIPOS.FOLGA) return { minutes: 0, complete: true, empty: false, errors: [] };
    if (tipo === TIPOS.ABONO) return { minutes: s.jornadaDiaria, complete: true, empty: false, errors: [] };

    const e = parseTime(r.entrada);
    const sa = parseTime(r.saidaAlmoco);
    const ra = parseTime(r.retornoAlmoco);
    const sd = parseTime(r.saida);
    const errors = [];

    if (e === null && sa === null && ra === null && sd === null) {
      return { minutes: 0, complete: false, empty: true, errors };
    }
    if (e === null) errors.push('Informe a entrada.');
    if ((sa === null) !== (ra === null) && sd !== null) {
      errors.push('Informe saída e retorno do almoço (ou deixe os dois em branco).');
    }
    if (e !== null && sa !== null && sa <= e) errors.push('Saída para o almoço deve ser depois da entrada.');
    if (sa !== null && ra !== null && ra < sa) errors.push('Retorno do almoço deve ser depois da saída para o almoço.');
    if (sa === null && ra !== null) errors.push('Informe a saída para o almoço.');
    const lastBeforeExit = ra !== null ? ra : sa !== null ? sa : e;
    if (sd !== null && lastBeforeExit !== null && sd <= lastBeforeExit) {
      errors.push('Saída deve ser depois dos horários anteriores.');
    }
    if (errors.length) return { minutes: 0, complete: false, empty: false, errors };

    if (sd === null) {
      // Dia em andamento: contabiliza apenas o período da manhã, se já encerrado.
      const partial = sa !== null ? sa - e : 0;
      return { minutes: partial, complete: false, empty: false, errors };
    }
    const lunch = sa !== null && ra !== null ? ra - sa : 0;
    return { minutes: sd - e - lunch, complete: true, empty: false, errors };
  }

  /**
   * Horário de saída necessário para cumprir `targetMinutes` de trabalho no dia.
   * Enquanto o retorno do almoço não foi registrado, assume `almocoPadrao`.
   * Retorna minutos do dia (pode passar de 23:59 ou ficar antes do último registro) ou null sem entrada.
   */
  function exitTimeFor(rec, targetMinutes, settings) {
    const s = settings || DEFAULT_SETTINGS;
    const r = rec || {};
    const e = parseTime(r.entrada);
    if (e === null) return null;
    const sa = parseTime(r.saidaAlmoco);
    const ra = parseTime(r.retornoAlmoco);
    let exit;
    if (sa !== null && ra !== null) exit = ra + (targetMinutes - (sa - e));
    else if (sa !== null) exit = sa + s.almocoPadrao + (targetMinutes - (sa - e));
    else exit = e + s.almocoPadrao + targetMinutes;
    const floor = ra !== null ? ra : sa !== null ? sa : e;
    return Math.max(exit, floor);
  }

  /**
   * Resumo do mês.
   * days: mapa { 'AAAA-MM-DD': registro }
   * todayISO: data de hoje, usada para contar os dias úteis restantes.
   */
  function summarizeMonth(year, month, days, settings, todayISO) {
    const s = settings || DEFAULT_SETTINGS;
    const map = days || {};
    let worked = 0;
    let balance = 0; // saldo frente à jornada diária, só em dias concluídos
    let daysDone = 0;
    let remainingWorkdays = 0;
    let invalidDays = 0;
    const perDay = [];

    for (let d = 1; d <= daysInMonth(year, month); d++) {
      const iso = isoDate(year, month, d);
      const rec = map[iso] || {};
      const tipo = rec.tipo || TIPOS.TRABALHO;
      const weekend = isWeekend(year, month, d);
      const ev = evaluateDay(rec, s);
      const expected = weekend || tipo === TIPOS.FOLGA ? 0 : s.jornadaDiaria;
      let dayBalance = null;

      if (ev.errors.length) invalidDays++;
      worked += ev.minutes;
      if (ev.complete && tipo !== TIPOS.FOLGA) {
        dayBalance = ev.minutes - expected;
        balance += dayBalance;
        daysDone++;
      }
      const pending = !ev.complete && !weekend && tipo === TIPOS.TRABALHO;
      if (pending && (!todayISO || iso >= todayISO)) remainingWorkdays++;

      perDay.push({ iso, day: d, weekend, tipo, expected, balance: dayBalance, ...ev });
    }

    const missing = Math.max(s.metaMensal - worked, 0);
    const projected = worked + remainingWorkdays * s.jornadaDiaria;
    // Horas da jornada do dia em andamento já contadas em `worked` não entram duas vezes na projeção.
    const inProgress = perDay.filter((p) => !p.complete && !p.empty && !p.weekend && p.tipo === TIPOS.TRABALHO
      && (!todayISO || p.iso >= todayISO)).reduce((acc, p) => acc + p.minutes, 0);

    return {
      worked,
      goal: s.metaMensal,
      missing,
      surplus: Math.max(worked - s.metaMensal, 0),
      balance,
      daysDone,
      remainingWorkdays,
      invalidDays,
      // média de horas por dia útil restante para fechar a meta (null se não há dias restantes)
      // (inclui o que já foi trabalhado hoje, para valer como total do dia em andamento)
      requiredPerDay: remainingWorkdays > 0 ? Math.ceil((missing + inProgress) / remainingWorkdays) : null,
      projected: projected - inProgress,
      perDay,
    };
  }

  /**
   * Sugestões de saída para um dia em andamento.
   * balanceBefore: saldo acumulado nos demais dias concluídos do mês.
   */
  function exitSuggestions(rec, balanceBefore, settings) {
    const s = settings || DEFAULT_SETTINGS;
    const normal = exitTimeFor(rec, s.jornadaDiaria, s);
    if (normal === null) return null;
    const target = Math.max(s.jornadaDiaria - balanceBefore, 0);
    return {
      normal, // cumpre exatamente a jornada diária
      compensated: exitTimeFor(rec, target, s), // zera o saldo acumulado (sai antes se positivo, depois se negativo)
      compensatedTarget: target,
    };
  }

  return {
    VERSION,
    DEFAULT_SETTINGS,
    TIPOS,
    parseTime,
    parseDuration,
    formatDuration,
    formatClock,
    isoDate,
    daysInMonth,
    weekday,
    isWeekend,
    evaluateDay,
    exitTimeFor,
    summarizeMonth,
    exitSuggestions,
  };
});
