'use strict';
// Ponte mínima entre a interface (sem acesso ao Node) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('horasDesktop', {
  /** Conteúdo do arquivo de dados (texto JSON) ou null na primeira execução. */
  carregar: () => ipcRenderer.sendSync('dados:carregar'),
  /** Grava o estado completo (texto JSON). */
  salvar: (json) => ipcRenderer.invoke('dados:salvar', json),
  /** Caminho do arquivo de dados neste computador. */
  caminho: ipcRenderer.sendSync('dados:caminho'),
});
