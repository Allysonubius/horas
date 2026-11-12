'use strict';
/*
 * Processo principal do aplicativo desktop.
 * Os registros ficam em <dados do usuário>/dados.json, fora da pasta do programa e do repositório.
 */
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAX_BYTES = 20 * 1024 * 1024;

// HORAS_DATA_DIR permite usar outra pasta de dados (testes ou perfil separado).
if (process.env.HORAS_DATA_DIR) app.setPath('userData', path.resolve(process.env.HORAS_DATA_DIR));

const dataFile = () => path.join(app.getPath('userData'), 'dados.json');

function lerDados() {
  for (const file of [dataFile(), dataFile() + '.bak']) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      JSON.parse(text); // arquivo corrompido: tenta a cópia de segurança
      return text;
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Falha ao ler ' + file + ': ' + err.message);
    }
  }
  return null;
}

let fila = Promise.resolve();

/** Grava de forma atômica (arquivo temporário + rename) e mantém a versão anterior em .bak. */
function salvarDados(json) {
  if (typeof json !== 'string' || json.length > MAX_BYTES) throw new Error('Conteúdo inválido.');
  JSON.parse(json);
  const file = dataFile();
  const gravar = async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, json, 'utf8');
    await fs.promises.copyFile(file, file + '.bak').catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    await fs.promises.rename(tmp, file);
  };
  fila = fila.then(gravar, gravar);
  return fila;
}

function origemConfiavel(event) {
  const frame = event.senderFrame;
  return !!frame && frame.url.startsWith('file://');
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

  ipcMain.on('dados:carregar', (event) => {
    event.returnValue = origemConfiavel(event) ? lerDados() : null;
  });
  ipcMain.on('dados:caminho', (event) => {
    event.returnValue = origemConfiavel(event) ? dataFile() : '';
  });
  ipcMain.handle('dados:salvar', (event, json) => {
    if (!origemConfiavel(event)) throw new Error('Origem não permitida.');
    return salvarDados(json);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    criarJanela();
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
