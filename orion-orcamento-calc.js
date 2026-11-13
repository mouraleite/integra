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

  /** Valor digitado ou colado do Excel em português na tela: ponto é separador de milhar ("1.234" = mil duzentos e trinta e quatro). */
  function centavosDigitado(v) {
    if (typeof v !== "string") return centavos(v);
    const t = v.trim().replace(/\s/g, "").replace("R$", "");
    if (t.indexOf(",") < 0 && ((t.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t))) return centavos(t.replace(/\./g, ""));
    return centavos(t);
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

  /* ---------- Resumo geral (Dashboard de Orçamento do Órion) ---------- */

  /**
   * desp / rec: linhas do orçamento (ou forecast) {cc, cc_nome, plano, plano_nome, m[12] em centavos}, com cc e plano só dígitos.
   * alocacoes: realizado de OrionRealizado.buscar (sinal da DFC: entradas +, saídas -).
   * meses: lista de 1..12 a considerar (padrão: todos).
   * Realizado de cada tipo = centros de custo e planos que aparecem nas linhas daquele tipo (mesma regra da tela do orçamento),
   * despesas com sinal invertido (saída vira positivo). Devolve KPIs, série mensal, ranking dos 10 maiores desvios e detalhe por CC › plano.
   */
  function resumoGeral(desp, rec, alocacoes, meses) {
    const ms = (meses && meses.length ? meses : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).map(Number).filter((m) => m >= 1 && m <= 12);
    const usa = new Array(12).fill(false);
    ms.forEach((m) => { usa[m - 1] = true; });
    const lado = (linhas, sinal, tipo) => {
      const ccs = new Set(), planos = new Set(), orc = new Map();
      (linhas || []).forEach((l) => {
        ccs.add(l.cc); planos.add(l.plano);
        const k = l.cc + "|" + l.plano;
        if (!orc.has(k)) orc.set(k, { cc: l.cc, cc_nome: l.cc_nome || "", plano: l.plano, plano_nome: l.plano_nome || "", tipo, o: new Array(12).fill(0), r: new Array(12).fill(0) });
        const x = orc.get(k);
        (l.m || []).forEach((v, i) => { x.o[i] += Number(v) || 0; });
      });
      (alocacoes || []).forEach((a) => {
        const cc = String(a.cc || ""), pl = String(a.plano || ""), mes = Number(a.mes);
        if (!ccs.has(cc) || !planos.has(pl) || !(mes >= 1 && mes <= 12)) return;
        const k = cc + "|" + pl;
        if (!orc.has(k)) orc.set(k, { cc, cc_nome: "", plano: pl, plano_nome: "", tipo, o: new Array(12).fill(0), r: new Array(12).fill(0), fora: true });
        orc.get(k).r[mes - 1] += centavos(Number(a.valor) * sinal);
      });
      return [...orc.values()];
    };
    const itens = lado(desp, -1, "DESPESAS").concat(lado(rec, 1, "RECEITAS"));
    const tot = (x, campo) => x[campo].reduce((s, v, i) => s + (usa[i] ? v : 0), 0);
    itens.forEach((x) => { x.orcado = tot(x, "o"); x.realizado = tot(x, "r"); x.dif = x.realizado - x.orcado; x.semaforo = semaforo(x.realizado, x.orcado, x.tipo); });
    const somaTipo = (t, campo) => itens.filter((x) => x.tipo === t).reduce((s, x) => s + x[campo], 0);
    const mensal = [];
    for (let i = 0; i < 12; i++) {
      const s = (t, c) => itens.filter((x) => x.tipo === t).reduce((a, x) => a + x[c][i], 0);
      const dO = s("DESPESAS", "o"), dR = s("DESPESAS", "r"), rO = s("RECEITAS", "o"), rR = s("RECEITAS", "r");
      mensal.push({ mes: i + 1, usado: usa[i], desp_orcado: dO, desp_realizado: dR, rec_orcado: rO, rec_realizado: rR, res_orcado: rO - dO, res_realizado: rR - dR });
    }
    const kpi = (o, r, tipo) => ({ orcado: o, realizado: r, saldo: r - o, perc: o ? (r - o) / Math.abs(o) : null, semaforo: semaforo(r, o, tipo) });
    const dO = somaTipo("DESPESAS", "orcado"), dR = somaTipo("DESPESAS", "realizado"), rO = somaTipo("RECEITAS", "orcado"), rR = somaTipo("RECEITAS", "realizado");
    const kpis = { despesas: kpi(dO, dR, "DESPESAS"), receitas: kpi(rO, rR, "RECEITAS"), resultado: kpi(rO - dO, rR - dR, "RESULTADO") };
    const ranking = itens.filter((x) => x.dif).slice().sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, 10);
    const porCc = new Map();
    itens.forEach((x) => {
      const k = x.tipo + "|" + x.cc;
      if (!porCc.has(k)) porCc.set(k, { tipo: x.tipo, cc: x.cc, cc_nome: x.cc_nome, orcado: 0, realizado: 0, planos: [] });
      const g = porCc.get(k);
      if (!g.cc_nome && x.cc_nome) g.cc_nome = x.cc_nome;
      g.orcado += x.orcado; g.realizado += x.realizado; g.planos.push(x);
    });
    const grupos = [...porCc.values()].map((g) => Object.assign(g, { dif: g.realizado - g.orcado, semaforo: semaforo(g.realizado, g.orcado, g.tipo),
      planos: g.planos.sort((a, b) => String(a.plano).localeCompare(String(b.plano), "pt-BR", { numeric: true })) }))
      .sort((a, b) => (a.tipo === b.tipo ? String(a.cc).localeCompare(String(b.cc), "pt-BR", { numeric: true }) : a.tipo === "RECEITAS" ? -1 : 1));
    return { kpis, mensal, ranking, grupos, meses: ms };
  }

  /**
   * Analítico de gastos (Órion I e II): só despesas, com orçado e realizado mês a mês.
   * visao "cc" = uma linha por centro de custo × plano (Analítico I); "plano" = uma linha por plano, com os centros de custo dentro (Analítico II).
   */
  function analiticoGastos(desp, alocacoes, meses, visao, tipo) {
    const ehRec = String(tipo || "").toUpperCase() === "RECEITAS";
    const r = ehRec ? resumoGeral([], desp, alocacoes, meses) : resumoGeral(desp, [], alocacoes, meses);
    const usa = new Array(12).fill(false);
    r.meses.forEach((m) => { usa[m - 1] = true; });
    const fecha = (x) => {
      x.orcado = x.o.reduce((s, v, i) => s + (usa[i] ? v : 0), 0);
      x.realizado = x.r.reduce((s, v, i) => s + (usa[i] ? v : 0), 0);
      x.saldo = ehRec ? x.realizado - x.orcado : x.orcado - x.realizado;
      x.perc = x.orcado ? (x.realizado - x.orcado) / Math.abs(x.orcado) : null;
      x.semaforo = semaforo(x.realizado, x.orcado, ehRec ? "RECEITAS" : "DESPESAS");
      return x;
    };
    const itens = [];
    r.grupos.forEach((g) => g.planos.forEach((p) => itens.push(Object.assign({}, p, { cc_nome: p.cc_nome || g.cc_nome }))));
    let linhas;
    if (visao === "grupo") {
      const m = new Map();
      itens.forEach((x) => {
        const gk = grupoRecebimento(x.plano_nome);
        if (!m.has(gk)) m.set(gk, { chave: "g" + gk, plano: "", plano_nome: gk, grupo: gk, o: new Array(12).fill(0), r: new Array(12).fill(0), filhos: [] });
        const g = m.get(gk);
        x.o.forEach((v, i) => { g.o[i] += v; });
        x.r.forEach((v, i) => { g.r[i] += v; });
        g.filhos.push(fecha(Object.assign({}, x, { chave: "g" + gk + "|" + x.cc + "|" + x.plano })));
      });
      linhas = [...m.values()].map(fecha).sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"));
    } else if (visao === "plano") {
      const m = new Map();
      itens.forEach((x) => {
        if (!m.has(x.plano)) m.set(x.plano, { chave: "p" + x.plano, plano: x.plano, plano_nome: "", o: new Array(12).fill(0), r: new Array(12).fill(0), filhos: [] });
        const g = m.get(x.plano);
        if (!g.plano_nome && x.plano_nome) g.plano_nome = x.plano_nome;
        x.o.forEach((v, i) => { g.o[i] += v; });
        x.r.forEach((v, i) => { g.r[i] += v; });
        g.filhos.push(fecha(Object.assign({}, x, { chave: "p" + x.plano + "|" + x.cc })));
      });
      linhas = [...m.values()].map(fecha).sort((a, b) => String(a.plano).localeCompare(String(b.plano), "pt-BR", { numeric: true }));
      linhas.forEach((g) => g.filhos.sort((a, b) => String(a.cc).localeCompare(String(b.cc), "pt-BR", { numeric: true })));
    } else {
      linhas = itens.map((x) => fecha(Object.assign({}, x, { chave: x.cc + "|" + x.plano })));
    }
    const total = fecha({ o: new Array(12).fill(0).map((_, i) => linhas.reduce((s, x) => s + x.o[i], 0)), r: new Array(12).fill(0).map((_, i) => linhas.reduce((s, x) => s + x.r[i], 0)) });
    const comDesvio = linhas.filter((x) => x.semaforo.cor === "amarelo" || x.semaforo.cor === "vermelho").length;
    return { linhas, total, meses: r.meses, comDesvio };
  }

  /**
   * Análise de Orçamento (Órion: despesas por empreendimento). Árvore empresa › grupo › centro de custo › plano.
   * N (projeção) = realizado nos meses até o corte + forecast nos meses seguintes; comparado com o orçado e com o forecast.
   * Períodos: ano, YTD (até o corte) e YTG (depois do corte). Despesas em positivo (centavos).
   * o: entrada { orc: linhas do orçamento, fc: linhas do forecast, alocacoes, corte, grupoDe(plano)->{id,nome}|null, empresaDe(cc)->{id,nome} }.
   */
  function analiseOrcamento(o) {
    const corte = Math.max(0, Math.min(12, Number(o.corte) || 0));
    const folhas = new Map();
    const folha = (cc, pl, cn, pn) => {
      const k = cc + "|" + pl;
      if (!folhas.has(k)) folhas.set(k, { cc, plano: pl, cc_nome: cn || "", plano_nome: pn || "", orc: new Array(12).fill(0), fc: new Array(12).fill(0), real: new Array(12).fill(0) });
      const f = folhas.get(k);
      if (!f.cc_nome && cn) f.cc_nome = cn;
      if (!f.plano_nome && pn) f.plano_nome = pn;
      return f;
    };
    const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    (o.orc || []).forEach((l) => { const f = folha(dig(l.cc), dig(l.plano), l.cc_nome, l.plano_nome); (l.m || []).forEach((v, i) => { f.orc[i] += Number(v) || 0; }); });
    (o.fc || []).forEach((l) => { const f = folha(dig(l.cc), dig(l.plano), l.cc_nome, l.plano_nome); (l.m || []).forEach((v, i) => { f.fc[i] += Number(v) || 0; }); });
    const ccs = new Set([...folhas.values()].map((f) => f.cc)), planos = new Set([...folhas.values()].map((f) => f.plano));
    (o.alocacoes || []).forEach((a) => {
      const cc = dig(a.cc), pl = dig(a.plano), m = Number(a.mes);
      if (!ccs.has(cc) || !planos.has(pl) || !(m >= 1 && m <= 12)) return;
      folha(cc, pl).real[m - 1] += centavos(-Number(a.valor));
    });
    const soma = (arr, de, ate) => arr.slice(de, ate).reduce((s, v) => s + v, 0);
    const per = (x) => {
      const n = x.real.map((v, i) => (i < corte ? v : x.fc[i]));
      const p = (de, ate) => ({ n: soma(n, de, ate), orcado: soma(x.orc, de, ate), forecast: soma(x.fc, de, ate), realizado: soma(x.real, de, ate) });
      return { meses_n: n, ano: p(0, 12), ytd: p(0, corte), ytg: p(corte, 12) };
    };
    const somaVet = (lista, campo) => { const v = new Array(12).fill(0); lista.forEach((x) => x[campo].forEach((y, i) => { v[i] += y; })); return v; };
    const no = (tipo, id, nome, filhos, base) => {
      const x = base || { orc: somaVet(filhos, "orc"), fc: somaVet(filhos, "fc"), real: somaVet(filhos, "real") };
      return Object.assign({ tipo, id, nome, filhos: filhos || [] }, x, per(x));
    };
    const arv = new Map();
    let semGrupo = 0;
    folhas.forEach((f) => {
      const g = o.grupoDe ? o.grupoDe(f.plano) : null;
      if (!g) { semGrupo++; return; }
      const e = (o.empresaDe && o.empresaDe(f.cc)) || { id: "_sem", nome: "Sem empresa" };
      if (!arv.has(e.id)) arv.set(e.id, { e, grupos: new Map() });
      const ge = arv.get(e.id).grupos;
      if (!ge.has(g.id)) ge.set(g.id, { g, ccs: new Map() });
      const cm = ge.get(g.id).ccs;
      if (!cm.has(f.cc)) cm.set(f.cc, []);
      cm.get(f.cc).push(f);
    });
    const cmp = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true });
    const empresas = [...arv.values()].sort((a, b) => cmp(a.e.nome, b.e.nome)).map(({ e, grupos }) =>
      no("empresa", e.id, e.nome, [...grupos.values()].sort((a, b) => cmp(a.g.id, b.g.id)).map(({ g, ccs: cm }) =>
        no("grupo", e.id + "|" + g.id, g.nome, [...cm.entries()].sort((a, b) => cmp(a[0], b[0])).map(([cc, fs]) =>
          no("centro", e.id + "|" + g.id + "|" + cc, `${cc} ${fs[0].cc_nome || ""}`.trim(),
            fs.sort((a, b) => cmp(a.plano, b.plano)).map((f) => no("plano", e.id + "|" + g.id + "|" + cc + "|" + f.plano, `${f.plano} ${f.plano_nome || ""}`.trim(), [], { orc: f.orc, fc: f.fc, real: f.real }))))))));
    const total = no("total", "total", "Total", empresas);
    return { empresas, total, corte, semGrupo };
  }

  /**
   * Análise de Orçamento no formato atual do Órion: N = realizado do ano até o corte + forecast do ano depois do corte,
   * contra a referência do ano seguinte (orçado ou forecast), mês a mês, cheio e MLDU (% de consolidação da empresa).
   * o: { n_fc: linhas do forecast do ano, n_real: alocações do ano (sinal da DFC), ref: linhas da referência (ano seguinte),
   *      corte (1..12), grupoDe(plano)->{id,nome}|null, empresaDe(cc)->{id,nome,fator} }. Despesa positiva (centavos).
   * Árvore empresa › grupo › empreendimento (centro de custo) › plano, com meses e totais YTD / YTG / FY.
   */
  function analiseOrcamentoAnual(o) {
    const corte = Math.max(0, Math.min(12, Number(o.corte) || 0));
    const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    const folhas = new Map();
    const folha = (cc, pl, cn, pn) => {
      const k = cc + "|" + pl;
      if (!folhas.has(k)) folhas.set(k, { cc, plano: pl, cc_nome: cn || "", plano_nome: pn || "", fc: new Array(12).fill(0), real: new Array(12).fill(0), ref: new Array(12).fill(0) });
      const f = folhas.get(k);
      if (!f.cc_nome && cn) f.cc_nome = cn;
      if (!f.plano_nome && pn) f.plano_nome = pn;
      return f;
    };
    (o.n_fc || []).forEach((l) => { const f = folha(dig(l.cc), dig(l.plano), l.cc_nome, l.plano_nome); (l.m || []).forEach((v, i) => { f.fc[i] += Number(v) || 0; }); });
    (o.ref || []).forEach((l) => { const f = folha(dig(l.cc), dig(l.plano), l.cc_nome, l.plano_nome); (l.m || []).forEach((v, i) => { f.ref[i] += Number(v) || 0; }); });
    const ccs = new Set([...folhas.values()].map((f) => f.cc)), planos = new Set([...folhas.values()].map((f) => f.plano));
    (o.n_real || []).forEach((a) => {
      const cc = dig(a.cc), pl = dig(a.plano), m = Number(a.mes);
      if (!ccs.has(cc) || !planos.has(pl) || !(m >= 1 && m <= corte)) return;
      folha(cc, pl).real[m - 1] += centavos(-Number(a.valor));
    });
    const z = () => new Array(12).fill(0);
    const serie = (f, fator) => {
      const n = f.real.map((v, i) => (i < corte ? v : f.fc[i]));
      return { n, ref: f.ref.slice(), n_mldu: n.map((v) => Math.round(v * fator)), ref_mldu: f.ref.map((v) => Math.round(v * fator)) };
    };
    const somaSeries = (lista) => { const out = { n: z(), ref: z(), n_mldu: z(), ref_mldu: z() }; lista.forEach((x) => ["n", "ref", "n_mldu", "ref_mldu"].forEach((k) => x[k].forEach((v, i) => { out[k][i] += v; }))); return out; };
    const periodos = (x) => {
      const p = (de, ate) => { const o2 = {}; ["n", "ref", "n_mldu", "ref_mldu"].forEach((k) => { o2[k] = x[k].slice(de, ate).reduce((a, b) => a + b, 0); }); return o2; };
      return { ytd: p(0, corte), ytg: p(corte, 12), fy: p(0, 12) };
    };
    const no = (tipo, id, nome, codigo, filhos, base) => { const x = base || somaSeries(filhos); return Object.assign({ tipo, id, nome, codigo, filhos: filhos || [] }, x, { per: periodos(x) }); };
    const arv = new Map();
    let semGrupo = 0;
    folhas.forEach((f) => {
      const g = o.grupoDe ? o.grupoDe(f.plano) : null;
      if (!g) { semGrupo++; return; }
      const e = (o.empresaDe && o.empresaDe(f.cc)) || { id: "_sem", nome: "Sem empresa", fator: 0 };
      if (!arv.has(e.id)) arv.set(e.id, { e, grupos: new Map() });
      const ge = arv.get(e.id).grupos;
      if (!ge.has(g.id)) ge.set(g.id, { g, ccs: new Map() });
      const cm = ge.get(g.id).ccs;
      if (!cm.has(f.cc)) cm.set(f.cc, []);
      cm.get(f.cc).push(f);
    });
    const cmp = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true });
    const vazio = (x) => !["n", "ref"].some((k) => x[k].some((v) => v));
    const empresas = [];
    [...arv.values()].sort((a, b) => cmp(a.e.nome, b.e.nome)).forEach(({ e, grupos }) => {
      const gs = [];
      [...grupos.values()].sort((a, b) => cmp(a.g.codigo || a.g.id, b.g.codigo || b.g.id)).forEach(({ g, ccs: cm }) => {
        const cs = [];
        [...cm.entries()].sort((a, b) => cmp(a[0], b[0])).forEach(([cc, fs]) => {
          const ps = fs.sort((a, b) => cmp(a.plano, b.plano))
            .map((f) => no("plano", e.id + "|" + g.id + "|" + cc + "|" + f.plano, f.plano_nome || f.plano, f.plano, [], serie(f, Number(e.fator) || 0)))
            .filter((x) => !vazio(x));
          if (ps.length) cs.push(no("centro", e.id + "|" + g.id + "|" + cc, fs[0].cc_nome || cc, cc, ps));
        });
        if (cs.length) gs.push(no("grupo", e.id + "|" + g.id, g.nome, g.codigo || "", cs));
      });
      if (gs.length) empresas.push(no("empresa", e.id, e.nome, e.id, gs));
    });
    return { empresas, total: no("total", "total", "Total", "", empresas), corte, semGrupo };
  }

  /**
   * DFC gerencial no formato atual do Órion: mês a mês, séries Real, Real MLDU, N-1, N-1 MLDU, Referência (orçado ou forecast)
   * e Referência MLDU, com AH (real × N-1) e AV (sobre as entradas realizadas). Árvore empresa › grupo da visão DFC › plano
   * (agrupar = "visao") ou › centro de custo (agrupar = "centro"). Valores com o sinal da DFC (entradas +, saídas −), centavos.
   * o: { real, n1: alocações (reais, sinal DFC, com gid, empresa, cc, plano, mes); ref: linhas {cc, plano, m[12], sinal};
   *      grupoDe(plano)->gid; grupos: [{id, name, code}]; empresaDe(cc ou empresa)->{id, nome, fator}; nomeCc, nomePlano }.
   */
  function dfcGerencialMensal(o) {
    const SER = ["real", "real_mldu", "n1", "n1_mldu", "ref", "ref_mldu"];
    const z = () => new Array(12).fill(0);
    const folhas = new Map();
    const gnome = {};
    (o.grupos || []).forEach((g) => { if (g && g.id) gnome[g.id] = g; });
    const folha = (emp, gid, chave, nome) => {
      const k = emp.id + "|" + gid + "|" + chave;
      if (!folhas.has(k)) { const f = { emp, gid, chave, nome }; SER.forEach((x) => { f[x] = z(); }); folhas.set(k, f); }
      return folhas.get(k);
    };
    const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    const porCentro = o.agrupar === "centro";
    const add = (lista, serie) => (lista || []).forEach((a) => {
      const m = Number(a.mes);
      if (!a.gid || !(m >= 1 && m <= 12)) return;
      const emp = o.empresaDe(dig(a.cc), String(a.empresa || ""));
      const ch = porCentro ? dig(a.cc) : dig(a.plano);
      const f = folha(emp, a.gid, ch, porCentro ? (o.nomeCc ? o.nomeCc(ch) : ch) : (o.nomePlano ? o.nomePlano(ch) : ch));
      const c = centavos(Number(a.valor));
      f[serie][m - 1] += c;
      f[serie + "_mldu"][m - 1] += Math.round(c * (Number(emp.fator) || 0));
    });
    add(o.real, "real");
    add(o.n1, "n1");
    (o.ref || []).forEach((l) => {
      const gid = o.grupoDe(dig(l.plano));
      if (!gid) return;
      const emp = o.empresaDe(dig(l.cc), "");
      const ch = porCentro ? dig(l.cc) : dig(l.plano);
      const f = folha(emp, gid, ch, porCentro ? (l.cc_nome || ch) : (l.plano_nome || ch));
      (l.m || []).forEach((v, i) => { const c = (Number(v) || 0) * (l.sinal || 1); f.ref[i] += c; f.ref_mldu[i] += Math.round(c * (Number(emp.fator) || 0)); });
    });
    const soma = (lista) => { const x = {}; SER.forEach((k) => { x[k] = z(); lista.forEach((y) => y[k].forEach((v, i) => { x[k][i] += v; })); }); return x; };
    const tot = (x) => { const t = {}; SER.forEach((k) => { t[k] = x[k].reduce((a, b) => a + b, 0); }); return t; };
    const no = (tipo, id, codigo, nome, filhos, base) => { const x = base || soma(filhos); return Object.assign({ tipo, id, codigo, nome, filhos: filhos || [] }, x, { total: tot(x) }); };
    const cmp = (a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true });
    const arv = new Map();
    folhas.forEach((f) => {
      if (!arv.has(f.emp.id)) arv.set(f.emp.id, { emp: f.emp, g: new Map() });
      const g = arv.get(f.emp.id).g;
      if (!g.has(f.gid)) g.set(f.gid, []);
      g.get(f.gid).push(f);
    });
    const empresas = [...arv.values()].sort((a, b) => cmp(a.emp.id, b.emp.id)).map(({ emp, g }) => no("empresa", emp.id, emp.id, emp.nome,
      [...g.entries()].sort((a, b) => cmp((gnome[a[0]] || {}).code || a[0], (gnome[b[0]] || {}).code || b[0])).map(([gid, fs]) => no("categoria", emp.id + "|" + gid, (gnome[gid] || {}).code || "", (gnome[gid] || {}).name || gid,
        fs.sort((a, b) => cmp(a.chave, b.chave)).map((f) => no(porCentro ? "centro" : "plano", emp.id + "|" + gid + "|" + f.chave, f.chave, f.nome, [], f))))));
    const total = no("total", "total", "", "Geração de caixa", empresas);
    const entradas = (x) => x.real.reduce((s2, v) => s2 + (v > 0 ? v : 0), 0);
    const totEnt = empresas.reduce((s2, e) => s2 + e.filhos.reduce((s3, c) => s3 + Math.max(0, c.total.real), 0), 0);
    const ahav = (x) => { x.ah = x.total.n1 ? (x.total.real - x.total.n1) / Math.abs(x.total.n1) : null; x.av = totEnt ? x.total.real / totEnt : null; x.ah_m = x.real.map((v, i) => (x.n1[i] ? (v - x.n1[i]) / Math.abs(x.n1[i]) : null)); (x.filhos || []).forEach(ahav); };
    ahav(total);
    void entradas;
    return { empresas, total };
  }

  /**
   * Leitura executiva de um bloco (Órion › Orçado × Realizado › Consolidado): linhas {produto, produto_nome, plano, plano_nome, ref, real}
   * em centavos (despesa positiva). tipo: DESPESAS | RECEITAS | RESULTADO. Devolve totais, veredito, pontos de atenção
   * (desvio material ≥ 5%, concentração ≥ 25%), maiores causas por empreendimento e as linhas com peso no desvio.
   */
  function insightsBloco(linhas, tipo, rotulo) {
    const inv = tipo === "DESPESAS";
    const fav = (v) => (inv ? v <= 0 : v >= 0);
    const ls = (linhas || []).map((l) => { const v = l.real - l.ref; return Object.assign({}, l, { var: v, abs: Math.abs(v), perc: l.ref ? v / Math.abs(l.ref) : (l.real ? 1 : 0), favoravel: fav(v), semaforo: semaforo(l.real, l.ref, tipo) }); })
      .filter((l) => l.abs > 0).sort((a, b) => b.abs - a.abs);
    const ref = (linhas || []).reduce((s2, l) => s2 + l.ref, 0), real = (linhas || []).reduce((s2, l) => s2 + l.real, 0);
    const v = real - ref, perc = ref ? v / Math.abs(ref) : 0;
    const totAbs = ls.reduce((s2, l) => s2 + l.abs, 0) || 1;
    ls.forEach((l) => { l.peso = l.abs / totAbs; });
    const agrupa = (campo, nome) => {
      const m = new Map();
      ls.forEach((l) => { const k = l[campo]; if (!m.has(k)) m.set(k, { chave: k, nome: l[nome] || k, var: 0, abs: 0, ref: 0, real: 0 }); const g = m.get(k); g.var += l.var; g.abs += l.abs; g.ref += l.ref; g.real += l.real; });
      return [...m.values()].map((g) => Object.assign(g, { peso: g.abs / totAbs, favoravel: fav(g.var) })).sort((a, b) => b.abs - a.abs);
    };
    const favoravel = fav(v);
    const alertas = [];
    if (!favoravel && Math.abs(perc) >= 0.05) alertas.push({ tom: "vermelho", titulo: "Desvio material", detalhe: `${rotulo}: referência ${fmtReais(ref, true)} · realizado ${fmtReais(real, true)} (${(perc * 100).toFixed(1)}%).` });
    if (ls[0] && ls[0].peso >= 0.25) alertas.push({ tom: "amarelo", titulo: "Concentração de desvio", detalhe: `${ls[0].produto_nome || ls[0].produto} · ${ls[0].plano_nome || ls[0].plano} concentra ${(ls[0].peso * 100).toFixed(0)}% do desvio absoluto.` });
    const sinal = v >= 0 ? "acima" : "abaixo";
    const narrativa = `${rotulo} ${sinal} da referência em ${fmtReais(Math.abs(v), true)} (${(Math.abs(perc) * 100).toFixed(1)}%). ` +
      (favoravel ? `${ls.length} linha(s) com desvio; resultado favorável.` : `Revise os ${Math.min(5, ls.length)} maiores desvios abaixo.`);
    return { ref, real, var: v, perc, favoravel, veredito: v === 0 ? "neutro" : favoravel ? "favoravel" : "desfavoravel", linhas: ls, porProduto: agrupa("produto", "produto_nome"), porPlano: agrupa("plano", "plano_nome"), alertas, narrativa,
      contagem: { comDesvio: ls.length, favoravel: ls.filter((l) => l.favoravel).length, desfavoravel: ls.filter((l) => !l.favoravel).length } };
  }

  /** Grupo de recebimento pelo nome do plano (mesma regra do Órion: Recebimento por Grupo). */
  function grupoRecebimento(nome) {
    const n = String(nome || "").toUpperCase();
    if (/A VISTA|À VISTA|AVISTA/.test(n)) return "À vista";
    if (/SINAL|ENTRADA|ANTECIP/.test(n)) return "Sinal / antecipação";
    if (/PARCEL|FINANCI|BANCO|FGTS|CREDITO|CRÉDITO/.test(n)) return "Parcelado / financiamento";
    if (/MENSAL|ANUAL|RECORREN/.test(n)) return "Recorrente";
    return "Outros";
  }

  /** Recortes por nome do plano, iguais aos do Órion (Investimentos e Receita de Lotes). */
  const RECORTES = {
    investimentos: { rotulo: "Investimentos e participações", tipo: "DESPESAS", re: /investimento|participaç|participac|aporte|divid/i },
    lotes: { rotulo: "Receita de lotes", tipo: "RECEITAS", re: /loteamento|venda de lote|receita de venda de lote/i }
  };
  function filtrarRecorte(linhas, recorte) {
    const r = RECORTES[recorte];
    if (!r) return linhas || [];
    return (linhas || []).filter((l) => r.re.test(String(l.plano_nome || "")));
  }

  /* ---------- escolha dos documentos vigentes (orçamento ou uma versão do forecast) ---------- */

  /** Versões de forecast do ano (pela descrição, ex. "Forecast - 8+4"), da mais recente (maior mês de corte) para a mais antiga. */
  function versoesForecast(cabs, ano, tipos) {
    const tp = (tipos || ["DESPESAS", "RECEITAS"]).map((t) => t.toUpperCase());
    const m = new Map();
    (cabs || []).forEach((c) => {
      if (String(c.ano) !== String(ano) || c.status === "Substituído" || tp.indexOf(String(c.tipo).toUpperCase()) < 0) return;
      const d = String(c.descricao || "");
      const corte = Number(c.mes_corte) || 0;
      if (!m.has(d) || corte > m.get(d).corte) m.set(d, { descricao: d, corte });
    });
    return [...m.values()].sort((a, b) => (b.corte - a.corte) || b.descricao.localeCompare(a.descricao, "pt-BR", { numeric: true }));
  }

  /**
   * Documentos que entram nas telas de acompanhamento: do ano, dos tipos pedidos, sem substituídos, do departamento (ou todos).
   * Forecast: só uma versão (a escolhida ou, se vazia, a mais recente); somar versões diferentes contaria o mesmo gasto várias vezes.
   * Em cada documento (tipo × descrição × departamento × empreendimento) fica o de maior número de versão.
   */
  /** Ordem de criação (o Órion usa o maior id): data de criação e, no empate, o id do Órion. */
  function maisNovo(a, b) {
    const ca = String(a.criado_em || ""), cb = String(b.criado_em || "");
    if (ca !== cb) return ca > cb ? a : b;
    return (Number(a.orion_id) || 0) >= (Number(b.orion_id) || 0) ? a : b;
  }

  /**
   * Documentos que entram nas telas de acompanhamento (mesma regra do Órion, escolher_documentos_leitura):
   * - orçamento: um por departamento e tipo — o mais novo Aprovado/Fechado; se não houver, a foto do reaberto; senão o mais novo não substituído;
   * - forecast: só a versão escolhida (ou, sem escolha, a de maior mês de corte), um documento por departamento e tipo.
   * Somar documentos diferentes do mesmo departamento contaria o mesmo gasto duas vezes.
   */
  function documentosVigentes(cabs, o) {
    const tp = (o.tipos || ["DESPESAS", "RECEITAS"]).map((t) => t.toUpperCase());
    let versao = "";
    if (o.base === "forecast") {
      const vs = versoesForecast(cabs, o.ano, tp);
      versao = o.versao && vs.some((v) => v.descricao === o.versao) ? o.versao : (vs[0] ? vs[0].descricao : "");
    }
    const doAno = (cabs || []).filter((c) => String(c.ano) === String(o.ano) && tp.indexOf(String(c.tipo).toUpperCase()) >= 0 &&
      (!o.dept || o.dept === "TODOS" || String(c.departamento ? c.departamento.id : "") === String(o.dept)));
    const grupos = new Map();
    doAno.forEach((c) => {
      const k = String(c.tipo).toUpperCase() + "|" + (c.departamento ? c.departamento.id : "");
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(c);
    });
    const docs = [];
    grupos.forEach((l) => {
      if (o.base === "forecast") {
        const da = l.filter((c) => c.status !== "Substituído" && String(c.descricao || "") === versao);
        if (da.length) docs.push(da.reduce((a, b) => ((Number(b.versao) || 0) > (Number(a.versao) || 0) ? b : a)));
        return;
      }
      const aprov = l.filter((c) => c.status === "Aprovado" || c.status === "Fechado");
      if (aprov.length) { docs.push(aprov.reduce(maisNovo)); return; }
      const reab = l.filter((c) => c.status === "Reaberto" || c.status === "Solicitação Reabertura");
      if (reab.length) {
        const r = reab.reduce(maisNovo);
        const foto = l.filter((c) => c.status === "Substituído" && (String(c.versao_base) === String(r._id) || String(c.foto_de || "") === String(r._id)));
        if (foto.length) { docs.push(foto.reduce(maisNovo)); return; }
      }
      const vivos = l.filter((c) => c.status !== "Substituído");
      if (vivos.length) docs.push(vivos.reduce(maisNovo));
    });
    return { docs, versao };
  }

  /**
   * Nome da versão como o Órion mostra (format_visualizacao_versao_label): orçamento vira "Orçamento" (carga inicial do Sienge,
   * "1ª versão" e "Orçamento base" também); forecast vira "Forecast - N+M". base: "orcamento" | "forecast".
   */
  function rotuloVersao(descricao, base) {
    const t = String(descricao || "").trim(), low = t.toLowerCase();
    if (base === "orcamento" || base === "orcamentos") {
      if (!t || /1\s*[ªºo°]?\s*vers/i.test(t) || ["orçamento", "orcamento", "orçamento base", "orcamento base"].indexOf(low) >= 0 || low.indexOf("orçamento vendas") >= 0 || low.indexOf("orcamento vendas") >= 0 || low.indexOf("carga inicial sienge") >= 0) return "Orçamento";
      if (low.startsWith("orçamento") || low.startsWith("orcamento")) return t;
      return "Orçamento — " + t;
    }
    const m = t.match(/(\d+)\s*\+\s*(\d+)/);
    if (!t) return "Forecast";
    if (m) return `Forecast - ${Number(m[1])}+${Number(m[2])}`;
    return low.startsWith("forecast") ? t : "Forecast — " + t;
  }

  /* ---------- novo orçamento / nova versão de forecast (regra do Órion) ---------- */

  const DESCRICAO_ORCAMENTO = "Orçamento";

  /** Último mês fechado em sequência desde janeiro (tela Fechamento de meses); sem fechamento no ano, usa o calendário. */
  function corteForecast(fechamento, ano, hoje) {
    const fechados = new Set((fechamento || []).filter((x) => Number(x.ano) === Number(ano)).map((x) => Number(x.mes)));
    if (fechados.size) { let n = 0; while (n < 12 && fechados.has(n + 1)) n++; return n; }
    const h = hoje || new Date();
    if (Number(ano) === h.getFullYear()) return h.getMonth();
    return Number(ano) < h.getFullYear() ? 12 : 0;
  }
  function descricaoForecast(corte) { return `Forecast - ${corte}+${12 - corte}`; }

  /**
   * Onde incluir um empreendimento: o documento do departamento para o ano, tipo e descrição (no Órion é um documento
   * por departamento com vários empreendimentos dentro). Devolve { destino } (documento existente, ou null = criar um novo)
   * ou { erro } se o documento existe mas está travado (em aprovação, aprovado, fechado).
   */
  function planejarInclusao(cabs, o) {
    const docs = (cabs || []).filter((c) => String(c.ano) === String(o.ano) && String(c.tipo).toUpperCase() === String(o.tipo).toUpperCase() &&
      String(c.descricao || "") === String(o.descricao) && c.status !== "Substituído" &&
      String(c.departamento ? c.departamento.id : "") === String(o.departamentoId));
    if (!docs.length) return { destino: null };
    const travado = docs.find((c) => !editavel(c.status));
    if (travado) return { erro: `O documento "${o.descricao}" de ${o.ano} deste departamento está "${travado.status}". Peça a reabertura antes de incluir empreendimentos.` };
    const guarda = docs.find((c) => !c.produto) || docs[0];
    return { destino: guarda };
  }

  /** Linhas de um empreendimento copiadas de um documento base (orçamento aprovado ou forecast anterior). */
  function copiarEmpreendimento(base, cc, ano) {
    const k = String(cc).replace(/\D/g, "");
    const mesmo = (l) => String(l.cc || "").replace(/\D/g, "") === k;
    return {
      itens: ((base && base.itens) || []).filter(mesmo).map((l) => Object.assign({}, l, { m: (l.m || []).slice(), copiado: true })),
      vendas: ((base && base.vendas) || []).filter(mesmo).map((v) => Object.assign({}, v, { ano: Number(ano) || v.ano }))
    };
  }

  /** Empreendimentos que já estão num documento. */
  function empreendimentosDoDoc(doc) {
    const s = new Set();
    ((doc && doc.itens) || []).concat((doc && doc.vendas) || []).forEach((l) => s.add(String(l.cc || "").replace(/\D/g, "")));
    s.delete("");
    return s;
  }


  /**
   * Leitura executiva do Analítico de gastos (Órion: buildExecInsights em lib/orcamentoDesvioUi.ts).
   * itens: [{ orcado, realizado }] em centavos (o "orcado" é a referência: orçado ou forecast). tipo: DESPESAS | RECEITAS.
   * Material = |desvio %| ≥ 5%; linha com desvio = variação acima de R$ 0,01. Favorável: despesa abaixo / receita acima.
   */
  function leituraExecutiva(itens, tipo, refRotulo) {
    const fav = (v) => (tipo === "DESPESAS" ? v <= 0 : v >= 0);
    const ls = (itens || []).map((x) => { const ref = Number(x.orcado) || 0, real = Number(x.realizado) || 0, v = real - ref; const p = ref !== 0 ? v / Math.abs(ref) : real !== 0 ? 1 : 0; return { ref, real, v, p, abs: Math.abs(v), material: Math.abs(p) >= 0.05, favoravel: fav(v) }; });
    const comDesvio = ls.filter((l) => l.abs > 1);
    const ref = ls.reduce((s, l) => s + l.ref, 0), real = ls.reduce((s, l) => s + l.real, 0), v = real - ref;
    const perc = ref !== 0 ? v / Math.abs(ref) : 0;
    const favoravel = fav(v);
    const material = comDesvio.filter((l) => l.material && !l.favoravel);
    const k = (c) => { const r = Math.abs(c) / 100; return r >= 1e6 ? `R$ ${(r / 1e6).toFixed(1)}M` : r >= 1e3 ? `R$ ${(r / 1e3).toFixed(0)}K` : `R$ ${Math.round(r).toLocaleString("pt-BR")}`; };
    const pc = (x) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
    const rot = refRotulo || "orçado";
    const narrativa = !comDesvio.length ? `Sem desvios relevantes vs ${rot}.`
      : favoravel ? `${k(v)} ${v >= 0 ? "acima" : "abaixo"} da referência (${pc(perc)}). ${comDesvio.length} linha(s) com movimento.`
      : `${k(v)} ${v >= 0 ? "acima" : "abaixo"} da referência (${pc(perc)}). ${material.length} linha(s) com desvio material requer atenção.`;
    return { ref, real, varRs: v, perc, favoravel, materialCount: material.length, comDesvioCount: comDesvio.length, narrativa };
  }

  /** Destaque da linha como no Órion (rowHighlightClass): favorável verde, material desfavorável laranja, demais desfavoráveis vermelho claro. */
  function destaqueLinha(ref, real, tipo) {
    const v = real - ref, p = ref !== 0 ? v / Math.abs(ref) : real !== 0 ? 1 : 0;
    if (p === 0) return "";
    if (tipo === "DESPESAS" ? v <= 0 : v >= 0) return "favoravel";
    return Math.abs(p) >= 0.05 ? "material" : "desfavoravel";
  }


  /* ---------- importação por Excel (Órion: services/excel_validator.py, tudo ou nada) ---------- */
  const COLUNAS_EXCEL_MENSAL = ["produto", "plano_financeiro"].concat(MESES.map((m) => m.toLowerCase())).concat(["observacao"]);

  /** Normaliza o cabeçalho como o Órion (minúsculas, sem espaços e acentos): "Plano Financeiro" → "plano_financeiro". */
  function colunaExcel(h) {
    return String(h == null ? "" : h).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  }

  /**
   * Valida as linhas de uma planilha de despesas/receitas (matriz: 1ª linha = cabeçalho).
   * Produto e plano aceitam "código - nome", só o código ou só o nome. Regras do Órion:
   * V01 obrigatório, V02 produto inexistente, V03 plano inexistente, V04 plano não autorizado no departamento,
   * V06 valor mensal inválido, V07 produto+plano duplicado. Qualquer erro: nada é aplicado.
   * o: { ccs: [{id, nome}], planos: [{id, nome}], permitido(cc, plano) → bool (opcional) }
   */
  function validarPlanilhaMensal(matriz, o) {
    const linhasM = (matriz || []).filter((r) => (r || []).some((v) => v != null && String(v).trim() !== ""));
    if (!linhasM.length) return { erros: [{ linha: 1, campo: "", codigo: "V00", mensagem: "A planilha está vazia." }], linhas: [] };
    const cab = linhasM[0].map(colunaExcel);
    const idx = {};
    cab.forEach((c, i) => { if (c && idx[c] == null) idx[c] = i; });
    const faltam = ["produto", "plano_financeiro"].filter((c) => idx[c] == null);
    if (faltam.length) return { erros: [{ linha: 1, campo: faltam.join(", "), codigo: "V00", mensagem: `Cabeçalho sem a(s) coluna(s) ${faltam.join(", ")}. Use o modelo (produto, plano_financeiro, jan…dez, observacao).` }], linhas: [] };
    const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    const achar = (lista, raw) => {
      const t = String(raw).trim(), cod = /^\s*([\d.]+)\s*(-|$)/.exec(t);
      const porId = new Map((lista || []).map((x) => [dig(x.id), x]));
      if (cod && porId.has(dig(cod[1]))) return porId.get(dig(cod[1]));
      const nome = (cod ? t.slice(cod[0].length) : t).trim().toLowerCase();
      return (lista || []).find((x) => String(x.nome || "").trim().toLowerCase() === nome || (String(x.id) + " - " + String(x.nome || "")).toLowerCase() === t.toLowerCase()) || null;
    };
    const num = (v) => {
      if (v == null || String(v).trim() === "") return 0;
      if (typeof v === "number") return isNaN(v) ? null : v;
      let s = String(v).trim().replace(/\s/g, "").replace(/^R\$/, "");
      if (/,/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return isNaN(n) ? null : n;
    };
    const erros = [], linhas = [], vistas = new Set();
    const E = (linha, campo, codigo, mensagem) => erros.push({ linha, campo, codigo, mensagem });
    linhasM.slice(1).forEach((r, k) => {
      const n = k + 2;
      const pr = String(r[idx.produto] == null ? "" : r[idx.produto]).trim(), pl = String(r[idx.plano_financeiro] == null ? "" : r[idx.plano_financeiro]).trim();
      let ok = true;
      if (!pr) { E(n, "produto", "V01", "Campo obrigatório 'produto' está vazio."); ok = false; }
      if (!pl) { E(n, "plano_financeiro", "V01", "Campo obrigatório 'plano_financeiro' está vazio."); ok = false; }
      const cc = pr ? achar(o.ccs, pr) : null, pla = pl ? achar(o.planos, pl) : null;
      if (pr && !cc) { E(n, "produto", "V02", `Produto '${pr}' não encontrado no sistema.`); ok = false; }
      if (pl && !pla) { E(n, "plano_financeiro", "V03", `Plano Financeiro '${pl}' não encontrado no sistema.`); ok = false; }
      if (cc && pla && o.permitido && !o.permitido(dig(cc.id), dig(pla.id))) { E(n, "plano_financeiro", "V04", `Plano '${pl}' não está autorizado para o departamento/produto.`); ok = false; }
      const m = new Array(12).fill(0);
      MESES.forEach((mm, i) => {
        const c = idx[mm.toLowerCase()];
        const v = c == null ? 0 : num(r[c]);
        if (v == null) { E(n, mm.toLowerCase(), "V06", `Valor inválido na coluna '${mm.toLowerCase()}': '${r[c]}'.`); ok = false; } else m[i] = Math.round(v * 100);
      });
      if (cc && pla) {
        const ch = dig(cc.id) + "|" + dig(pla.id);
        if (vistas.has(ch)) { E(n, "produto/plano_financeiro", "V07", `Combinação Produto='${pr}' + Plano='${pl}' duplicada na planilha.`); ok = false; } else vistas.add(ch);
      }
      if (ok) linhas.push({ cc: dig(cc.id), cc_nome: cc.nome || "", plano: dig(pla.id), plano_nome: pla.nome || "", m, total: somaMeses(m), obs: idx.observacao == null || r[idx.observacao] == null ? "" : String(r[idx.observacao]).trim() });
    });
    return { erros, linhas: erros.length ? [] : linhas };
  }

  /** Matriz para exportar (ou o modelo vazio): cabeçalho do modelo + uma linha por item, em reais. */
  function planilhaMensal(linhas) {
    return [COLUNAS_EXCEL_MENSAL].concat((linhas || []).map((l) => [`${l.cc} - ${l.cc_nome || ""}`, `${l.plano} - ${l.plano_nome || ""}`].concat((l.m || []).map((v) => (Number(v) || 0) / 100)).concat([l.obs || ""])));
  }


  /* ---------- vendas: IPCA em cascata e Excel (Órion: IpcaCascataModal, excel_validator.validar_vendas) ---------- */
  /** Taxa digitada → taxa mensal decimal (% a.a. → (1+i)^(1/12) − 1; % a.m. direto). */
  function taxaMensalIpca(valor, unidade) {
    const i = Number(String(valor).replace(",", ".")) / 100;
    if (isNaN(i) || i <= -1) return null;
    return unidade === "% a.m." ? i : Math.pow(1 + i, 1 / 12) - 1;
  }
  /** Ticket dos meses seguintes = ticket do mês de origem corrigido mês a mês pela taxa (centavos inteiros). Meses travados ficam como estão. */
  function aplicarIpcaTicket(meses, mesOrigem, taxaMensal, travados) {
    const trav = new Set((travados || []).map(Number));
    let t = Number(meses[mesOrigem].ticket) || 0;
    return meses.map((m, i) => {
      if (i <= mesOrigem) return Object.assign({}, m);
      t = t * (1 + taxaMensal);
      return trav.has(i + 1) ? Object.assign({}, m) : Object.assign({}, m, { ticket: Math.round(t) });
    });
  }

  const COLUNAS_EXCEL_VENDAS = ["produto", "plano_venda", "mes", "numero_vendas", "ticket_medio", "vgv"];
  /** Grade de vendas → planilha do modelo do Órion (uma linha por empreendimento × plano × mês com valor). */
  function planilhaVendas(grade) {
    const out = [COLUNAS_EXCEL_VENDAS];
    (grade || []).forEach((l) => (l.meses || []).forEach((m, i) => {
      const n = Number(m.vendas) || 0, t = Number(m.ticket) || 0;
      if (!n && !t) return;
      out.push([`${l.cc} - ${l.cc_nome || ""}`, l.plano_venda || "", i + 1, n, t / 100, (t * n) / 100]);
    }));
    return out;
  }
  /**
   * Valida a planilha de vendas (regras do Órion): V01 obrigatórios (produto, plano_venda, mês), V02 produto, V03 plano de venda,
   * V05 mês 1–12, V06 números (distrato: plano com "distrato" no nome vira negativo), V07 produto+plano+mês duplicado. Tudo ou nada.
   * Sem ticket e com VGV, o ticket = VGV ÷ unidades (o Integra calcula o VGV como ticket × unidades).
   */
  function validarPlanilhaVendas(matriz, o) {
    const linhasM = (matriz || []).filter((r) => (r || []).some((v) => v != null && String(v).trim() !== ""));
    if (!linhasM.length) return { erros: [{ linha: 1, campo: "", codigo: "V00", mensagem: "A planilha está vazia." }], grade: [] };
    const cab = linhasM[0].map(colunaExcel), idx = {};
    cab.forEach((c, i) => { if (c && idx[c] == null) idx[c] = i; });
    const alias = { n_vendas: "numero_vendas", no_vendas: "numero_vendas", "nº_vendas": "numero_vendas", plano_de_venda: "plano_venda", ticket_medio_r$: "ticket_medio", "vgv_(r$)": "vgv", "ticket_medio_(r$)": "ticket_medio" };
    Object.keys(alias).forEach((k) => { if (idx[k] != null && idx[alias[k]] == null) idx[alias[k]] = idx[k]; });
    const faltam = ["produto", "plano_venda", "mes"].filter((c) => idx[c] == null);
    if (faltam.length) return { erros: [{ linha: 1, campo: faltam.join(", "), codigo: "V00", mensagem: `Cabeçalho sem a(s) coluna(s) ${faltam.join(", ")}. Use o modelo (produto, plano_venda, mes, numero_vendas, ticket_medio, vgv).` }], grade: [] };
    const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
    const porId = new Map((o.ccs || []).map((x) => [dig(x.id), x]));
    const acharCc = (raw) => { const t = String(raw).trim(), c = /^\s*(\d+)\s*(-|$)/.exec(t); if (c && porId.has(c[1])) return porId.get(c[1]); const n = (c ? t.slice(c[0].length) : t).trim().toLowerCase(); return (o.ccs || []).find((x) => String(x.nome || "").trim().toLowerCase() === n) || null; };
    const planos = (o.planosVenda || []).map(String);
    const acharPl = (raw) => planos.find((p) => p.trim().toLowerCase() === String(raw).trim().toLowerCase()) || null;
    const num = (v) => { if (v == null || String(v).trim() === "") return 0; if (typeof v === "number") return isNaN(v) ? null : v; let s2 = String(v).trim().replace(/\s/g, "").replace(/^R\$/, ""); if (/,/.test(s2)) s2 = s2.replace(/\./g, "").replace(",", "."); const n = Number(s2); return isNaN(n) ? null : n; };
    const erros = [], vistas = new Set(), grade = new Map();
    const E = (linha, campo, codigo, mensagem) => erros.push({ linha, campo, codigo, mensagem });
    linhasM.slice(1).forEach((r, k) => {
      const n = k + 2;
      const val = (c) => (idx[c] == null ? null : r[idx[c]]);
      const pr = String(val("produto") == null ? "" : val("produto")).trim(), pl = String(val("plano_venda") == null ? "" : val("plano_venda")).trim(), mr = val("mes");
      let ok = true;
      [["produto", pr], ["plano_venda", pl], ["mes", mr == null ? "" : String(mr).trim()]].forEach(([c, v]) => { if (!v) { E(n, c, "V01", `Campo obrigatório '${c}' está vazio.`); ok = false; } });
      const cc = pr ? acharCc(pr) : null, plano = pl ? acharPl(pl) : null;
      if (pr && !cc) { E(n, "produto", "V02", `Produto '${pr}' não encontrado.`); ok = false; }
      if (pl && !plano) { E(n, "plano_venda", "V03", `Plano de Venda '${pl}' não encontrado.`); ok = false; }
      const mes = Number(mr);
      if (!(Number.isInteger(mes) && mes >= 1 && mes <= 12)) { E(n, "mes", "V05", `Mês '${mr == null ? "" : mr}' inválido (esperado 1–12).`); ok = false; }
      const distrato = !!(plano && /distrato/i.test(plano));
      let nv = num(val("numero_vendas")); const tk = num(val("ticket_medio")); let vg = num(val("vgv"));
      if (nv == null || !Number.isInteger(nv) || (nv < 0 && !distrato)) { E(n, "numero_vendas", "V06", `Número de vendas inválido: '${val("numero_vendas")}'.`); ok = false; } else if (distrato && nv > 0) nv = -nv;
      if (tk == null || tk < 0) { E(n, "ticket_medio", "V06", `Ticket médio inválido: '${val("ticket_medio")}'.`); ok = false; }
      if (vg == null || (vg < 0 && !distrato)) { E(n, "vgv", "V06", `VGV inválido: '${val("vgv")}'.`); ok = false; } else if (distrato && vg > 0) vg = -vg;
      if (cc && plano && ok) {
        const ch = dig(cc.id) + "|" + plano + "|" + mes;
        if (vistas.has(ch)) { E(n, "produto/plano_venda/mes", "V07", `Combinação Produto+Plano+Mês duplicada na linha ${n}.`); ok = false; } else vistas.add(ch);
      }
      if (!ok) return;
      const kg = dig(cc.id) + "|" + plano;
      if (!grade.has(kg)) grade.set(kg, { cc: dig(cc.id), cc_nome: cc.nome || "", plano_venda: plano, distrato, obs: distrato ? "Distrato" : "", origem: "excel", meses: Array.from({ length: 12 }, () => ({ vendas: 0, ticket: 0 })) });
      const t = tk ? Math.round(tk * 100) : nv ? Math.round(Math.abs(vg / nv) * 100) : 0;
      grade.get(kg).meses[mes - 1] = { vendas: nv, ticket: t };
    });
    return { erros, grade: erros.length ? [] : [...grade.values()] };
  }

  return { rotuloVersao, taxaMensalIpca, aplicarIpcaTicket, planilhaVendas, validarPlanilhaVendas, COLUNAS_EXCEL_VENDAS, validarPlanilhaMensal, planilhaMensal, colunaExcel, COLUNAS_EXCEL_MENSAL, leituraExecutiva, destaqueLinha, insightsBloco, dfcGerencialMensal, analiseOrcamentoAnual, analiseOrcamento, grupoRecebimento, centavosDigitado, RECORTES, filtrarRecorte, DESCRICAO_ORCAMENTO, corteForecast, descricaoForecast, planejarInclusao, copiarEmpreendimento, empreendimentosDoDoc, versoesForecast, documentosVigentes, analiticoGastos, resumoGeral, SEMAFORO_IMATERIAL, semaforo, dfcGerencial, orcadoPorGrupo, vendasParaGrade, gradeParaVendas, validarVendas, agregarRealizado, orcadoRealizado, STATUS_BLOQUEADO, ACOES_GESTOR, resolverTransicao, acoesDoStatus, editavel, mesesFechados, mesFechadoAlterado, validarLinhas, emBlocos,
    prepararDepartamentos, lancamentoPermitido, MESES, ITENS_POR_DOC, centavos, reais, fmtReais, somaMeses, somarLinhas, mapas, prepararDocumentos, juntarBlocos, agrupar, diferencaVersoes };
});
