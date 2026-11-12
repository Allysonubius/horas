'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/calc.js');
const pkg = require('../package.json');

const S = H.DEFAULT_SETTINGS;
const full = (entrada, saidaAlmoco, retornoAlmoco, saida) => ({ entrada, saidaAlmoco, retornoAlmoco, saida });

test('versão do app acompanha o package.json', () => {
  assert.equal(H.VERSION, pkg.version);
});

test('parse e formatação', () => {
  assert.equal(H.parseTime('08:30'), 510);
  assert.equal(H.parseTime('24:00'), null);
  assert.equal(H.parseTime(''), null);
  assert.equal(H.parseDuration('152:00'), 9120);
  assert.equal(H.parseDuration('8'), 480);
  assert.equal(H.parseDuration('1:75'), null);
  assert.equal(H.formatDuration(9120), '152:00');
  assert.equal(H.formatDuration(-45, true), '-00:45');
  assert.equal(H.formatDuration(30, true), '+00:30');
  assert.equal(H.formatDuration(0, true), '00:00');
  assert.equal(H.formatClock(1025), '17:05');
  assert.equal(H.formatClock(1500), null);
});

test('dia completo com almoço soma 8h', () => {
  const ev = H.evaluateDay(full('08:00', '12:00', '13:00', '17:00'), S);
  assert.deepEqual([ev.minutes, ev.complete, ev.errors.length], [480, true, 0]);
});

test('dia sem almoço é aceito', () => {
  const ev = H.evaluateDay({ entrada: '08:00', saida: '14:00' }, S);
  assert.deepEqual([ev.minutes, ev.complete], [360, true]);
});

test('dia em andamento conta só a manhã encerrada', () => {
  assert.equal(H.evaluateDay({ entrada: '08:00' }, S).minutes, 0);
  const ev = H.evaluateDay({ entrada: '08:00', saidaAlmoco: '12:00' }, S);
  assert.deepEqual([ev.minutes, ev.complete, ev.errors.length], [240, false, 0]);
});

test('validações de ordem e preenchimento', () => {
  assert.ok(H.evaluateDay(full('08:00', '07:00', '13:00', '17:00'), S).errors.length);
  assert.ok(H.evaluateDay(full('08:00', '12:00', '11:00', '17:00'), S).errors.length);
  assert.ok(H.evaluateDay(full('08:00', '12:00', '13:00', '12:30'), S).errors.length);
  assert.ok(H.evaluateDay({ entrada: '08:00', saidaAlmoco: '12:00', saida: '17:00' }, S).errors.length);
  assert.ok(H.evaluateDay({ saida: '17:00' }, S).errors.length);
  assert.ok(H.evaluateDay({ entrada: '08:00', retornoAlmoco: '13:00' }, S).errors.length);
});

test('abono credita a jornada e folga não conta', () => {
  assert.equal(H.evaluateDay({ tipo: 'abono' }, S).minutes, 480);
  assert.equal(H.evaluateDay({ tipo: 'folga', entrada: '08:00', saida: '17:00' }, S).minutes, 0);
});

test('saída prevista para a jornada', () => {
  // sem almoço registrado: assume o almoço padrão de 1h
  assert.equal(H.exitTimeFor({ entrada: '08:00' }, 480, S), 17 * 60);
  // almoço de 1h30 registrado
  assert.equal(H.exitTimeFor({ entrada: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:30' }, 480, S), 17 * 60 + 30);
  // saiu para o almoço e ainda não voltou
  assert.equal(H.exitTimeFor({ entrada: '09:00', saidaAlmoco: '12:00' }, 480, S), 18 * 60);
  assert.equal(H.exitTimeFor({}, 480, S), null);
});

test('sugestão de saída compensa o saldo acumulado', () => {
  const rec = { entrada: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:00' };
  assert.equal(H.exitSuggestions(rec, 90, S).compensated, 15 * 60 + 30); // +1h30 -> sai mais cedo
  assert.equal(H.exitSuggestions(rec, -45, S).compensated, 17 * 60 + 45); // -0h45 -> sai mais tarde
  assert.equal(H.exitSuggestions(rec, 0, S).normal, 17 * 60);
  // saldo maior que a jornada: não sugere saída antes do retorno do almoço
  assert.equal(H.exitSuggestions(rec, 600, S).compensated, 13 * 60);
});

test('resumo do mês: novembro/2026 com 19 dias de 8h fecha 152h', () => {
  const days = {};
  let count = 0;
  for (let d = 1; d <= 30 && count < 19; d++) {
    if (H.isWeekend(2026, 11, d)) continue;
    days[H.isoDate(2026, 11, d)] = full('08:00', '12:00', '13:00', '17:00');
    count++;
  }
  const sum = H.summarizeMonth(2026, 11, days, S, '2026-11-30');
  assert.equal(sum.worked, 152 * 60);
  assert.equal(sum.missing, 0);
  assert.equal(sum.balance, 0);
  assert.equal(sum.daysDone, 19);
});

test('resumo do mês: saldo, dias restantes e média necessária', () => {
  const days = {
    '2026-11-02': full('08:00', '12:00', '13:00', '18:00'), // 9h -> +1h
    '2026-11-03': full('08:00', '12:00', '13:00', '16:30'), // 7h30 -> -0h30
    '2026-11-04': { tipo: 'folga' },
    '2026-11-07': { entrada: '08:00', saida: '10:00' }, // sábado: 2h extras
  };
  const sum = H.summarizeMonth(2026, 11, days, S, '2026-11-05');
  assert.equal(sum.worked, 540 + 450 + 120);
  assert.equal(sum.balance, 60 - 30 + 120);
  // novembro/2026 tem 21 dias úteis; 2 concluídos e 1 folga
  assert.equal(sum.remainingWorkdays, 18);
  assert.equal(sum.missing, 152 * 60 - 1110);
  assert.equal(sum.requiredPerDay, Math.ceil((152 * 60 - 1110) / 18));
  assert.equal(sum.projected, 1110 + 18 * 480);
});

test('dias úteis passados sem registro não entram como restantes', () => {
  const sum = H.summarizeMonth(2026, 11, {}, S, '2026-11-16');
  assert.equal(sum.remainingWorkdays, 11); // 16 a 30 de novembro
});

test('dia em andamento não é contado em dobro na projeção', () => {
  const days = { '2026-11-30': { entrada: '08:00', saidaAlmoco: '12:00' } };
  const sum = H.summarizeMonth(2026, 11, days, S, '2026-11-30');
  assert.equal(sum.worked, 240);
  assert.equal(sum.remainingWorkdays, 1);
  assert.equal(sum.projected, 480);
});

test('almoço registrado é medido e não conta como trabalho', () => {
  const ev = H.evaluateDay(full('08:00', '12:00', '13:30', '17:30'), S);
  assert.deepEqual([ev.minutes, ev.lunch], [480, 90]);
  assert.equal(H.evaluateDay({ entrada: '08:00', saida: '14:00' }, S).lunch, 0);
  // almoço já encerrado em um dia ainda em andamento
  assert.equal(H.evaluateDay({ entrada: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '12:45' }, S).lunch, 45);
  const sum = H.summarizeMonth(2026, 11, {
    '2026-11-02': full('08:00', '12:00', '13:00', '17:00'),
    '2026-11-03': full('08:00', '12:00', '12:30', '16:30'),
  }, S, '2026-11-04');
  assert.equal(sum.lunchTotal, 90);
});

test('Páscoa e feriados nacionais', () => {
  assert.deepEqual(H.pascoa(2026), { month: 4, day: 5 });
  assert.deepEqual(H.pascoa(2027), { month: 3, day: 28 });
  assert.deepEqual(H.pascoa(2038), { month: 4, day: 25 });
  const f = H.feriados(2026, false);
  assert.equal(f['2026-04-03'], 'Sexta-feira Santa');
  assert.equal(f['2026-11-20'], 'Dia da Consciência Negra');
  assert.equal(f['2026-12-25'], 'Natal');
  assert.equal(Object.keys(f).length, 10);
  assert.equal(f['2026-02-17'], undefined);
  const fac = H.feriados(2026, true);
  assert.equal(fac['2026-02-16'], 'Carnaval');
  assert.equal(fac['2026-02-17'], 'Carnaval');
  assert.equal(fac['2026-06-04'], 'Corpus Christi');
  assert.equal(H.feriados(2023, false)['2023-11-20'], undefined);
});

test('feriado em dia útil não conta como dia de trabalho', () => {
  const comFeriados = { ...S, feriados: H.feriados(2026, false) };
  // novembro/2026: 21 dias de segunda a sexta, menos Finados (seg, 02) e Consciência Negra (sex, 20)
  const vazio = H.summarizeMonth(2026, 11, {}, comFeriados, '2026-11-01');
  assert.equal(vazio.remainingWorkdays, 19);
  assert.equal(vazio.projected, 152 * 60);
  assert.equal(vazio.perDay[1].feriado, 'Finados');
  assert.equal(H.summarizeMonth(2026, 11, {}, S, '2026-11-01').remainingWorkdays, 21);
  // trabalhar no feriado gera saldo integral, como em fim de semana
  const sum = H.summarizeMonth(2026, 11, { '2026-11-02': full('08:00', '12:00', '13:00', '15:00') }, comFeriados, '2026-11-03');
  assert.equal(sum.balance, 360);
  assert.equal(sum.remainingWorkdays, 19); // o feriado nunca entrou na conta de dias úteis
});
