/* Premissas da viabilidade (vindas do ML Órion, Apoio) — regras de validação e conversões, sem tela.
 * As mesmas regras das telas do Órion:
 *  - curva padrão: soma dos percentuais mensais = 100% (tolerância 0,01);
 *  - plano de pagamento: soma das condições = 100% (tolerância 0,01);
 *  - cenário: multiplicadores maiores que zero (1 = sem ajuste);
 *  - regime tributário: alíquotas entre 0 e 100%.
 * Roda no navegador (window.OrionPremissasCalc) e no node (testes). */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.OrionPremissasCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  const TOL = 0.01;

  function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const t = String(v == null ? "" : v).trim().replace(/\s/g, "").replace("%", "");
    if (!t) return null;
    /* "1.234,56" -> 1234.56 ; "3,8" -> 3.8 ; "3.8" -> 3.8 */
    const n = Number(t.indexOf(",") >= 0 ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) ? n : null;
  }

  function soma(lista) {
    /* soma em centésimos de ponto percentual para não acumular erro de ponto flutuante */
    const c = (lista || []).reduce((s, v) => s + Math.round((num(v) || 0) * 10000), 0);
    return c / 10000;
  }

  function fmt(n, casas) {
    if (n == null || !Number.isFinite(n)) return "";
    const c = casas == null ? 2 : casas;
    return n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: Math.max(c, 6) });
  }

  /** "10; 20; 30,5" -> [10, 20, 30.5]  (aceita ; ou quebra de linha) */
  function listaDeNumeros(txt) {
    return String(txt || "").split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).map(num);
  }

  function textoDeNumeros(lista) {
    return (lista || []).map((v) => fmt(num(v), 2)).join("; ");
  }

  /** "A VISTA = 3,8; 24 = 6,6" -> [{nome:"A VISTA", perc:3.8}, {nome:"24", perc:6.6}] */
  function listaDeCondicoes(txt) {
    return String(txt || "").split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).map((parte) => {
      const i = parte.lastIndexOf("=");
      if (i < 0) return { nome: parte, perc: null };
      return { nome: parte.slice(0, i).trim(), perc: num(parte.slice(i + 1)) };
    });
  }

  /** Ao editar o texto, mantém os demais campos de cada condição (ex.: aplica_juros) pelo nome; condição nova aplica juros e correção. */
  function mesclarCondicoes(antigas, novas) {
    const porNome = new Map((antigas || []).map((c) => [String(c.nome || "").trim().toLowerCase(), c]));
    return (novas || []).map((n) => {
      const a = porNome.get(String(n.nome || "").trim().toLowerCase());
      return Object.assign({ aplica_juros: true, aplica_correcao: true }, a || {}, { nome: n.nome, perc: n.perc });
    });
  }

  function textoDeCondicoes(lista) {
    return (lista || []).map((c) => `${c.nome} = ${fmt(num(c.perc), 2)}`).join("; ");
  }

  function erro(lista, msg) {
    lista.push(msg);
    return lista;
  }

  function validarNomesUnicos(itens, rotulo) {
    const erros = [];
    const vistos = new Set();
    (itens || []).forEach((it, i) => {
      const nome = String((it && it.nome) || "").trim();
      if (!nome) return erro(erros, `${rotulo} da linha ${i + 1}: informe o nome.`);
      const k = nome.toLowerCase();
      if (vistos.has(k)) erro(erros, `${rotulo} "${nome}" aparece mais de uma vez.`);
      vistos.add(k);
    });
    return erros;
  }

  function validarCenarios(itens) {
    const erros = validarNomesUnicos(itens, "Cenário");
    (itens || []).forEach((c) => {
      ["vgv_multiplier", "construction_cost_multiplier", "sales_speed_multiplier"].forEach((k) => {
        const v = num(c[k]);
        if (v == null || v <= 0) erro(erros, `Cenário "${c.nome || "?"}": os multiplicadores precisam ser maiores que zero (1 = sem ajuste).`);
      });
    });
    return [...new Set(erros)];
  }

  const TIPOS_CURVA = ["vendas", "obras", "marketing", "Administração", "Administração de Obras", "Aquisição de Área", "Captação Interna", "Comercial", "Obras de Infraestrutura", "Projetos"];
  const CLASSES_CURVA = ["Custo", "Despesa", "Receita"];

  function validarCurvas(itens) {
    const erros = validarNomesUnicos(itens, "Curva");
    (itens || []).forEach((c) => {
      /* No Órion o tipo é texto livre (ex.: Comercial, Projetos, Obras de Infraestrutura); só não pode ficar vazio. */
      if (!String(c.tipo || "").trim()) erro(erros, `Curva "${c.nome || "?"}": informe o tipo (ex.: vendas, obras, marketing).`);
      if (CLASSES_CURVA.indexOf(c.classificacao) < 0) erro(erros, `Curva "${c.nome || "?"}": classificação deve ser Custo, Despesa ou Receita.`);
      const meses = c.meses || [];
      if (!meses.length) return erro(erros, `Curva "${c.nome || "?"}": informe os percentuais dos meses.`);
      if (meses.some((v) => num(v) == null)) return erro(erros, `Curva "${c.nome || "?"}": há mês sem número.`);
      const s = soma(meses);
      if (Math.abs(s - 100) > TOL) erro(erros, `Curva "${c.nome || "?"}": a soma dos meses dá ${fmt(s, 2)}%, precisa ser 100%.`);
    });
    return erros;
  }

  function validarPlanos(itens) {
    const erros = validarNomesUnicos(itens, "Plano");
    (itens || []).forEach((p) => {
      const conds = p.condicoes || [];
      if (!conds.length) return erro(erros, `Plano "${p.nome || "?"}": informe as condições (ex.: A VISTA = 3,8; 24 = 6,6).`);
      if (conds.some((c) => !String(c.nome || "").trim() || num(c.perc) == null)) return erro(erros, `Plano "${p.nome || "?"}": cada condição precisa de nome e percentual (nome = %).`);
      const s = soma(conds.map((c) => c.perc));
      if (Math.abs(s - 100) > TOL) erro(erros, `Plano "${p.nome || "?"}": a soma das condições dá ${fmt(s, 2)}%, precisa ser 100%.`);
    });
    return erros;
  }

  const ALIQUOTAS = ["pis", "cofins", "irpj", "csll", "outros"];

  function totalRegime(r) {
    return soma(ALIQUOTAS.map((k) => r && r[k]));
  }

  function validarRegimes(itens) {
    const erros = validarNomesUnicos(itens, "Regime");
    (itens || []).forEach((r) => {
      ALIQUOTAS.forEach((k) => {
        const v = num(r[k]);
        if (v == null || v < 0 || v > 100) erro(erros, `Regime "${r.nome || "?"}": ${k.toUpperCase()} deve estar entre 0 e 100%.`);
      });
    });
    return [...new Set(erros)];
  }

  const TIPOS_INDICE = ["IPCA", "INCC", "IGP-M"];
  const UNIDADES = ["% a.a.", "% a.m."];

  function validarIndicesProjetados(itens) {
    const erros = [];
    const vistos = new Set();
    (itens || []).forEach((it, i) => {
      const nome = String(it.nome || "").trim();
      if (!nome) erro(erros, `Índice da linha ${i + 1}: informe o nome do cenário (ex.: Otimista).`);
      if (TIPOS_INDICE.indexOf(it.index_type) < 0) erro(erros, `Índice "${nome || "?"}": escolha IPCA, INCC ou IGP-M.`);
      if (UNIDADES.indexOf(it.tipo_unidade) < 0) erro(erros, `Índice "${nome || "?"}": a unidade deve ser % a.a. ou % a.m.`);
      if (num(it.valor) == null) erro(erros, `Índice "${nome || "?"}": informe o valor.`);
      const k = (it.index_type || "") + "|" + nome.toLowerCase();
      if (nome && vistos.has(k)) erro(erros, `Índice "${nome}" de ${it.index_type} aparece mais de uma vez.`);
      vistos.add(k);
    });
    return erros;
  }

  /** Taxa anual <-> mensal equivalente (juros compostos), usada para mostrar a conversão ao lado. */
  function anualParaMensal(aa) {
    const v = num(aa);
    if (v == null) return null;
    return (Math.pow(1 + v / 100, 1 / 12) - 1) * 100;
  }

  function mensalParaAnual(am) {
    const v = num(am);
    if (v == null) return null;
    return (Math.pow(1 + v / 100, 12) - 1) * 100;
  }

  /** Fechamento de meses: lista [{ano, mes, por, em}] -> mapa "2026-03" -> registro */
  function mapaFechados(lista) {
    const m = {};
    (lista || []).forEach((r) => {
      const ano = Number(r && r.ano);
      const mes = Number(r && r.mes);
      if (!ano || !(mes >= 1 && mes <= 12)) return;
      m[ano + "-" + String(mes).padStart(2, "0")] = r;
    });
    return m;
  }

  function alternarMes(lista, ano, mes, quem, quando) {
    const chave = ano + "-" + String(mes).padStart(2, "0");
    const m = mapaFechados(lista);
    if (m[chave]) return (lista || []).filter((r) => !(Number(r.ano) === ano && Number(r.mes) === mes));
    return (lista || []).concat([{ ano, mes, por: quem || "", em: quando || new Date().toISOString() }])
      .sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
  }

  /* ---------- carga inicial: linhas exportadas do Órion (exportar_orion_para_integra.py) -> itens do Integra ---------- */

  function texto(v) { return v == null ? "" : String(v); }

  function jsonDe(v, padrao) {
    if (v == null) return padrao;
    if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return padrao; } }
    return v;
  }

  const DO_ORION = {
    scenarios: { chave: "cenarios", rotulo: "Cenários", mapear: (r) => ({
      nome: texto(r.nome), vgv_multiplier: num(r.vgv_multiplier), construction_cost_multiplier: num(r.construction_cost_multiplier), sales_speed_multiplier: num(r.sales_speed_multiplier), orion_id: r.id }) },
    standard_curves: { chave: "curvas", rotulo: "Curvas padrão", mapear: (r) => {
      const j = jsonDe(r.valores_meses_json, {});
      const meses = Array.isArray(j) ? j : (j && j.meses) || [];
      return { nome: texto(r.nome), tipo: texto(r.tipo), classificacao: texto(r.classificacao || "Custo"), meses: meses.map(num), orion_id: r.id };
    } },
    tax_regimes: { chave: "regimes", rotulo: "Regimes tributários", mapear: (r) => ({
      nome: texto(r.nome), pis: num(r.pis) || 0, cofins: num(r.cofins) || 0, irpj: num(r.irpj) || 0, csll: num(r.csll) || 0, outros: num(r.outros) || 0, ativo: r.ativo !== false, orion_id: r.id }) },
    payment_plans: { chave: "planos_pagamento", rotulo: "Planos de pagamento", mapear: (r) => ({
      /* Guarda todos os campos da condição (ex.: aplica_juros, aplica_correcao), não só nome e %. */
      nome: texto(r.nome), condicoes: (jsonDe(r.condicoes_json, []) || []).map((c) => Object.assign({}, c, { nome: texto(c && c.nome), perc: num(c && c.perc) })), orion_id: r.id }) },
    economic_indicators: { chave: "indices_projetados", rotulo: "Índices projetados", mapear: (r) => ({
      nome: texto(r.nome), index_type: texto(r.index_type), valor: num(r.valor), tipo_unidade: texto(r.tipo_unidade || "% a.a."), competencia: texto(r.competencia), orion_id: r.id }) },
    fechamento_meses: { chave: "fechamento_meses", rotulo: "Fechamento de meses", mapear: (r, ctx) => ({
      ano: Number(r.ano), mes: Number(r.mes), por: (ctx && ctx.emailDoUsuario && ctx.emailDoUsuario[r.fechado_por_id]) || "", em: texto(r.data_fechamento), orion_id: r.id }) }
  };

  /** Recebe os arquivos JSON exportados ({tabela, linhas}) e devolve o que vai para cada cadastro do Integra. */
  function prepararCarga(arquivos) {
    const porTabela = {};
    (arquivos || []).forEach((a) => { if (a && a.tabela && Array.isArray(a.linhas)) porTabela[a.tabela] = a.linhas; });
    const ctx = { emailDoUsuario: {} };
    (porTabela.users || []).forEach((u) => { if (u && u.id != null) ctx.emailDoUsuario[u.id] = texto(u.email || u.nome || u.name); });
    const cadastros = [];
    Object.keys(DO_ORION).forEach((tab) => {
      if (!porTabela[tab]) return;
      const d = DO_ORION[tab];
      let itens = porTabela[tab].map((r) => d.mapear(r, ctx));
      if (d.chave === "fechamento_meses") itens = itens.filter((x) => x.ano && x.mes >= 1 && x.mes <= 12).sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
      cadastros.push({ chave: d.chave, rotulo: d.rotulo, tabela: tab, itens });
    });
    const ss = porTabela.system_settings || [];
    const funding = ss.find((r) => r && r.key === "funding_rates");
    if (funding) cadastros.push({ chave: "taxas_funding", rotulo: "Taxas de funding", tabela: "system_settings", itens: jsonDe(funding.value, {}) });
    cadastros.forEach((c) => { c.avisos = avisosDe(c); });
    return cadastros;
  }

  function avisosDe(c) {
    switch (c.chave) {
      case "cenarios": return validarCenarios(c.itens);
      case "curvas": return validarCurvas(c.itens);
      case "regimes": return validarRegimes(c.itens);
      case "planos_pagamento": return validarPlanos(c.itens);
      case "indices_projetados": return validarIndicesProjetados(c.itens);
      default: return [];
    }
  }

  /** Curva padrão como no Órion (Apoio › Curvas › Gerar): Curva S, sino ou linear; percentuais com 2 casas e soma 100. */
  function gerarCurva(modelo, n) {
    const meses = Math.max(1, Math.min(240, Math.trunc(Number(n) || 1)));
    const v = [];
    for (let i = 1; i <= meses; i++) {
      if (modelo === "s-curve") { const k = 0.3, x0 = meses / 2, e = Math.exp(-k * (i - x0)); v.push(e / Math.pow(1 + e, 2)); }
      else if (modelo === "sino") { const media = meses / 2, dp = meses / 4; v.push((1 / (dp * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((i - media) / dp, 2))); }
      else v.push(1);
    }
    const tot = v.reduce((a, b) => a + b, 0);
    const out = v.map((x) => Math.round((x / tot) * 10000) / 100);
    const dif = Math.round((100 - out.reduce((a, b) => a + b, 0)) * 100) / 100;
    if (dif) out[out.length - 1] = Math.round((out[out.length - 1] + dif) * 100) / 100;
    return out;
  }

  /** Ajusta os percentuais para somarem 100 (proporcional), acertando o arredondamento no último. */
  function ajustarPara100(lista) {
    const v = (lista || []).map((x) => Number(x) || 0);
    const tot = v.reduce((a, b) => a + b, 0);
    if (!tot) return v;
    const out = v.map((x) => Math.round((x / tot) * 10000) / 100);
    const dif = Math.round((100 - out.reduce((a, b) => a + b, 0)) * 100) / 100;
    if (dif) out[out.length - 1] = Math.round((out[out.length - 1] + dif) * 100) / 100;
    return out;
  }

  return { gerarCurva, ajustarPara100,
    DO_ORION, prepararCarga,
    TOL, TIPOS_CURVA, CLASSES_CURVA, ALIQUOTAS, TIPOS_INDICE, UNIDADES,
    num, soma, fmt, listaDeNumeros, textoDeNumeros, listaDeCondicoes, textoDeCondicoes, mesclarCondicoes,
    validarCenarios, validarCurvas, validarPlanos, validarRegimes, validarIndicesProjetados, totalRegime,
    anualParaMensal, mensalParaAnual, mapaFechados, alternarMes
  };
});
