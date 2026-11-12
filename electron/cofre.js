'use strict';
/*
 * Cofre de dados: os registros são cifrados em disco com uma chave que só a senha (ou o código
 * de recuperação) consegue abrir. Módulo sem dependência do Electron, para poder ser testado.
 *
 * - Uma chave de dados aleatória (AES-256-GCM) cifra o conteúdo.
 * - Essa chave é guardada duas vezes, cifrada por chaves derivadas (scrypt) da senha e do código
 *   de recuperação. Trocar a senha só refaz o primeiro invólucro.
 * - Nem a senha nem o código são armazenados.
 */
const crypto = require('node:crypto');

const FORMATO = 'horas-cofre';
const VERSAO = 1;
const KDF = Object.freeze({ N: 32768, r: 8, p: 1 });
const MIN_SENHA = 6;
const MAX_SENHA = 256;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos (0/O, 1/I)

class SenhaIncorreta extends Error {
  constructor(message) {
    super(message || 'Senha incorreta.');
    this.name = 'SenhaIncorreta';
  }
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < MIN_SENHA) {
    throw new Error('A senha deve ter pelo menos ' + MIN_SENHA + ' caracteres.');
  }
  if (senha.length > MAX_SENHA) throw new Error('A senha é longa demais.');
}

function kdfValido(kdf) {
  return !!kdf && Number.isInteger(kdf.N) && kdf.N >= 16384 && kdf.N <= 1048576 && (kdf.N & (kdf.N - 1)) === 0 &&
    kdf.r === 8 && Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 4;
}

function derivar(segredo, salt, kdf) {
  return new Promise((resolve, reject) => {
    const opcoes = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r };
    crypto.scrypt(segredo.normalize('NFKC'), salt, 32, opcoes, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function cifrar(chave, conteudo, contexto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  cipher.setAAD(Buffer.from(FORMATO + ':' + contexto));
  const texto = Buffer.concat([cipher.update(conteudo), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), texto: texto.toString('base64') };
}

function decifrar(chave, caixa, contexto) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(caixa.iv, 'base64'));
  decipher.setAAD(Buffer.from(FORMATO + ':' + contexto));
  decipher.setAuthTag(Buffer.from(caixa.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(caixa.texto, 'base64')), decipher.final()]);
}

async function embrulhar(chaveDados, segredo, kdf, contexto) {
  const salt = crypto.randomBytes(16);
  const kek = await derivar(segredo, salt, kdf);
  return { salt: salt.toString('base64'), ...cifrar(kek, chaveDados, contexto) };
}

async function desembrulhar(involucro, segredo, kdf, contexto) {
  const kek = await derivar(segredo, Buffer.from(involucro.salt, 'base64'), kdf);
  try {
    return decifrar(kek, involucro, contexto);
  } catch (err) {
    throw new SenhaIncorreta(contexto === 'senha' ? 'Senha incorreta.' : 'Código de recuperação incorreto.');
  }
}

function gerarCodigo() {
  let codigo = '';
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) codigo += '-';
    codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
  }
  return codigo;
}

function normalizarCodigo(codigo) {
  return typeof codigo === 'string' ? codigo.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

function ehCofre(obj) {
  const caixa = (c) => !!c && typeof c.iv === 'string' && typeof c.tag === 'string' && typeof c.texto === 'string';
  return !!obj && obj.formato === FORMATO && obj.v === VERSAO && kdfValido(obj.kdf) &&
    caixa(obj.senha) && typeof obj.senha.salt === 'string' &&
    caixa(obj.recuperacao) && typeof obj.recuperacao.salt === 'string' && caixa(obj.dados);
}

/** Cria um cofre novo. Retorna o envelope a gravar, a chave de dados em memória e o código de recuperação. */
async function criar(senha, json, kdf) {
  validarSenha(senha);
  const params = kdf || KDF;
  const chave = crypto.randomBytes(32);
  const codigo = gerarCodigo();
  const envelope = {
    formato: FORMATO,
    v: VERSAO,
    kdf: { ...params },
    senha: await embrulhar(chave, senha, params, 'senha'),
    recuperacao: await embrulhar(chave, normalizarCodigo(codigo), params, 'recuperacao'),
    dados: cifrar(chave, Buffer.from(json || 'null', 'utf8'), 'dados'),
  };
  return { envelope, chave, codigo };
}

function lerDados(envelope, chave) {
  return decifrar(chave, envelope.dados, 'dados').toString('utf8');
}

async function abrir(envelope, senha) {
  if (typeof senha !== 'string' || !senha || senha.length > MAX_SENHA) throw new SenhaIncorreta();
  const chave = await desembrulhar(envelope.senha, senha, envelope.kdf, 'senha');
  return { chave, json: lerDados(envelope, chave) };
}

async function abrirComCodigo(envelope, codigo) {
  const limpo = normalizarCodigo(codigo);
  if (limpo.length !== 20) throw new SenhaIncorreta('Código de recuperação incorreto.');
  const chave = await desembrulhar(envelope.recuperacao, limpo, envelope.kdf, 'recuperacao');
  return { chave, json: lerDados(envelope, chave) };
}

/** Novo envelope com a senha trocada. Os dados e o código de recuperação continuam valendo. */
async function definirSenha(envelope, chave, novaSenha) {
  validarSenha(novaSenha);
  return { ...envelope, senha: await embrulhar(chave, novaSenha, envelope.kdf, 'senha') };
}

/** Novo envelope com o conteúdo atualizado. */
function gravarDados(envelope, chave, json) {
  return { ...envelope, dados: cifrar(chave, Buffer.from(json, 'utf8'), 'dados') };
}

module.exports = {
  KDF, MIN_SENHA, SenhaIncorreta, ehCofre, criar, abrir, abrirComCodigo, definirSenha, gravarDados, gerarCodigo,
};
