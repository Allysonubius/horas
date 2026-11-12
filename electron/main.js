'use strict';
/*
 * Processo principal do aplicativo desktop.
 * Os registros ficam cifrados em <dados do usuário>/dados.json, fora da pasta do programa e do
 * repositório. A chave só existe em memória enquanto o aplicativo está desbloqueado.
 */
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const cofre = require('./cofre.js');

const ROOT = path.join(__dirname, '..');
const MAX_BYTES = 20 * 1024 * 1024;

// HORAS_DATA_DIR permite usar outra pasta de dados (testes ou perfil separado).
if (process.env.HORAS_DATA_DIR) app.setPath('userData', path.resolve(process.env.HORAS_DATA_DIR));

const dataFile = () => path.join(app.getPath('userData'), 'dados.json');

let envelope = null; // conteúdo cifrado, como está em disco
let chave = null; // chave de dados; null = bloqueado
let legado = null; // dados sem senha gravados por versões anteriores, aguardando a criação da senha
let falhas = 0;
let fila = Promise.resolve();
let atualizacao = { estado: 'inativo' };
let atualizador = null;

/** Lê o arquivo de dados (ou a cópia de segurança, se o principal estiver corrompido). */
function carregarArquivo() {
  envelope = null;
  legado = null;
  for (const file of [dataFile(), dataFile() + '.bak']) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const obj = JSON.parse(text);
      if (cofre.ehCofre(obj)) envelope = obj;
      else legado = text;
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Falha ao ler ' + file + ': ' + err.message);
    }
  }
}

/** Grava de forma atômica (arquivo temporário + rename) e mantém a versão anterior em .bak. */
function gravarArquivo(conteudo, manterAnterior) {
  const file = dataFile();
  const gravar = async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, conteudo, 'utf8');
    if (manterAnterior) {
      await fs.promises.copyFile(file, file + '.bak').catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
    } else {
      // A versão anterior não era cifrada: não pode sobrar em disco.
      await fs.promises.rm(file + '.bak', { force: true });
    }
    await fs.promises.rename(tmp, file);
  };
  fila = fila.then(gravar, gravar);
  return fila;
}

const persistir = (manterAnterior) => gravarArquivo(JSON.stringify(envelope), manterAnterior);

function origemConfiavel(event) {
  const frame = event.senderFrame;
  return !!frame && frame.url.startsWith('file://');
}

/** Atraso crescente após tentativas erradas, para dificultar adivinhação. */
function penalidade() {
  const ms = Math.min(falhas * 500, 5000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Registra um handler que responde { ok: true, ... } ou { ok: false, erro }. */
function responder(canal, fn) {
  ipcMain.handle(canal, async (event, ...args) => {
    if (!origemConfiavel(event)) return { ok: false, erro: 'Origem não permitida.' };
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      if (!(err instanceof cofre.SenhaIncorreta)) console.error(canal + ': ' + err.message);
      return { ok: false, erro: err.message };
    }
  });
}

function registrarIpc() {
  // Chamado a cada carga da página: recarregar a interface sempre volta ao estado bloqueado.
  ipcMain.on('cofre:estado', (event) => {
    chave = null;
    if (origemConfiavel(event)) carregarArquivo();
    event.returnValue = envelope ? 'bloqueado' : 'novo';
  });
  ipcMain.on('dados:caminho', (event) => {
    event.returnValue = origemConfiavel(event) ? dataFile() : '';
  });

  responder('cofre:criar', async (senha) => {
    if (envelope) throw new Error('Já existe uma senha configurada.');
    const novo = await cofre.criar(senha, legado);
    envelope = novo.envelope;
    chave = novo.chave;
    await persistir(false);
    const dados = legado;
    legado = null;
    return { codigo: novo.codigo, dados };
  });

  const tentar = async (abrir) => {
    if (!envelope) throw new Error('Nenhuma senha configurada.');
    await penalidade();
    try {
      const aberto = await abrir();
      falhas = 0;
      return aberto;
    } catch (err) {
      if (err instanceof cofre.SenhaIncorreta) falhas++;
      throw err;
    }
  };

  responder('cofre:abrir', async (senha) => {
    const aberto = await tentar(() => cofre.abrir(envelope, senha));
    chave = aberto.chave;
    return { dados: aberto.json };
  });

  responder('cofre:recuperar', async (codigo, novaSenha) => {
    const aberto = await tentar(() => cofre.abrirComCodigo(envelope, codigo));
    envelope = await cofre.definirSenha(envelope, aberto.chave, novaSenha);
    chave = aberto.chave;
    await persistir(true);
    return { dados: aberto.json };
  });

  responder('cofre:trocar-senha', async (atual, nova) => {
    if (!chave) throw new Error('Aplicativo bloqueado.');
    await tentar(() => cofre.abrir(envelope, atual));
    envelope = await cofre.definirSenha(envelope, chave, nova);
    await persistir(true);
    return {};
  });

  responder('dados:salvar', async (json) => {
    if (!chave) throw new Error('Aplicativo bloqueado.');
    if (typeof json !== 'string' || json.length > MAX_BYTES) throw new Error('Conteúdo inválido.');
    JSON.parse(json);
    envelope = cofre.gravarDados(envelope, chave, json);
    await persistir(true);
    return {};
  });

  responder('atualizacao:atual', async () => atualizacao);
  responder('atualizacao:instalar', async () => {
    if (!atualizador || atualizacao.estado !== 'pronta') throw new Error('Nenhuma atualização pronta.');
    await fila.catch(() => {});
    chave = null;
    setImmediate(() => atualizador.quitAndInstall(true, true));
    return {};
  });

  responder('cofre:bloquear', async () => {
    await fila.catch(() => {});
    chave = null;
    const [win] = BrowserWindow.getAllWindows();
    if (win) win.webContents.reload();
    return {};
  });
}

/**
 * Atualização automática: ao abrir, consulta a release mais recente do repositório no GitHub,
 * baixa em segundo plano e instala ao fechar o aplicativo (ou quando a pessoa pedir).
 * Só funciona no aplicativo instalado. Sem internet, a verificação falha em silêncio.
 */
function avisarAtualizacao(info) {
  atualizacao = info;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('atualizacao:estado', info);
}

function iniciarAtualizacao() {
  if (!app.isPackaged || process.env.HORAS_SEM_ATUALIZACAO) return;
  try {
    atualizador = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('Atualizador indisponível: ' + err.message);
    return;
  }
  atualizador.autoDownload = true;
  atualizador.autoInstallOnAppQuit = true;
  atualizador.allowPrerelease = false;
  atualizador.allowDowngrade = false;
  atualizador.on('checking-for-update', () => avisarAtualizacao({ estado: 'verificando' }));
  atualizador.on('update-not-available', () => avisarAtualizacao({ estado: 'atualizado' }));
  atualizador.on('update-available', (info) => avisarAtualizacao({ estado: 'baixando', versao: info.version }));
  atualizador.on('download-progress', (p) => {
    avisarAtualizacao({ estado: 'baixando', versao: atualizacao.versao, progresso: Math.round(p.percent) });
  });
  atualizador.on('update-downloaded', (info) => avisarAtualizacao({ estado: 'pronta', versao: info.version }));
  atualizador.on('error', (err) => {
    console.error('Atualização: ' + (err && err.message));
    if (atualizacao.estado !== 'pronta') avisarAtualizacao({ estado: 'erro' });
  });
  atualizador.checkForUpdates().catch(() => {});
}

function criarJanela() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'Registro de Horas',
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // O aplicativo só exibe a própria interface: links externos abrem no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'index.html'));
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  registrarIpc();

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    criarJanela();
    iniciarAtualizacao();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
  });

  // Garante que a última gravação termine antes de encerrar.
  let encerrando = false;
  app.on('before-quit', (event) => {
    if (encerrando) return;
    encerrando = true;
    event.preventDefault();
    fila.catch(() => {}).finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
