'use strict';
// Ponte mínima entre a interface (sem acesso ao Node) e o processo principal.
// As chamadas assíncronas respondem { ok: true, ... } ou { ok: false, erro }.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('horasDesktop', {
  /** 'novo' (senha ainda não configurada) ou 'bloqueado'. */
  estado: ipcRenderer.sendSync('cofre:estado'),
  /** Caminho do arquivo de dados neste computador. */
  caminho: ipcRenderer.sendSync('dados:caminho'),
  /** Configura a senha inicial. Responde { codigo, dados } (dados de versão anterior, se houver). */
  criar: (senha) => ipcRenderer.invoke('cofre:criar', senha),
  /** Desbloqueia com a senha. Responde { dados }. */
  abrir: (senha) => ipcRenderer.invoke('cofre:abrir', senha),
  /** Desbloqueia com o código de recuperação e define uma nova senha. Responde { dados }. */
  recuperar: (codigo, novaSenha) => ipcRenderer.invoke('cofre:recuperar', codigo, novaSenha),
  trocarSenha: (atual, nova) => ipcRenderer.invoke('cofre:trocar-senha', atual, nova),
  /** Grava o estado completo (texto JSON), cifrado. */
  salvar: (json) => ipcRenderer.invoke('dados:salvar', json),
  /** Descarta a chave da memória e volta à tela de senha. */
  bloquear: () => ipcRenderer.invoke('cofre:bloquear'),
  /** Situação da atualização automática: { estado, versao, progresso }. */
  atualizacao: () => ipcRenderer.invoke('atualizacao:atual'),
  aoAtualizar: (callback) => {
    ipcRenderer.on('atualizacao:estado', (_event, info) => callback(info));
  },
  /** Fecha o aplicativo e instala a versão já baixada. */
  instalarAtualizacao: () => ipcRenderer.invoke('atualizacao:instalar'),
});
