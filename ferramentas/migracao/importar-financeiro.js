// Fase 4 (área financeiro / tesouraria / pagadoria / fiscal / contábil / marketing): leva o export do Firestore para
// as tabelas no Supabase. Usa os mesmos mapas e conversões do front (js/financeiro/mapas-financeiro.js +
// js/nucleo/dados-base.js), então o que entra é o que a tela lê. Regras de cada coleção:
// docs/mapa-tabelas/financeiro-fiscal-marketing.md (seção "Notas para o importador").
//
// Uso:
//   node ferramentas/migracao/importar-financeiro.js --export <pasta> --seco      só monta e confere, não grava
//   node ferramentas/migracao/importar-financeiro.js --export <pasta>            grava (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
//   ... --so cfin_pagos,cfin_pagos_bills                                          só algumas tabelas
//   ... --com-titulos-marketing                                                   importa também o cache de 30 min dos
//                                                                                 títulos do marketing (por padrão fica
//                                                                                 de fora: expira antes de ser lido)
// Pode rodar de novo: cabeçalhos são upsert pela chave; as linhas filhas (itens, bills, despesas...) dos cabeçalhos
// importados são apagadas e inseridas de novo (as tabelas de itens usam identity, sem chave natural).
// caixa_posicao: os dias importados são apagados e inseridos de novo. Não apaga nada fora disso.
//
// Regras gerais (do mapa de tabelas):
// - partes (_pN, __pN, partes[], <cc>_<i>) são juntadas antes; doc de parte nunca vira linha;
// - caixa_posicao/_meta e o cabeçalho <cc> de marketing_budget_vendas não são importados;
// - criado_em / atualizado_em vêm dos campos de auditoria do doc (insert não dispara o gatilho); sem valor, horário
//   da carga;
// - Timestamps do export ({__tipo:"timestamp", iso}) viram epoch ms (os tipos "iso"/"ms" do mapa aceitam os dois).
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const B = require("../../js/nucleo/dados-base.js");
const M = require("../../js/financeiro/mapas-financeiro.js");

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function normal(v) {
  if (Array.isArray(v)) return v.map(normal);
  if (v && typeof v === "object") {
    if (v.__tipo === "timestamp" && v.iso) return Date.parse(v.iso);
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = normal(v[k]); });
    return o;
  }
  return v;
}

// Coleções desta área chegam a dezenas de MB (cfin_pagos, antecipacoes_mes, marketing_budget_titulos): linha a linha.
async function lerColecao(pasta, nome) {
  const f = path.join(pasta, nome + ".ndjson");
  if (!fs.existsSync(f)) return [];
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(f, "utf8"), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.trim()) continue;
    const d = JSON.parse(l);
    out.push({ id: String(d.id), data: normal(d.data || {}) });
  }
  return out;
}

// criado_em / atualizado_em: o importador informa os dois; sem valor na origem, os dois = horário da carga.
function carimbos(linha, criado, atualizado, agora) {
  const c = B.paraBanco(criado, "iso") || linha.criado_em || null;
  const a = B.paraBanco(atualizado, "iso") || linha.atualizado_em || null;
  linha.criado_em = c || a || agora;
  linha.atualizado_em = a || linha.criado_em;
  if (linha.atualizado_em < linha.criado_em) linha.atualizado_em = linha.criado_em;
  return linha;
}
const maior = (...vs) => vs.map((v) => B.paraMs(v) || 0).reduce((a, b) => Math.max(a, b), 0) || null;

// Junta "<pai><sep>N" com o pai (cfin_pagos/caixa_movimentos: "_pN" a partir de 2; antecipacoes_mes: "__pN" a partir de 0).
function separarPartes(docs, re) {
  const pais = [];
  const partes = {};
  docs.forEach((d) => {
    const m = d.id.match(re);
    if (m) (partes[m[1]] = partes[m[1]] || []).push({ n: Number(m[2]), data: d.data, id: d.id });
    else pais.push(d);
  });
  Object.keys(partes).forEach((k) => partes[k].sort((a, b) => a.n - b.n));
  return { pais, partes };
}

async function montar(pasta, opcoes) {
  const op = opcoes || {};
  const saida = {};
  const avisos = [];
  const agora = new Date().toISOString();
  const add = (tabela, linhas) => {
    const t = (saida[tabela] = saida[tabela] || { linhas: [] });
    linhas.forEach((l) => { if (l) t.linhas.push(l); });
  };
  const ler = (nome) => lerColecao(pasta, nome);

  // ---- caixa_diario_config/saldo_inicial -> _contas + _cc_excluidos
  (await ler("caixa_diario_config")).forEach((d) => {
    if (d.id !== "saldo_inicial") { avisos.push("caixa_diario_config: doc " + d.id + " ignorado (só saldo_inicial)"); return; }
    const r = M.desmontarConfigCaixa(d.data);
    if (r.ignoradas.length) avisos.push("caixa_diario_config: chaves sem '|' ignoradas: " + r.ignoradas.join(", "));
    if (Object.keys(r.resto).length) avisos.push("caixa_diario_config: campos sem destino ignorados: " + Object.keys(r.resto).join(", "));
    add("caixa_diario_config_contas", r.contas.map((l) => carimbos(l, d.data.updatedAt, d.data.updatedAt, agora)));
    add("caixa_diario_config_cc_excluidos", r.ccExcluidos.map((l) => carimbos(l, d.data.updatedAt, d.data.updatedAt, agora)));
  });

  // ---- caixa_movimentos (+ _pN) -> cabeçalho + itens
  {
    const { pais, partes } = separarPartes(await ler("caixa_movimentos"), /^(.+_\d{4}-\d{2})_p(\d+)$/);
    pais.forEach((d) => {
      const x = d.data;
      const l = B.paraLinha(M.caixa_movimentos, M.sem(x, ["movimentos"].concat(M.PEDACOS)), d.id);
      if (!l.company_id) l.company_id = d.id.split("_")[0];
      add("caixa_movimentos", [carimbos(l, x.em, x.em, agora)]);
      if (/_base$/.test(d.id)) return;
      const lista = (Array.isArray(x.movimentos) ? x.movimentos : []).concat(...(partes[d.id] || []).map((p) => p.data.movimentos || []));
      const esperado = Number(x.partes) || 1;
      if ((partes[d.id] || []).length + 1 !== esperado) avisos.push("caixa_movimentos/" + d.id + ": doc diz " + esperado + " partes, export tem " + ((partes[d.id] || []).length + 1));
      if (x.n != null && Number(x.n) !== lista.length) avisos.push("caixa_movimentos/" + d.id + ": n " + x.n + " ≠ " + lista.length + " movimentos");
      add("caixa_movimentos_itens", lista.map((m, i) => carimbos(M.linhaMovimentoCaixa(m, d.id, l.company_id, l.ym, i + 1), x.em, x.em, agora)));
    });
    Object.keys(partes).forEach((k) => { if (!pais.some((d) => d.id === k)) avisos.push("caixa_movimentos: partes de " + k + " sem o doc pai (ignoradas)"); });
  }

  // ---- caixa_posicao: rows[] dos chunks "<dia>_<n>" -> uma linha por unidade por dia (_meta fica de fora)
  {
    const dias = new Set();
    (await ler("caixa_posicao")).forEach((d) => {
      if (d.id === "_meta") return;
      const x = d.data;
      const rows = Array.isArray(x.rows) ? x.rows : [];
      add("caixa_posicao", rows.map((r) => {
        const l = B.paraLinha(M.caixa_posicao, Object.assign({ d: x.date }, r));
        delete l.id;
        if (!l.d) l.d = B.paraBanco(x.date, "data");
        if (l.d) dias.add(l.d);
        return carimbos(l, x.updatedAt, x.updatedAt, agora);
      }));
    });
    saida.caixa_posicao = saida.caixa_posicao || { linhas: [] };
    saida.caixa_posicao.dias = Array.from(dias);
  }

  // ---- caixa_valor_receber: emp_<id> (itens texto JSON) e _estado (só servidor)
  (await ler("caixa_valor_receber")).forEach((d) => {
    const x = d.data;
    if (d.id === "_estado") {
      const l = B.paraLinha(M.caixa_valor_receber_estado, x, "_estado");
      add("caixa_valor_receber_estado", [carimbos(l, null, null, agora)]);
      return;
    }
    if (!/^emp_/.test(d.id)) { avisos.push("caixa_valor_receber: doc " + d.id + " ignorado"); return; }
    if (typeof x.itens === "string" && x.itens.trim() && !M.itensValorReceber(x.itens).length && x.itens.trim() !== "[]") {
      avisos.push("caixa_valor_receber/" + d.id + ": itens não é JSON válido (ficou sem itens)");
    }
    const r = M.desmontarValorReceber(x, d.id);
    add("caixa_valor_receber", [carimbos(r.pai, x.atualizadoEm, x.atualizadoEm, agora)]);
    add("caixa_valor_receber_itens", r.itens.map((l) => carimbos(l, x.atualizadoEm, x.atualizadoEm, agora)));
  });

  // ---- caixa_radar (coleção vazia no inventário)
  add("caixa_radar", (await ler("caixa_radar")).map((d) => carimbos(B.paraLinha(M.caixa_radar, d.data, d.id), d.data.em, d.data.em, agora)));

  // ---- cfin_pagos (+ _pN) -> cabeçalho + bills; _corte é linha especial
  {
    const { pais, partes } = separarPartes(await ler("cfin_pagos"), /^(.+_\d{4}-\d{2})_p(\d+)$/);
    pais.forEach((d) => {
      const x = d.data;
      const l = B.paraLinha(M.cfin_pagos, M.sem(x, ["bills"].concat(M.PEDACOS)), d.id);
      add("cfin_pagos", [carimbos(l, x.em, x.em, agora)]);
      if (d.id === "_corte") return;
      if (!l.company_id || !l.ym) { avisos.push("cfin_pagos/" + d.id + ": sem companyId/ym (bills ignorados)"); return; }
      const lista = (Array.isArray(x.bills) ? x.bills : []).concat(...(partes[d.id] || []).map((p) => p.data.bills || []));
      const esperado = Number(x.partes) || 1;
      if ((partes[d.id] || []).length + 1 !== esperado) avisos.push("cfin_pagos/" + d.id + ": doc diz " + esperado + " partes, export tem " + ((partes[d.id] || []).length + 1));
      if (x.n != null && Number(x.n) !== lista.length) avisos.push("cfin_pagos/" + d.id + ": n " + x.n + " ≠ " + lista.length + " títulos");
      add("cfin_pagos_bills", lista.map((b, i) => carimbos(M.linhaBillCfin(b, d.id, l.company_id, l.ym, i + 1), x.em, x.em, agora)));
    });
    Object.keys(partes).forEach((k) => { if (!pais.some((d) => d.id === k)) avisos.push("cfin_pagos: partes de " + k + " sem o doc pai (ignoradas)"); });
  }

  // ---- antecipacoes_mes: "AAAA-MM" (cabeçalho) + "AAAA-MM__pN".texto concatenado em ordem -> eventos
  {
    const { pais, partes } = separarPartes(await ler("antecipacoes_mes"), /^(\d{4}-\d{2})__p(\d+)$/);
    const vistos = new Map();
    pais.forEach((d) => {
      const x = d.data;
      const l = B.paraLinha(M.antecipacoes_mes, M.sem(x, ["mes"].concat(M.PEDACOS)), d.id);
      M.aplicarPadroes("antecipacoes_mes", l);
      add("antecipacoes_mes", [carimbos(l, x.atualizadoEm, x.atualizadoEm, agora)]);
      const ps = partes[d.id] || [];
      if (x.partes != null && Number(x.partes) !== ps.length) avisos.push("antecipacoes_mes/" + d.id + ": doc diz " + x.partes + " partes, export tem " + ps.length);
      let eventos = [];
      const texto = ps.map((p) => String(p.data.texto || "")).join("");
      try { eventos = JSON.parse(texto || "[]"); } catch (e) { avisos.push("antecipacoes_mes/" + d.id + ": texto das partes não é JSON (" + e.message + ")"); eventos = []; }
      if (!Array.isArray(eventos)) eventos = [];
      if (x.eventos != null && Number(x.eventos) !== eventos.length) avisos.push("antecipacoes_mes/" + d.id + ": eventos " + x.eventos + " ≠ " + eventos.length);
      eventos.forEach((ev) => {
        if (!ev || !ev.k) { avisos.push("antecipacoes_mes/" + d.id + ": evento sem k ignorado"); return; }
        if (String(ev.data || "").slice(0, 7) !== d.id) avisos.push("antecipacoes_mes/" + d.id + ": evento " + ev.k + " com data de outro mês (fica no mês do doc)");
        if (vistos.has(ev.k)) { avisos.push("antecipacoes_mes: k " + ev.k + " repetido (fica o último)"); }
        vistos.set(ev.k, carimbos(M.linhaEventoAntecipacao(ev, d.id), x.atualizadoEm, x.atualizadoEm, agora));
      });
    });
    add("antecipacoes_mes_eventos", Array.from(vistos.values()));
    Object.keys(partes).forEach((k) => { if (!pais.some((d) => d.id === k)) avisos.push("antecipacoes_mes: partes de " + k + " sem o cabeçalho (ignoradas)"); });
  }

  // ---- pagamento_lotes -> cabeçalho (conta/sienge achatados) + itens
  (await ler("pagamento_lotes")).forEach((d) => {
    const x = Object.assign({}, d.data, { id: d.id });
    if (d.data.id !== undefined && String(d.data.id) !== d.id) avisos.push("pagamento_lotes/" + d.id + ": campo id diferente do id do doc (" + d.data.id + "); vale o do doc");
    const r = M.desmontarLote(x);
    const hist = (x.sienge && Array.isArray(x.sienge.historico)) ? x.sienge.historico.map((h) => h && h.em) : [];
    const at = maior(x.criadoEm, x.canceladoEm, x.sienge && x.sienge.geradoEm, ...hist);
    add("pagamento_lotes", [carimbos(r.pai, x.criadoEm, at, agora)]);
    add("pagamento_lotes_itens", r.itens.map((l) => carimbos(l, x.criadoEm, x.criadoEm, agora)));
  });

  // ---- cadastros simples (um doc = uma linha)
  const simples = [
    ["cc_conta_parceria", (x) => [x.updatedAt, x.updatedAt]],
    ["sienge_creditors", () => [null, null]],
    ["participacoes_credores", (x) => [x.em, x.em]],
    ["rydoo_arquivos", (x) => [x.importedAt, x.importedAt]],
    ["rydoo_meta", (x) => [x.updatedAt, x.updatedAt]],
    ["fiscal_notas_envio", (x) => [x.criadoEm, x.atualizadoEm]],
    ["fiscal_notas_aprendizado", (x) => [x.em, x.em]],
    ["marketing_budgets", (x) => [x.createdAt, x.updatedAt]],
    ["marketing_budget_config", (x) => [x.updatedAt, x.updatedAt]],
    ["mutuo_meta", (x) => [x.atualizadoEm, x.atualizadoEm]],
    ["titulos_incompletos_batimento", (x) => [x.at, x.at]],
  ];
  for (const [t, datas] of simples) {
    add(t, (await ler(t)).map((d) => {
      const x = Object.assign({}, d.data);
      if (x.id !== undefined && String(x.id) !== d.id) avisos.push(t + "/" + d.id + ": campo id diferente do id do doc (" + x.id + "); vale o do doc");
      delete x.id;
      const l = B.paraLinha(M[t], x, d.id);
      const [c, a] = datas(x);
      return carimbos(l, c, a, agora);
    }));
  }

  // ---- rydoo_titulos: competencia sai do id
  add("rydoo_titulos", (await ler("rydoo_titulos")).map((d) => {
    const l = B.paraLinha(M.rydoo_titulos, d.data, d.id);
    l.competencia = M.competenciaRydoo(d.id);
    return carimbos(l, d.data.createdAt, maior(d.data.createdAt, d.data.bankSentAt), agora);
  }));

  // ---- participacoes_periods -> cabeçalho + despesas (date DD/MM/AAAA = iso; divergente fica em extra.date)
  (await ler("participacoes_periods")).forEach((d) => {
    const x = d.data;
    const r = M.desmontarPeriodo(x, d.id);
    const divergentes = r.despesas.filter((l) => l.extra && l.extra.date !== undefined).length;
    if (divergentes) avisos.push("participacoes_periods/" + d.id + ": " + divergentes + " despesas com date ≠ iso (date original em extra.date)");
    const at = r.pai.atualizado_em || x.updatedAt;
    add("participacoes_periods", [carimbos(r.pai, at, at, agora)]);
    add("participacoes_periods_expenses", r.despesas.map((l) => carimbos(l, at, at, agora)));
  });

  // Texto de um doc grande: payload ou as partes (ids em partes[], docs "tipo: parte" na mesma coleção).
  const textoDoc = (colecao, d, porId) => {
    const x = d.data;
    if (Array.isArray(x.partes) && x.partes.length) {
      const blocos = x.partes.map((pid) => porId.get(String(pid)));
      if (blocos.some((b) => !b)) { avisos.push(colecao + "/" + d.id + ": falta parte no export (" + x.partes.join(", ") + ")"); return null; }
      return blocos.map((b) => String(b.data.texto || "")).join("");
    }
    return typeof x.payload === "string" ? x.payload : "";
  };
  const ehParte = (d) => d.data.tipo === "parte" || /__p\d+$/.test(d.id);

  // ---- dfc_orcamento -> cabeçalho + linhas
  {
    const docs = await ler("dfc_orcamento");
    const porId = new Map(docs.map((d) => [d.id, d]));
    docs.filter((d) => !ehParte(d)).forEach((d) => {
      const x = d.data;
      const l = B.paraLinha(M.dfc_orcamento, M.sem(x, M.PEDACOS.concat(["tipo"])), d.id);
      add("dfc_orcamento", [carimbos(l, x.savedAt, x.savedAt, agora)]);
      const texto = textoDoc("dfc_orcamento", d, porId);
      if (texto === null) return;
      let linhas = [];
      try { linhas = JSON.parse(texto || "[]"); } catch (e) { avisos.push("dfc_orcamento/" + d.id + ": payload não é JSON (" + e.message + ")"); }
      if (!Array.isArray(linhas)) linhas = [];
      if (x.n != null && Number(x.n) !== linhas.length) avisos.push("dfc_orcamento/" + d.id + ": n " + x.n + " ≠ " + linhas.length + " linhas");
      add("dfc_orcamento_linhas", linhas.map((r, i) => carimbos(M.linhaOrcamentoDfc(r, d.id, i + 1), x.savedAt, x.savedAt, agora)));
    });
  }

  // ---- dfc_realizado -> cabeçalho + itens (linhas compactas)
  {
    const docs = await ler("dfc_realizado");
    const porId = new Map(docs.map((d) => [d.id, d]));
    docs.filter((d) => !ehParte(d)).forEach((d) => {
      const x = d.data;
      const l = B.paraLinha(M.dfc_realizado, M.sem(x, M.PEDACOS.concat(["tipo"])), d.id);
      if (!l.empresa) l.empresa = d.id.replace(/^c/, "");
      add("dfc_realizado", [carimbos(l, x.em, x.em, agora)]);
      const texto = textoDoc("dfc_realizado", d, porId);
      if (texto === null) return;
      let itens = [];
      try { itens = JSON.parse(texto || "[]"); } catch (e) { avisos.push("dfc_realizado/" + d.id + ": payload não é JSON (" + e.message + ")"); }
      if (!Array.isArray(itens)) itens = [];
      if (x.n != null && Number(x.n) !== itens.length) avisos.push("dfc_realizado/" + d.id + ": n " + x.n + " ≠ " + itens.length + " itens");
      add("dfc_realizado_itens", itens.map((r, i) => carimbos(M.linhaRealizadoDfc(r, d.id, i + 1), x.em, x.em, agora)));
    });
  }

  // ---- resultado_caixa: payload/partes -> colunas jsonb (planosJson texto -> jsonb)
  {
    const docs = await ler("resultado_caixa");
    const porId = new Map(docs.map((d) => [d.id, d]));
    docs.filter((d) => !ehParte(d)).forEach((d) => {
      const x = d.data;
      const texto = textoDoc("resultado_caixa", d, porId);
      if (texto === null) return;
      let obj;
      try { obj = M.abrirResultado(x, texto); } catch (e) { avisos.push("resultado_caixa/" + d.id + ": payload não é JSON (" + e.message + "); doc ignorado"); return; }
      const l = B.paraLinha(M.resultado_caixa, obj, d.id);
      if (l.extra && l.extra.planosJson !== undefined) avisos.push("resultado_caixa/" + d.id + ": planosJson não é JSON (mantido em extra)");
      add("resultado_caixa", [carimbos(l, x.em, x.em, agora)]);
    });
  }

  // ---- marketing_budget_titulos: cache de 30 min (por padrão não entra)
  {
    const docs = await ler("marketing_budget_titulos");
    const pais = docs.filter((d) => !/_\d+$/.test(d.id));
    if (!op.comTitulosMarketing) {
      if (pais.length) avisos.push("marketing_budget_titulos: " + pais.length + " caches não importados (expiram em 30 min; use --com-titulos-marketing)");
    } else {
      const porId = new Map(docs.map((d) => [d.id, d]));
      pais.forEach((d) => {
        const x = d.data;
        const n = Number(x.partes) || 0;
        const pedacos = [];
        for (let i = 0; i < n; i++) pedacos.push(porId.get(d.id + "_" + i));
        if (pedacos.some((p) => !p || Number(p.data.savedAt) !== Number(x.savedAt))) { avisos.push("marketing_budget_titulos/" + d.id + ": partes faltando ou de outra gravação (ignorado)"); return; }
        let bills = [];
        try { bills = JSON.parse(pedacos.map((p) => String(p.data.texto || "")).join("") || "[]"); } catch (e) { avisos.push("marketing_budget_titulos/" + d.id + ": texto não é JSON"); return; }
        const l = B.paraLinha(M.marketing_budget_titulos, { start: x.start, end: x.end, savedAt: x.savedAt, bills }, d.id);
        add("marketing_budget_titulos", [carimbos(M.aplicarPadroes("marketing_budget_titulos", l), x.savedAt, x.savedAt, agora)]);
      });
    }
  }

  // ---- marketing_budget_vendas: "<cc>_<AAAA-MM>" (o cabeçalho "<cc>" com meses[] não entra)
  (await ler("marketing_budget_vendas")).forEach((d) => {
    const p = M.idVendasMarketing(d.id);
    if (!p) { if (!Array.isArray(d.data.meses)) avisos.push("marketing_budget_vendas: doc " + d.id + " ignorado"); return; }
    add("marketing_budget_vendas", [carimbos(M.linhaVendasMarketing(d.data, p.ccId, p.ym), d.data.savedAt, d.data.savedAt, agora)]);
  });

  // ---- mutuo_execucoes -> cabeçalho + centros (coleção vazia no inventário)
  (await ler("mutuo_execucoes")).forEach((d) => {
    const x = d.data;
    const l = B.paraLinha(M.mutuo_execucoes, M.sem(x, ["centros"]), d.id);
    add("mutuo_execucoes", [carimbos(l, x.atualizadoEm, x.atualizadoEm, agora)]);
    const centros = x.centros && typeof x.centros === "object" ? x.centros : {};
    add("mutuo_execucoes_centros", Object.keys(centros).map((k) =>
      carimbos(M.linhaCentroMutuo(centros[k], d.id, k), centros[k] && centros[k].emitidoEm, x.atualizadoEm, agora)));
  });

  // ---- padrões e obrigatórias
  Object.keys(saida).forEach((t) => {
    let fora = 0;
    saida[t].linhas = saida[t].linhas.filter((l) => {
      M.aplicarPadroes(t, l);
      if (M.faltando(t, l).length) { fora++; return false; }
      return true;
    });
    if (fora) avisos.push(t + ": " + fora + " linhas sem " + (M.OBRIGATORIAS[t] || []).join("/") + " não importadas");
  });

  return { saida, avisos };
}

// Ordem de gravação (pai antes do filho) e como cada tabela é gravada:
//   conflito: upsert pela chave; pai: apaga os filhos dos pais importados e insere (identity, sem chave natural).
const GRAVACAO = {
  caixa_diario_config_contas: { conflito: "id" },
  caixa_diario_config_cc_excluidos: { conflito: "id" },
  caixa_movimentos: { conflito: "id" },
  caixa_movimentos_itens: { pai: "caixa_movimentos_id", lote: 200 },
  caixa_posicao: { dia: "d", lote: 1000 },
  caixa_valor_receber: { conflito: "id" },
  caixa_valor_receber_itens: { pai: "caixa_valor_receber_id" },
  caixa_valor_receber_estado: { conflito: "id" },
  caixa_radar: { conflito: "id", lote: 20 },
  cfin_pagos: { conflito: "id" },
  cfin_pagos_bills: { pai: "cfin_pagos_id", lote: 200 },
  antecipacoes_mes: { conflito: "id" },
  antecipacoes_mes_eventos: { conflito: "id" },
  pagamento_lotes: { conflito: "id" },
  pagamento_lotes_itens: { pai: "pagamento_lotes_id" },
  cc_conta_parceria: { conflito: "id" },
  sienge_creditors: { conflito: "id" },
  participacoes_credores: { conflito: "id" },
  participacoes_periods: { conflito: "id" },
  participacoes_periods_expenses: { pai: "participacoes_periods_id" },
  dfc_orcamento: { conflito: "id" },
  dfc_orcamento_linhas: { pai: "dfc_orcamento_id" },
  dfc_realizado: { conflito: "id" },
  dfc_realizado_itens: { pai: "dfc_realizado_id", lote: 1000 },
  resultado_caixa: { conflito: "id", lote: 2 },
  rydoo_arquivos: { conflito: "id" },
  rydoo_meta: { conflito: "id", lote: 1 },
  rydoo_titulos: { conflito: "id" },
  fiscal_notas_envio: { conflito: "id" },
  fiscal_notas_aprendizado: { conflito: "id" },
  marketing_budgets: { conflito: "id" },
  marketing_budget_config: { conflito: "id" },
  marketing_budget_titulos: { conflito: "id", lote: 1 },
  marketing_budget_vendas: { conflito: "id", lote: 20 },
  mutuo_execucoes: { conflito: "id" },
  mutuo_execucoes_centros: { conflito: "mutuo_execucoes_id,chave" },
  mutuo_meta: { conflito: "id" },
  titulos_incompletos_batimento: { conflito: "id", lote: 1 },
};
const ORDEM = Object.keys(GRAVACAO);

async function gravar(sb, t, item) {
  const g = GRAVACAO[t];
  const linhas = item.linhas;
  const tam = g.lote || 500;
  const apagar = async (col, valores) => {
    for (let i = 0; i < valores.length; i += 200) {
      const r = await sb.from(t).delete().in(col, valores.slice(i, i + 200));
      if (r.error) throw new Error(t + " (apagar " + col + "): " + r.error.message);
    }
  };
  if (g.pai) await apagar(g.pai, Array.from(new Set(linhas.map((l) => l[g.pai]))));
  if (g.dia) await apagar(g.dia, item.dias || Array.from(new Set(linhas.map((l) => l[g.dia]))));
  for (let i = 0; i < linhas.length; i += tam) {
    const lote = linhas.slice(i, i + tam);
    const r = g.conflito
      ? await sb.from(t).upsert(lote, { onConflict: g.conflito, defaultToNull: false })
      : await sb.from(t).insert(lote, { defaultToNull: false });
    if (r.error) throw new Error(t + " (lote " + i + "): " + r.error.message);
  }
}

async function principal() {
  const pasta = arg("export");
  if (!pasta || pasta === true) { console.error("Informe --export <pasta do export>."); process.exit(1); }
  const seco = !!arg("seco");
  const so = arg("so") && arg("so") !== true ? new Set(String(arg("so")).split(",")) : null;
  const { saida, avisos } = await montar(path.resolve(pasta), { comTitulosMarketing: !!arg("com-titulos-marketing") });
  const sb = seco ? null : require("../../lib/supabase-admin").supabaseAdmin();

  for (const t of ORDEM) {
    const item = saida[t];
    if (!item || (so && !so.has(t))) continue;
    if (seco) {
      // Tamanho aproximado: lote grande demais para a API vira erro na gravação real.
      const kb = Math.round(Buffer.byteLength(JSON.stringify(item.linhas)) / 1024);
      console.log("[seco] " + t + ": " + item.linhas.length + " linhas (~" + kb + " KB)");
      continue;
    }
    await gravar(sb, t, item);
    console.log(t + ": " + item.linhas.length + " linhas");
  }
  avisos.forEach((a) => console.warn("aviso: " + a));
}

module.exports = { montar, ORDEM, GRAVACAO };

if (require.main === module) principal().catch((e) => {
  console.error("Falhou: " + (e && e.message ? e.message : e));
  process.exit(1);
});
