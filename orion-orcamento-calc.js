/* Orçamentos e forecasts vindos do ML Órion — conversões e somas, sem tela.
 * Valores sempre em centavos inteiros (o Órion grava em reais com 2 casas; aqui não há arredondamento acumulado).
 * Chaves do Integra: centro de custo = id do Sienge (cost_centers.id_sienge no Órion);
 * plano financeiro = código do Sienge (planos_financeiros.db_id no Órion).
 * Roda no navegador (window.OrionOrcamentoCalc) e no node (testes). */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.OrionOrcamentoCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const ITENS_POR_DOC = 400; // ~100 KB por documento do Firestore (limite 1 MB)

  /** Reais (número ou texto "1234.5" / "1.234,50") -> centavos inteiros. */
  function centavos(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : 0;
    let t = String(v).trim().replace(/\s/g, "").replace("R$", "");
    if (t.indexOf(",") >= 0) t = t.replace(/\./g, "").replace(",", ".");
    const neg = t.startsWith("-");
    if (neg) t = t.slice(1);
    const [int, dec = ""] = t.split(".");
    if (!/^\d*$/.test(int) || !/^\d*$/.test(dec)) return 0;
    const d = (dec + "000").slice(0, 3);
    let c = Number(int || "0") * 100 + Number(d.slice(0, 2));
    if (Number(d[2]) >= 5) c += 1; // meio centavo arredonda para cima (como round(…, 2) do Órion em valores positivos)
    return neg ? -c : c;
  }

  function reais(c) {
    return (Number(c) || 0) / 100;
  }

  function fmtReais(c, semCentavos) {
    const v = reais(c);
    return v.toLocaleString("pt-BR", { minimumFractionDigits: semCentavos ? 0 : 2, maximumFractionDigits: semCentavos ? 0 : 2 });
  }

  function somaMeses(m) {
    return (m || []).reduce((s, v) => s + (Number(v) || 0), 0);
  }

  function somarLinhas(linhas) {
    const tot = new Array(12).fill(0);
    (linhas || []).forEach((l) => (l.m || []).forEach((v, i) => { tot[i] += Number(v) || 0; }));
    return { m: tot, total: somaMeses(tot) };
  }

  /** Mapas de apoio a partir das tabelas exportadas do Órion. */
  function mapas(porTabela) {
    const cc = {}, plano = {}, dept = {}, usuario = {};
    (porTabela.cost_centers || []).forEach((r) => { cc[r.id] = { id: String(r.id_sienge || ""), nome: String(r.nome || "") }; });
    (porTabela.planos_financeiros || []).forEach((r) => {
      plano[r.id] = { id: String(r.db_id || ""), nome: String(r.name || ""), tipo: String(r.tp_conta || ""), redutora: String(r.fl_redutora || "") === "S" };
    });
    (porTabela.departamentos || []).forEach((r) => { dept[r.id] = { id: r.id, nome: String(r.nome || "") }; });
    (porTabela.users || []).forEach((r) => { usuario[r.id] = String(r.email || r.nome || r.name || ""); });
    return { cc, plano, dept, usuario };
  }

  function linhaMensal(r, M) {
    const cc = M.cc[r.produto_id] || { id: "", nome: "" };
    const pl = M.plano[r.plano_financeiro_id] || { id: "", nome: "", tipo: "", redutora: false };
    const m = MESES.map((k) => centavos(r[k]));
    return {
      cc: cc.id, cc_nome: cc.nome, plano: pl.id, plano_nome: pl.nome, plano_tipo: pl.tipo, redutora: pl.redutora,
      m, total: somaMeses(m), total_orion: centavos(r.total_anual), obs: r.observacao == null ? "" : String(r.observacao),
      orion_produto_id: r.produto_id, orion_plano_id: r.plano_financeiro_id, auto: !!r.is_auto_generated
    };
  }

  function linhaVenda(r, M, PLANOS) {
    const cc = M.cc[r.produto_id] || { id: "", nome: "" };
    const pp = (PLANOS || {})[r.plano_venda_id];
    return {
      cc: cc.id, cc_nome: cc.nome, plano_venda: pp ? pp.nome : "", orion_plano_venda_id: r.plano_venda_id,
      ano: Number(r.ano), mes: Number(r.mes), juros_mensal: Number(r.juros_mensal) || 0,
      ticket: centavos(r.ticket_medio), vendas: Number(r.numero_vendas) || 0, vgv: centavos(r.vgv),
      origem: r.origem_venda == null ? "" : String(r.origem_venda), obs: r.observacao == null ? "" : String(r.observacao),
      orion_produto_id: r.produto_id
    };
  }

  /**
   * Monta os documentos do Firestore a partir dos arquivos exportados.
   * tipoDoc: "orcamentos" ou "forecasts".
   * Devolve { cabecalhos: [doc], blocos: [doc], conferencia: [...] }.
   */
  function prepararDocumentos(arquivos, tipoDoc) {
    const porTabela = {};
    (arquivos || []).forEach((a) => { if (a && a.tabela && Array.isArray(a.linhas)) porTabela[a.tabela] = a.linhas; });
    const M = mapas(porTabela);
    const ehOrc = tipoDoc === "orcamentos";
    const cab = porTabela[ehOrc ? "orcamentos" : "forecasts"] || [];
    const itens = porTabela[ehOrc ? "orcamento_itens" : "forecast_itens"] || [];
    const vendas = porTabela[ehOrc ? "orcamento_venda_itens" : "forecast_venda_itens"] || [];
    const hist = ehOrc ? porTabela.orcamento_historico || [] : [];
    const fk = ehOrc ? "orcamento_id" : "forecast_id";
    const PLANOS = {};
    (porTabela.payment_plans || []).forEach((p) => { PLANOS[p.id] = { nome: String(p.nome || "") }; });

    const itensPor = {}, vendasPor = {}, histPor = {};
    itens.forEach((r) => { (itensPor[r[fk]] = itensPor[r[fk]] || []).push(r); });
    vendas.forEach((r) => { (vendasPor[r[fk]] = vendasPor[r[fk]] || []).push(r); });
    hist.forEach((r) => { (histPor[r.orcamento_id] = histPor[r.orcamento_id] || []).push(r); });

    const cabecalhos = [], blocos = [], conferencia = [], semMapa = [];
    cab.forEach((o) => {
      const linhas = (itensPor[o.id] || []).map((r) => linhaMensal(r, M));
      const lvendas = (vendasPor[o.id] || []).map((r) => linhaVenda(r, M, PLANOS));
      linhas.forEach((l) => { if (!l.cc || !l.plano) semMapa.push(`${tipoDoc} ${o.id}: produto ${l.orion_produto_id} / plano ${l.orion_plano_id}`); });
      const tot = somarLinhas(linhas);
      const totOrion = linhas.reduce((s, l) => s + l.total_orion, 0);
      const vgv = lvendas.reduce((s, l) => s + l.vgv, 0);
      const prod = o.produto_id != null ? M.cc[o.produto_id] || null : null;
      const d = o.departamento_id != null ? M.dept[o.departamento_id] || { id: o.departamento_id, nome: "" } : null;
      const id = String(o.id);
      const nBlocos = Math.max(1, Math.ceil(Math.max(linhas.length, lvendas.length) / ITENS_POR_DOC));
      for (let b = 0; b < nBlocos; b++) {
        blocos.push({
          _id: `${id}_${b}`, [ehOrc ? "orcamento" : "forecast"]: id, bloco: b,
          itens: linhas.slice(b * ITENS_POR_DOC, (b + 1) * ITENS_POR_DOC),
          vendas: lvendas.slice(b * ITENS_POR_DOC, (b + 1) * ITENS_POR_DOC)
        });
      }
      cabecalhos.push({
        _id: id, orion_id: o.id, descricao: String(o.descricao || ""), ano: Number(o.ano), tipo: String(o.tipo || ""),
        status: String(o.status || ""), versao: Number(o.versao_numero) || 1,
        versao_base: ehOrc ? (o.versao_base_id != null ? String(o.versao_base_id) : "") : (o.versao_base_forecast_id != null ? String(o.versao_base_forecast_id) : ""),
        orcamento_base: !ehOrc && o.versao_base_orcamento_id != null ? String(o.versao_base_orcamento_id) : "",
        mes_corte: ehOrc ? null : (o.mes_corte == null ? null : Number(o.mes_corte)),
        departamento: d, produto: prod,
        criado_por: M.usuario[o.usuario_criador_id] || "", criado_em: o.data_criacao || "",
        motivo_reabertura: o.motivo_reabertura || "",
        historico: (histPor[o.id] || []).sort((a, b) => String(a.data_hora).localeCompare(String(b.data_hora)))
          .map((h) => ({ de: h.status_anterior || "", para: h.status_novo || "", por: M.usuario[h.usuario_id] || "", em: h.data_hora || "", motivo: h.motivo || "" })),
        linhas: linhas.length, linhas_venda: lvendas.length, blocos: nBlocos,
        totais: tot, total_orion: totOrion, vgv
      });
      conferencia.push({ id, ano: Number(o.ano), tipo: o.tipo, status: o.status, versao: o.versao_numero, departamento: d ? d.nome : "", linhas: linhas.length, total: tot.total, total_orion: totOrion, vendas: lvendas.length, vgv });
    });
    return { cabecalhos, blocos, conferencia, semMapa };
  }

  /** Junta as linhas dos blocos de um orçamento/forecast. */
  function juntarBlocos(blocos) {
    const itens = [], vendas = [];
    (blocos || []).slice().sort((a, b) => a.bloco - b.bloco).forEach((b) => { itens.push(...(b.itens || [])); vendas.push(...(b.vendas || [])); });
    return { itens, vendas };
  }

  /** Agrupa linhas por um campo (cc ou plano) somando os meses. */
  function agrupar(linhas, campo, campoNome) {
    const g = new Map();
    (linhas || []).forEach((l) => {
      const k = l[campo] || "";
      if (!g.has(k)) g.set(k, { chave: k, nome: l[campoNome] || "", m: new Array(12).fill(0), total: 0, n: 0 });
      const x = g.get(k);
      l.m.forEach((v, i) => { x.m[i] += v; });
      x.total += l.total;
      x.n += 1;
    });
    return [...g.values()].sort((a, b) => String(a.chave).localeCompare(String(b.chave), "pt-BR", { numeric: true }));
  }

  /** Diferença entre duas versões, por centro de custo × plano. */
  function diferencaVersoes(atual, base) {
    const k = (l) => l.cc + "|" + l.plano;
    const mb = new Map((base || []).map((l) => [k(l), l]));
    const out = [];
    (atual || []).forEach((l) => {
      const b = mb.get(k(l));
      mb.delete(k(l));
      const dif = l.total - (b ? b.total : 0);
      if (dif) out.push({ cc: l.cc, cc_nome: l.cc_nome, plano: l.plano, plano_nome: l.plano_nome, atual: l.total, base: b ? b.total : 0, dif });
    });
    mb.forEach((b) => out.push({ cc: b.cc, cc_nome: b.cc_nome, plano: b.plano, plano_nome: b.plano_nome, atual: 0, base: b.total, dif: -b.total }));
    return out.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  }

  /* ---------- departamentos e matriz de permissões do orçamento (Órion) ---------- */

  /** Arquivos exportados -> cadastro de departamentos do orçamento para orion_config/departamentos. */
  function prepararDepartamentos(arquivos) {
    const porTabela = {};
    (arquivos || []).forEach((a) => { if (a && a.tabela && Array.isArray(a.linhas)) porTabela[a.tabela] = a.linhas; });
    const M = mapas(porTabela);
    const dir = {};
    (porTabela.diretorias || []).forEach((d) => { dir[d.id] = String(d.nome || ""); });
    const ccsPor = {}, planosPor = {}, usuariosPor = {};
    (porTabela.departamento_cost_centers || []).forEach((r) => {
      if (r.permitido === false) return;
      const cc = M.cc[r.cost_center_id];
      if (cc && cc.id) (ccsPor[r.departamento_id] = ccsPor[r.departamento_id] || new Set()).add(cc.id);
    });
    (porTabela.departamento_planos || []).forEach((r) => {
      if (r.permitido === false) return;
      const pl = M.plano[r.plano_financeiro_id];
      if (pl && pl.id) (planosPor[r.departamento_id] = planosPor[r.departamento_id] || new Set()).add(pl.id);
    });
    (porTabela.user_departamentos || []).forEach((r) => {
      const em = M.usuario[r.user_id];
      if (em) (usuariosPor[r.departamento_id] = usuariosPor[r.departamento_id] || new Set()).add(em);
    });
    const ordenar = (s) => [...(s || [])].sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
    const departamentos = (porTabela.departamentos || []).map((d) => ({
      id: d.id, nome: String(d.nome || ""), ativo: d.ativo !== false, residual: !!d.is_residual,
      diretoria: d.diretoria_id != null ? dir[d.diretoria_id] || "" : "",
      ccs: ordenar(ccsPor[d.id]), planos: ordenar(planosPor[d.id]), usuarios: ordenar(usuariosPor[d.id])
    })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const produtoPlano = [];
    (porTabela.produto_plano_financeiro || []).forEach((r) => {
      if (r.permitido === false) return;
      const cc = M.cc[r.produto_id], pl = M.plano[r.plano_financeiro_id];
      if (cc && pl && cc.id && pl.id) produtoPlano.push(cc.id + "|" + pl.id);
    });
    const depara = (porTabela.depara_autorizacao_departamento || []).map((r) => ({
      nome_sienge: String(r.nome_sienge || ""), sienge_department_id: r.sienge_department_id == null ? null : Number(r.sienge_department_id),
      departamento: r.departamento_id == null ? null : r.departamento_id, manual: !!r.definido_manual
    })).sort((a, b) => a.nome_sienge.localeCompare(b.nome_sienge, "pt-BR"));
    const nomesCc = {}, nomesPlano = {};
    Object.values(M.cc).forEach((c) => { if (c.id) nomesCc[c.id] = c.nome; });
    Object.values(M.plano).forEach((p) => { if (p.id) nomesPlano[p.id] = p.nome; });
    return { departamentos, produtoPlano: produtoPlano.sort(), depara, nomesCc, nomesPlano };
  }

  /** Mesma regra do Órion (services/auth_matrix.py): departamento × plano obrigatório;
   *  centro de custo × plano só é exigido quando essa matriz tiver algum vínculo. */
  function lancamentoPermitido(cad, departamentoId, cc, plano) {
    const d = (cad && cad.departamentos || []).find((x) => String(x.id) === String(departamentoId));
    if (!d || (d.planos || []).indexOf(String(plano)) < 0) return false;
    const pp = (cad && cad.produtoPlano) || [];
    if (!pp.length) return true;
    return pp.indexOf(String(cc) + "|" + String(plano)) >= 0;
  }

  /* ---------- fluxo de aprovação (mesma tabela do Órion: services/budget_status.py) ---------- */

  const STATUS_BLOQUEADO = ["Aprovado", "Fechado", "Em aprovação", "Solicitação Reabertura"];
  const ACOES_GESTOR = ["aprovar", "rejeitar", "recusar_reabertura", "aprovar_reabertura"];

  /** Devolve { destino, acao } ou lança erro com a mesma mensagem do Órion. */
  function resolverTransicao(statusAtual, pedido) {
    const atual = String(statusAtual || "").trim();
    const novo = String(pedido || "").trim();
    if ((atual === "Rascunho" || atual === "Reaberto") && novo === "Em aprovação") return { destino: "Em aprovação", acao: "enviar" };
    if (atual === "Em aprovação" && (novo === "Fechado" || novo === "Aprovado")) return { destino: "Fechado", acao: "aprovar" };
    if (atual === "Em aprovação" && novo === "Rascunho") return { destino: "Rascunho", acao: "rejeitar" };
    if ((atual === "Fechado" || atual === "Aprovado") && novo === "Solicitação Reabertura") return { destino: "Solicitação Reabertura", acao: "solicitar_reabertura" };
    if (atual === "Solicitação Reabertura" && novo === "Fechado") return { destino: "Fechado", acao: "recusar_reabertura" };
    if (atual === "Solicitação Reabertura" && novo === "Reaberto") return { destino: "Reaberto", acao: "aprovar_reabertura" };
    throw new Error(`Não é permitido ir de ${atual || "—"} para ${novo || "—"}.`);
  }

  /** Ações possíveis a partir do status (botões da tela). */
  function acoesDoStatus(status) {
    const s = String(status || "");
    if (s === "Rascunho" || s === "Reaberto") return [{ para: "Em aprovação", rotulo: "Enviar para aprovação", acao: "enviar" }];
    if (s === "Em aprovação") return [{ para: "Fechado", rotulo: "Aprovar", acao: "aprovar" }, { para: "Rascunho", rotulo: "Devolver para ajuste", acao: "rejeitar" }];
    if (s === "Fechado" || s === "Aprovado") return [{ para: "Solicitação Reabertura", rotulo: "Pedir reabertura", acao: "solicitar_reabertura", motivo: true }];
    if (s === "Solicitação Reabertura") return [{ para: "Reaberto", rotulo: "Aprovar reabertura", acao: "aprovar_reabertura" }, { para: "Fechado", rotulo: "Recusar reabertura", acao: "recusar_reabertura" }];
    return [];
  }

  function editavel(status) {
    return STATUS_BLOQUEADO.indexOf(String(status || "")) < 0 && String(status || "") !== "Substituído";
  }

  /** Meses fechados (1..12) do ano a partir de orion_config/fechamento_meses. */
  function mesesFechados(listaFechamento, ano) {
    return (listaFechamento || []).filter((r) => Number(r.ano) === Number(ano)).map((r) => Number(r.mes)).filter((m) => m >= 1 && m <= 12);
  }

  /** Igual a mes_fechado_alterado do Órion: devolve o 1º mês fechado (1..12) cujo valor mudou, ou 0. */
  function mesFechadoAlterado(linhaNova, linhaAntiga, fechados) {
    for (const m of (fechados || []).slice().sort((a, b) => a - b)) {
      const novo = linhaNova && linhaNova.m ? Number(linhaNova.m[m - 1]) || 0 : 0;
      const velho = linhaAntiga && linhaAntiga.m ? Number(linhaAntiga.m[m - 1]) || 0 : 0;
      if (novo !== velho) return m;
    }
    return 0;
  }

  /** Valida o conjunto de linhas antes de gravar: repetidas, mês fechado alterado e permissão do departamento. */
  function validarLinhas(linhas, antigas, opts) {
    const o = opts || {};
    const erros = [];
    const vistos = new Set();
    const mapaAnt = new Map((antigas || []).map((l) => [l.cc + "|" + l.plano, l]));
    (linhas || []).forEach((l) => {
      const k = l.cc + "|" + l.plano;
      if (!l.cc || !l.plano) erros.push("Há linha sem centro de custo ou sem plano.");
      if (vistos.has(k)) erros.push(`A combinação ${l.cc} + ${l.plano} já está no orçamento.`);
      vistos.add(k);
      const mf = mesFechadoAlterado(l, mapaAnt.get(k), o.fechados);
      if (mf) erros.push(`O mês ${MESES[mf - 1]} está fechado e não pode ser alterado (${l.cc} + ${l.plano}).`);
      if (o.cadDepartamentos && o.departamentoId != null && !lancamentoPermitido(o.cadDepartamentos, o.departamentoId, l.cc, l.plano)) {
        erros.push(`Permissão negada: o departamento não orça ${l.cc} + ${l.plano}.`);
      }
    });
    (antigas || []).forEach((a) => {
      const k = a.cc + "|" + a.plano;
      if (!vistos.has(k)) {
        const mf = mesFechadoAlterado(null, a, o.fechados);
        if (mf) erros.push(`O mês ${MESES[mf - 1]} está fechado: a linha ${a.cc} + ${a.plano} não pode ser removida.`);
      }
    });
    return [...new Set(erros)];
  }

  /** Divide linhas em blocos de documento. */
  function emBlocos(id, ref, itens, vendas) {
    const n = Math.max(1, Math.ceil(Math.max((itens || []).length, (vendas || []).length) / ITENS_POR_DOC));
    const out = [];
    for (let b = 0; b < n; b++) out.push({ _id: `${id}_${b}`, [ref]: String(id), bloco: b, itens: (itens || []).slice(b * ITENS_POR_DOC, (b + 1) * ITENS_POR_DOC), vendas: (vendas || []).slice(b * ITENS_POR_DOC, (b + 1) * ITENS_POR_DOC) });
    return out;
  }

  /* ---------- orçado x realizado (realizado pela regra do Integra: caixa e bancos) ---------- */

  /** alocacoes: [{ cc, plano, mes (1..12), valor (R$, sinal da DFC do Integra) }]; sinal: -1 despesas, +1 receitas.
   *  Devolve Map "cc|plano" -> { m: [12 centavos], total }. */
  function agregarRealizado(alocacoes, sinal) {
    const s = sinal == null ? 1 : sinal;
    const out = new Map();
    (alocacoes || []).forEach((a) => {
      const mes = Number(a.mes);
      if (!(mes >= 1 && mes <= 12)) return;
      const k = String(a.cc || "") + "|" + String(a.plano || "");
      if (!out.has(k)) out.set(k, { m: new Array(12).fill(0), total: 0 });
      const x = out.get(k);
      const c = centavos(Number(a.valor) * s);
      x.m[mes - 1] += c;
      x.total += c;
    });
    return out;
  }

  /** Linhas do orçado x realizado até o mês "ate" (1..12): orçado no período, realizado, diferença e % realizado. */
  function orcadoRealizado(linhas, realizado, ate) {
    const ateN = Math.max(0, Math.min(12, Number(ate) || 0));
    const soma = (m) => m.slice(0, ateN).reduce((s, v) => s + v, 0);
    const vistos = new Set();
    const out = (linhas || []).map((l) => {
      const k = l.cc + "|" + l.plano;
      vistos.add(k);
      const r = realizado.get(k);
      const orc = soma(l.m), rea = r ? soma(r.m) : 0;
      return { cc: l.cc, cc_nome: l.cc_nome, plano: l.plano, plano_nome: l.plano_nome, orcado_ano: l.total, orcado: orc, realizado: rea, dif: rea - orc, perc: orc ? rea / orc : null };
    });
    return { linhas: out, foraDoOrcamento: [...realizado.entries()].filter(([k]) => !vistos.has(k)).map(([k, r]) => ({ cc: k.split("|")[0], plano: k.split("|")[1], realizado: soma(r.m) })).filter((x) => x.realizado) };
  }

  /* ---------- orçamento de vendas: grade por empreendimento × plano de venda × mês ---------- */

  function chaveVenda(v) {
    return String(v.cc) + "|" + String(v.plano_venda || "") + "|" + (v.distrato ? "D" : "");
  }

  /** Linhas planas (uma por mês) -> grade [{cc, cc_nome, plano_venda, distrato, obs, meses:[{vendas, ticket}]}]. */
  function vendasParaGrade(vendas) {
    const g = new Map();
    (vendas || []).forEach((v) => {
      const distrato = (Number(v.vendas) || 0) < 0 || /distrato/i.test(String(v.obs || ""));
      const k = chaveVenda({ cc: v.cc, plano_venda: v.plano_venda, distrato });
      if (!g.has(k)) g.set(k, { cc: String(v.cc), cc_nome: v.cc_nome || "", plano_venda: v.plano_venda || "", orion_plano_venda_id: v.orion_plano_venda_id, distrato, obs: v.obs || "", origem: v.origem || "", juros_mensal: Number(v.juros_mensal) || 0, meses: Array.from({ length: 12 }, () => ({ vendas: 0, ticket: 0 })) });
      const x = g.get(k);
      const m = Number(v.mes);
      if (m >= 1 && m <= 12) {
        x.meses[m - 1].vendas += Number(v.vendas) || 0;
        if (v.ticket) x.meses[m - 1].ticket = Number(v.ticket) || 0;
        if (v.juros_mensal) x.meses[m - 1].juros = Number(v.juros_mensal) || 0; // juros do mês (o Órion guarda por mês)
      }
    });
    return [...g.values()].sort((a, b) => String(a.cc).localeCompare(String(b.cc), "pt-BR", { numeric: true }) || String(a.plano_venda).localeCompare(String(b.plano_venda), "pt-BR") || (a.distrato ? 1 : 0) - (b.distrato ? 1 : 0));
  }

  /** Grade -> linhas planas com VGV = ticket × unidades (centavos exatos). Igual ao Órion: mês vazio some,
   *  mas um empreendimento com uma só linha e tudo vazio fica com o mês 1 zerado. */
  function gradeParaVendas(grade, ano) {
    const porCc = {};
    (grade || []).forEach((l) => { porCc[l.cc] = (porCc[l.cc] || 0) + 1; });
    const out = [];
    (grade || []).forEach((l) => {
      const uteis = [];
      l.meses.forEach((m, i) => {
        const vazio = !(Number(m.vendas) || 0) && !(Number(m.ticket) || 0) && !l.obs;
        if (vazio && porCc[l.cc] > 1) return;
        if (vazio && porCc[l.cc] === 1) return;
        uteis.push(i);
      });
      if (!uteis.length && porCc[l.cc] === 1) uteis.push(0);
      uteis.forEach((i) => {
        const m = l.meses[i];
        const vendas = Number(m.vendas) || 0, ticket = Number(m.ticket) || 0;
        out.push({ cc: l.cc, cc_nome: l.cc_nome, plano_venda: l.plano_venda, orion_plano_venda_id: l.orion_plano_venda_id, ano: Number(ano), mes: i + 1,
          juros_mensal: m.juros != null ? m.juros : (l.juros_mensal || 0), ticket, vendas, vgv: ticket * vendas, origem: l.origem || "", obs: l.distrato && !/distrato/i.test(l.obs || "") ? ("Distrato " + (l.obs || "")).trim() : (l.obs || "") });
      });
    });
    return out;
  }

  function validarVendas(grade, gradeAntiga, fechados) {
    const erros = [];
    const vistos = new Set();
    const ant = new Map((gradeAntiga || []).map((l) => [chaveVenda(l), l]));
    (grade || []).forEach((l) => {
      const k = chaveVenda(l);
      if (!l.cc) erros.push("Há linha de venda sem empreendimento.");
      if (vistos.has(k)) erros.push(`Esta combinação empreendimento + plano já está no orçamento (${l.cc} · ${l.plano_venda || "sem plano"}${l.distrato ? " · distrato" : ""}).`);
      vistos.add(k);
      const a = ant.get(k);
      (fechados || []).forEach((m) => {
        const n = l.meses[m - 1], v = a ? a.meses[m - 1] : { vendas: 0, ticket: 0 };
        if ((Number(n.vendas) || 0) !== (Number(v.vendas) || 0) || (Number(n.ticket) || 0) !== (Number(v.ticket) || 0)) erros.push(`O mês ${MESES[m - 1]} está fechado e não pode ser alterado (${l.cc}).`);
      });
    });
    return [...new Set(erros)];
  }

  /* ---------- semáforo do desvio (mesma régua do Órion: lib/semaforoDesvio.ts) ---------- */

  const SEMAFORO_IMATERIAL = 500000; // R$ 5.000 em centavos
  const SEMAFORO_TOLERANCIA = 0.05;
  const SEMAFORO_LIMITE = 0.10;

  function favoravel(varC, tipo) {
    return tipo === "DESPESAS" ? varC <= 0 : varC >= 0;
  }

  /** n = realizado, ref = orçado (centavos). tipo: DESPESAS | RECEITAS | VENDAS | RESULTADO. */
  function semaforo(n, ref, tipo) {
    const v = n - ref;
    if (ref === 0 && n !== 0) return { cor: "azul", titulo: "Novo" };
    if (Math.abs(v) < SEMAFORO_IMATERIAL) return { cor: "cinza", titulo: "Imaterial" };
    const p = ref === 0 ? 0 : Math.abs(v / Math.abs(ref));
    const fav = favoravel(v, tipo);
    if (fav || p <= SEMAFORO_TOLERANCIA) return { cor: "verde", titulo: fav ? "Favorável" : "Dentro da tolerância" };
    if (p <= SEMAFORO_LIMITE) return { cor: "amarelo", titulo: "Atenção" };
    return { cor: "vermelho", titulo: "Acima do limite" };
  }

  /* ---------- DFC gerencial na visão DFC do Integra ---------- */

  /**
   * grupos: visão DFC do Integra (id, name, type, parentId) na ordem da tela.
   * orc / rea / n1: { gid: centavos com o sinal da DFC (entradas +, saídas -) }.
   * Devolve linhas na ordem da visão, com totais dos grupos-pai, AH (real x real N-1), AV (sobre o total de entradas realizado),
   * diferença e semáforo (régua do Órion, tipo RESULTADO: maior = melhor, pois os valores já têm o sinal da DFC).
   */
  function dfcGerencial(grupos, orc, rea, n1) {
    const gs = (grupos || []).filter((g) => g && g.id && g.type !== "formula");
    const filhos = {};
    gs.forEach((g) => { if (g.parentId) (filhos[g.parentId] = filhos[g.parentId] || []).push(g.id); });
    const val = (mapa, id) => {
      if (filhos[id] && filhos[id].length) return filhos[id].reduce((s, f) => s + val(mapa, f), 0);
      return Number((mapa || {})[id]) || 0;
    };
    const entradas = gs.filter((g) => !g.parentId && /^g_01$/.test(g.id)).reduce((s, g) => s + val(rea, g.id), 0);
    const linhas = gs.map((g) => {
      const o = val(orc, g.id), r = val(rea, g.id), a = val(n1, g.id);
      return {
        id: g.id, nome: g.name || g.nome || g.id, nivel: g.parentId ? 2 : 1,
        orcado: o, realizado: r, n1: a, dif: r - o,
        ah: a ? (r - a) / Math.abs(a) : null,
        av: entradas ? r / entradas : null,
        semaforo: semaforo(r, o, "RESULTADO")
      };
    });
    const topo = gs.filter((g) => !g.parentId);
    const total = (m) => topo.reduce((s, g) => s + val(m, g.id), 0);
    return { linhas, geracao: { orcado: total(orc), realizado: total(rea), n1: total(n1), semaforo: semaforo(total(rea), total(orc), "RESULTADO") }, entradas };
  }

  /** Soma linhas de orçamento por grupo da DFC. grupoDe(plano) -> gid; sinal: +1 receitas, -1 despesas. */
  function orcadoPorGrupo(linhas, grupoDe, sinal, ate) {
    const out = {};
    const ateN = ate == null ? 12 : Number(ate);
    (linhas || []).forEach((l) => {
      const g = grupoDe(l.plano);
      if (!g) return;
      const v = (l.m || []).slice(0, ateN).reduce((s, x) => s + (Number(x) || 0), 0) * sinal;
      out[g] = (out[g] || 0) + v;
    });
    return out;
  }

  return { SEMAFORO_IMATERIAL, semaforo, dfcGerencial, orcadoPorGrupo, vendasParaGrade, gradeParaVendas, validarVendas, agregarRealizado, orcadoRealizado, STATUS_BLOQUEADO, ACOES_GESTOR, resolverTransicao, acoesDoStatus, editavel, mesesFechados, mesFechadoAlterado, validarLinhas, emBlocos,
    prepararDepartamentos, lancamentoPermitido, MESES, ITENS_POR_DOC, centavos, reais, fmtReais, somaMeses, somarLinhas, mapas, prepararDocumentos, juntarBlocos, agrupar, diferencaVersoes };
});
