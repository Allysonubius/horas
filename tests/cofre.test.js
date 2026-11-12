'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cofre = require('../electron/cofre.js');

const KDF = { N: 16384, r: 8, p: 1 }; // custo mínimo aceito, para os testes rodarem rápido
const DADOS = JSON.stringify({ schema: 2, empresas: [{ nome: 'Empresa Secreta' }] });

test('cria, grava em formato cifrado e abre com a senha', async () => {
  const { envelope, codigo } = await cofre.criar('senha-forte', DADOS, KDF);
  const emDisco = JSON.stringify(envelope);
  assert.ok(cofre.ehCofre(JSON.parse(emDisco)));
  assert.ok(!emDisco.includes('Empresa Secreta'));
  assert.ok(!emDisco.includes('senha-forte') && !emDisco.includes(codigo));
  assert.match(codigo, /^([A-Z2-9]{5}-){3}[A-Z2-9]{5}$/);
  const aberto = await cofre.abrir(JSON.parse(emDisco), 'senha-forte');
  assert.equal(aberto.json, DADOS);
});

test('senha errada, vazia ou envelope adulterado não abrem', async () => {
  const { envelope } = await cofre.criar('senha-forte', DADOS, KDF);
  await assert.rejects(cofre.abrir(envelope, 'senha-errada'), cofre.SenhaIncorreta);
  await assert.rejects(cofre.abrir(envelope, ''), cofre.SenhaIncorreta);
  const adulterado = JSON.parse(JSON.stringify(envelope));
  const bytes = Buffer.from(adulterado.dados.texto, 'base64');
  bytes[0] ^= 1;
  adulterado.dados.texto = bytes.toString('base64');
  await assert.rejects(cofre.abrir(adulterado, 'senha-forte'));
});

test('senha curta é recusada na criação e na troca', async () => {
  await assert.rejects(cofre.criar('12345', DADOS, KDF), /pelo menos 6/);
  const { envelope, chave } = await cofre.criar('senha-forte', DADOS, KDF);
  await assert.rejects(cofre.definirSenha(envelope, chave, 'abc'), /pelo menos 6/);
});

test('código de recuperação abre e permite definir nova senha', async () => {
  const { envelope, codigo } = await cofre.criar('senha-esquecida', DADOS, KDF);
  await assert.rejects(cofre.abrirComCodigo(envelope, 'AAAAA-AAAAA-AAAAA-AAAAA'), cofre.SenhaIncorreta);
  await assert.rejects(cofre.abrirComCodigo(envelope, 'curto'), cofre.SenhaIncorreta);
  const { chave, json } = await cofre.abrirComCodigo(envelope, ' ' + codigo.toLowerCase().replace(/-/g, ' ') + ' ');
  assert.equal(json, DADOS);
  const novo = await cofre.definirSenha(envelope, chave, 'senha-nova');
  await assert.rejects(cofre.abrir(novo, 'senha-esquecida'), cofre.SenhaIncorreta);
  assert.equal((await cofre.abrir(novo, 'senha-nova')).json, DADOS);
  assert.equal((await cofre.abrirComCodigo(novo, codigo)).json, DADOS); // o código continua válido
});

test('gravar dados mantém a senha e troca o conteúdo cifrado', async () => {
  const { envelope, chave } = await cofre.criar('senha-forte', DADOS, KDF);
  const novo = cofre.gravarDados(envelope, chave, '{"a":1}');
  assert.notEqual(novo.dados.iv, envelope.dados.iv);
  assert.equal((await cofre.abrir(novo, 'senha-forte')).json, '{"a":1}');
});

test('reconhece apenas envelopes válidos', () => {
  assert.equal(cofre.ehCofre(null), false);
  assert.equal(cofre.ehCofre({ schema: 2, empresas: [] }), false);
  assert.equal(cofre.ehCofre({ formato: 'horas-cofre', v: 1, kdf: { N: 2, r: 8, p: 1 } }), false);
});
