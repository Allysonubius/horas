/*
 * Modelo de dados: empresas, metas e registros.
 * Sem dependência de DOM: usado pelo aplicativo (globalThis.HorasModel) e pelos testes (module.exports).
 *
 * Formato (schema 2):
 * {
 *   schema: 2,
 *   empresaAtiva: 'id',
 *   empresas: [{
 *     id, nome,
 *     metaMensal, jornadaDiaria, almocoPadrao,   // minutos
 *     feriadosNacionais, pontosFacultativos,     // feriados automáticos (booleanos)
 *     metas: { 'AAAA-MM': minutos },             // meta específica de um mês (ex.: mês de entrada ou saída)
 *     dias: { 'AAAA-MM-DD': { entrada, saidaAlmoco, retornoAlmoco, saida, tipo, obs } }
 *   }]
 * }
 */
(function (root, factory) {
  const calc = typeof module === 'object' && module.exports ? require('./calc.js') : root.Horas;
  const api = factory(calc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HorasModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (H) {
  'use strict';

  const SCHEMA = 2;
  const FIELDS = ['entrada', 'saidaAlmoco', 'retornoAlmoco', 'saida'];
  const SETTINGS_KEYS = ['metaMensal', 'jornadaDiaria', 'almocoPadrao'];
  const MAX_NOME = 60;
  const MAX_OBS = 200;

  function novoId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function limparNome(nome) {
    return typeof nome === 'string' ? nome.trim().slice(0, MAX_NOME) : '';
  }

  function limparDias(src) {
    const dias = {};
    for (const [iso, rec] of Object.entries(src && typeof src === 'object' ? src : {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !rec || typeof rec !== 'object') continue;
      const clean = {};
      for (const f of FIELDS) if (H.parseTime(rec[f]) !== null) clean[f] = rec[f];
      if (rec.tipo === H.TIPOS.FOLGA || rec.tipo === H.TIPOS.ABONO) clean.tipo = rec.tipo;
      if (typeof rec.obs === 'string' && rec.obs.trim()) clean.obs = rec.obs.trim().slice(0, MAX_OBS);
      if (Object.keys(clean).length) dias[iso] = clean;
    }
    return dias;
  }

  function limparMetas(src) {
    const metas = {};
    for (const [mes, min] of Object.entries(src && typeof src === 'object' ? src : {})) {
      if (/^\d{4}-\d{2}$/.test(mes) && Number.isFinite(min) && min >= 0) metas[mes] = Math.round(min);
    }
    return metas;
  }

  /** Cria uma empresa. `dados` pode trazer nome, metaMensal, jornadaDiaria, almocoPadrao, metas e dias. */
  function novaEmpresa(dados) {
    const d = dados || {};
    const empresa = {
      id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : novoId(),
      nome: limparNome(d.nome) || 'Empresa',
      feriadosNacionais: d.feriadosNacionais !== false,
      pontosFacultativos: d.pontosFacultativos === true,
      metas: limparMetas(d.metas),
      dias: limparDias(d.dias),
    };
    for (const key of SETTINGS_KEYS) {
      const v = d[key];
      const valido = Number.isFinite(v) && v >= 0 && (key === 'almocoPadrao' || v > 0);
      empresa[key] = valido ? Math.round(v) : H.DEFAULT_SETTINGS[key];
    }
    return empresa;
  }

  /**
   * Converte qualquer entrada (vazia, schema 1 de empresa única ou schema 2) em um estado válido.
   * Nunca lança erro: dados inválidos são descartados.
   */
  function normalizar(data) {
    const estado = { schema: SCHEMA, empresaAtiva: null, empresas: [] };
    if (!data || typeof data !== 'object') return estado;

    if (Array.isArray(data.empresas)) {
      const ids = new Set();
      for (const item of data.empresas) {
        if (!item || typeof item !== 'object') continue;
        const empresa = novaEmpresa(item);
        if (ids.has(empresa.id)) empresa.id = novoId();
        ids.add(empresa.id);
        estado.empresas.push(empresa);
      }
    } else if (data.days || data.settings) {
      // schema 1: uma única configuração e um único mapa de dias
      const temDados = Object.keys(limparDias(data.days)).length > 0;
      if (temDados || data.settings) {
        estado.empresas.push(novaEmpresa({ ...(data.settings || {}), nome: 'Minha empresa', dias: data.days }));
      }
    }

    const ativa = estado.empresas.find((e) => e.id === data.empresaAtiva);
    estado.empresaAtiva = ativa ? ativa.id : estado.empresas.length ? estado.empresas[0].id : null;
    return estado;
  }

  function empresaAtiva(estado) {
    return estado.empresas.find((e) => e.id === estado.empresaAtiva) || null;
  }

  function chaveMes(year, month) {
    return year + '-' + String(month).padStart(2, '0');
  }

  /** Configurações efetivas de um mês: a meta específica do mês, se houver, substitui a meta padrão. */
  function configDoMes(empresa, year, month) {
    const especifica = empresa.metas[chaveMes(year, month)];
    return {
      metaMensal: especifica !== undefined ? especifica : empresa.metaMensal,
      jornadaDiaria: empresa.jornadaDiaria,
      almocoPadrao: empresa.almocoPadrao,
      feriados: empresa.feriadosNacionais ? H.feriados(year, empresa.pontosFacultativos) : {},
    };
  }

  return { SCHEMA, FIELDS, MAX_NOME, MAX_OBS, novaEmpresa, normalizar, empresaAtiva, chaveMes, configDoMes };
});
