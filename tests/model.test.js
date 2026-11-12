'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model.js');

test('entrada vazia ou inválida gera estado sem empresas', () => {
  for (const data of [null, undefined, 'x', 42, {}, { empresas: 'x' }]) {
    const estado = M.normalizar(data);
    assert.deepEqual(estado, { schema: 2, empresaAtiva: null, empresas: [] });
  }
});

test('migra o formato antigo de empresa única', () => {
  const estado = M.normalizar({
    settings: { metaMensal: 9000, jornadaDiaria: 450, almocoPadrao: 30 },
    days: { '2026-11-02': { entrada: '08:00', saida: '17:00', obs: ' ok ' }, lixo: { entrada: '08:00' } },
  });
  assert.equal(estado.empresas.length, 1);
  const e = estado.empresas[0];
  assert.equal(estado.empresaAtiva, e.id);
  assert.deepEqual([e.nome, e.metaMensal, e.jornadaDiaria, e.almocoPadrao], ['Minha empresa', 9000, 450, 30]);
  assert.deepEqual(e.dias, { '2026-11-02': { entrada: '08:00', saida: '17:00', obs: 'ok' } });
});

test('nova empresa usa padrões e descarta valores inválidos', () => {
  const e = M.novaEmpresa({ nome: '  Acme  ', metaMensal: -5, jornadaDiaria: 0, almocoPadrao: 0 });
  assert.deepEqual([e.nome, e.metaMensal, e.jornadaDiaria, e.almocoPadrao], ['Acme', 9120, 480, 0]);
  assert.equal(M.novaEmpresa({}).nome, 'Empresa');
  assert.notEqual(M.novaEmpresa({}).id, M.novaEmpresa({}).id);
});

test('normaliza várias empresas, ids duplicados e empresa ativa inexistente', () => {
  const estado = M.normalizar({
    empresaAtiva: 'nao-existe',
    empresas: [
      { id: 'a', nome: 'Antiga', metaMensal: 9120, dias: { '2026-10-01': { entrada: '25:00', saida: '17:00' } } },
      { id: 'a', nome: 'Nova', metaMensal: 9600, metas: { '2026-11': 4800, ruim: 1, '2026-12': -1 } },
      null,
    ],
  });
  assert.equal(estado.empresas.length, 2);
  assert.notEqual(estado.empresas[0].id, estado.empresas[1].id);
  assert.equal(estado.empresaAtiva, 'a');
  assert.deepEqual(estado.empresas[0].dias, { '2026-10-01': { saida: '17:00' } });
  assert.deepEqual(estado.empresas[1].metas, { '2026-11': 4800 });
});

test('preserva a empresa ativa válida e é idempotente', () => {
  const base = M.normalizar({ empresaAtiva: 'b', empresas: [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }] });
  assert.equal(M.empresaAtiva(base).nome, 'B');
  assert.deepEqual(M.normalizar(JSON.parse(JSON.stringify(base))), base);
});

test('meta específica do mês substitui a meta padrão', () => {
  const e = M.novaEmpresa({ nome: 'A', metaMensal: 9120, metas: { '2026-11': 4800 } });
  assert.equal(M.configDoMes(e, 2026, 11).metaMensal, 4800);
  assert.equal(M.configDoMes(e, 2026, 12).metaMensal, 9120);
  assert.equal(M.configDoMes(e, 2026, 11).jornadaDiaria, 480);
});
