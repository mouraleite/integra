/* Acesso aos dados da área financeiro / tesouraria / pagadoria / fiscal / contábil / marketing no Supabase
   (substitui o Firebase). Depende de window.sb (supabase-client.js), window.DadosBase, window.DadosNucleo e
   window.MapasFinanceiro.
   Ordem no index.html: dados-base.js, mapas-nucleo.js, dados-nucleo.js, mapas-cobranca.js, dados-cobranca.js,
   mapas-engenharia.js, dados-engenharia.js, mapas-financeiro.js, dados-financeiro.js.

   1) Tabelas comuns (um doc do Firestore = uma linha): DadosFinanceiro.tabela("fiscal_notas_envio").listar() /
      obter(id) / gravar(id, obj, {merge}) / criar(obj) / excluir(id) / ouvir(cb, {aoErro}) — é o DadosNucleo.tabela
      com o mapa desta área. Vale para caixa_radar, cc_conta_parceria, sienge_creditors, participacoes_credores,
      rydoo_arquivos, rydoo_meta, fiscal_notas_envio, fiscal_notas_aprendizado, marketing_budgets,
      marketing_budget_config, titulos_incompletos_batimento.
      Filtros usam o nome da COLUNA: where("companyId", "==", x) vira listar({ filtros: [["company_id", "eq", x]] });
      orderBy("criadoEm", "desc") vira { ordem: ["criado_em", "desc"] }; where("tipo", "==", "forecast") ->
      [["tipo", "eq", "forecast"]].
   2) Formas que viraram cabeçalho + linhas, devolvidas no formato que o app lê hoje (ver mapas-financeiro.js):
      configuração do caixa, movimentos bancários, posição do caixa, valor a receber, contas pagas, antecipações,
      lotes de pagamento, períodos da prestação de contas, DFC (orçamento e realizado), resultado de caixa, mútuo,
      caches do marketing.
   3) Uma função por RPC da migration 202611191330_financeiro_fiscal_marketing.sql, com os argumentos da função SQL.
      As RPCs são security invoker (vale a RLS de quem chama). Funções "só servidor" aceitam um cliente (service role)
      no último argumento. */
(function () {
  "use strict";
  const B = window.DadosBase;
  const M = window.MapasFinanceiro;

  function sb() {
    if (!window.sb) throw new Error("Supabase não inicializado.");
    return window.sb;
  }
  // supabase-client.js é módulo (carrega depois dos scripts comuns): toda função pública espera por ele.
  const pronto = window.sb ? Promise.resolve() : new Promise((ok) => window.addEventListener("supabase-pronto", ok, { once: true }));
  function aposPronto(fn) {
    return async function () { await pronto; return fn.apply(this, arguments); };
  }
  function checar(r) {
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  const cli = (c) => c || sb();
  const copia = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  const porOrdem = (a, b) => a.ordem - b.ordem;

  // ---------------------------------------------------------------------------------------------
  // Tabelas comuns: reaproveita o CRUD/listener do núcleo com o mapa desta área.
  function tabela(nome) {
    const mapa = M[nome];
    if (!mapa) throw new Error("Tabela sem mapa (financeiro): " + nome);
    return window.DadosNucleo.tabela(mapa);
  }

  // ---------------------------------------------------------------------------------------------
  // CAIXA DIÁRIO: configuração (doc caixa_diario_config/saldo_inicial)

  // { contas: {"<emp>|<conta>": bool}, tipos: {...}, empreendimentosExcluidos: {"<emp>": [cc]}, updatedAt, updatedBy }
  // ou null (como snap.exists() falso).
  async function lerConfigCaixa() {
    const [contas, ccs] = await Promise.all([
      B.lerTudo(() => sb().from(M.caixa_diario_config_contas.tabela).select("*").order("id", { ascending: true })),
      B.lerTudo(() => sb().from(M.caixa_diario_config_cc_excluidos.tabela).select("*").order("id", { ascending: true })),
    ]);
    return M.montarConfigCaixa(contas, ccs);
  }

  // setDoc(saldo_inicial, patch, {merge: true}): grava só as chaves do patch (contas[k], tipos[k],
  // empreendimentosExcluidos[emp]); as outras colunas da linha ficam como estão. Devolve quantas linhas enviou.
  async function gravarConfigCaixa(patch) {
    const p = patch || {};
    const por = p.updatedBy;
    const linhas = {};
    const linha = (k) => {
      if (linhas[k]) return linhas[k];
      const partes = M.partesContaCaixa(k);
      if (!partes) return null;
      const l = { id: k, company_id: partes.companyId, conta: partes.conta };
      if (por !== undefined) l.atualizado_por = por;
      return (linhas[k] = l);
    };
    Object.keys(p.contas || {}).forEach((k) => { const l = linha(k); if (l) l.incluida = B.paraBanco(p.contas[k], "bool"); });
    Object.keys(p.tipos || {}).forEach((k) => { const l = linha(k); if (l) l.tipo = p.tipos[k] == null ? null : String(p.tipos[k]); });
    let n = 0;
    const contas = Object.keys(linhas).map((k) => linhas[k]);
    // Uma chamada por formato de linha (o upsert em lote usa as colunas da 1ª linha).
    const grupos = {};
    contas.forEach((l) => { const g = Object.keys(l).sort().join(","); (grupos[g] = grupos[g] || []).push(l); });
    for (const g of Object.keys(grupos)) {
      checar(await sb().from(M.caixa_diario_config_contas.tabela).upsert(grupos[g], { onConflict: "id", defaultToNull: false }));
      n += grupos[g].length;
    }
    const exc = p.empreendimentosExcluidos || {};
    const ccs = Object.keys(exc).map((co) => {
      const l = { id: String(co), empreendimentos: B.paraBanco(exc[co], "textos") || [] };
      if (por !== undefined) l.atualizado_por = por;
      return l;
    });
    if (ccs.length) {
      checar(await sb().from(M.caixa_diario_config_cc_excluidos.tabela).upsert(ccs, { onConflict: "id", defaultToNull: false }));
      n += ccs.length;
    }
    return n;
  }

  // ---------------------------------------------------------------------------------------------
  // CAIXA: movimentos bancários do Sienge até 2025-12 (SiengeApiService _lerMesCaixa / _gravarMesCaixa)

  // Lista de movimentos do mês (objetos do Sienge, na ordem gravada) ou null se o mês não foi gravado.
  async function lerMesCaixa(companyId, ym) {
    const id = String(companyId) + "_" + ym;
    const pai = checar(await sb().from(M.caixa_movimentos.tabela).select("id").eq("id", id).maybeSingle());
    if (!pai) return null;
    const itens = await B.lerTudo(() => sb().from(M.caixa_movimentos_itens.tabela).select("ordem, dados")
      .eq("caixa_movimentos_id", id).order("ordem", { ascending: true }));
    return itens.map((l) => l.dados);
  }

  // RPC gravar_caixa_movimentos_mes(p_company_id text, p_ym text, p_movimentos jsonb) -> nº de movimentos.
  async function gravarMesCaixa(companyId, ym, movimentos, cliente) {
    return checar(await cli(cliente).rpc("gravar_caixa_movimentos_mes", {
      p_company_id: String(companyId), p_ym: ym, p_movimentos: copia(Array.isArray(movimentos) ? movimentos : []),
    }));
  }

  // Marcador "<empresa>_base" ({ companyId, ate, em }) ou null.
  async function lerBaseCaixa(companyId) {
    const l = checar(await sb().from(M.caixa_movimentos.tabela).select("*").eq("id", String(companyId) + "_base").maybeSingle());
    if (!l) return null;
    const o = B.paraObjeto(M.caixa_movimentos, l);
    delete o.id;
    return o;
  }

  async function marcarBaseCaixa(companyId, ate) {
    const l = B.paraLinha(M.caixa_movimentos, { companyId: String(companyId), ate: ate || "2025-12", em: new Date().toISOString() },
      String(companyId) + "_base");
    checar(await sb().from(M.caixa_movimentos.tabela).upsert(l, { onConflict: "id" }));
  }

  // ---------------------------------------------------------------------------------------------
  // CAIXA: posição diária (CaixaPosicaoStore)

  // RPC gravar_caixa_posicao(p_data date, p_linhas jsonb): apaga o dia e insere as linhas. Devolve quantas.
  async function gravarCaixaPosicao(data, linhas, cliente) {
    return checar(await cli(cliente).rpc("gravar_caixa_posicao", { p_data: data, p_linhas: copia(Array.isArray(linhas) ? linhas : []) }));
  }

  // RPC listar_datas_caixa_posicao(): ["AAAA-MM-DD", ...] da mais recente para a mais antiga.
  async function listarDatasCaixaPosicao() {
    const r = checar(await sb().rpc("listar_datas_caixa_posicao")) || [];
    return r.map((x) => (x && typeof x === "object" ? x.listar_datas_caixa_posicao : x)).filter(Boolean).map(String);
  }

  // Linhas do dia no formato rows[] ({ d, uid, un, cc, cn, cid, cpf, nome, rec, ven, av, vp, pmp, st, parc }).
  // opcoes.colunas: select reduzido (ex.: "id, uid, cid, pmp, extra").
  async function lerCaixaPosicao(data, opcoes) {
    if (!data) return [];
    const o = opcoes || {};
    const linhas = await B.lerTudo(() => sb().from(M.caixa_posicao.tabela).select(o.colunas || "*")
      .eq("d", data).order("id", { ascending: true }));
    return linhas.map((l) => { const x = B.paraObjeto(M.caixa_posicao, l); delete x.id; return x; });
  }

  // A foto mais recente (fila de cobrança, app.js ensureFilaPmpIndex): { date, rows } ou { date: "", rows: [] }.
  async function lerCaixaPosicaoRecente(opcoes) {
    const l = checar(await sb().from(M.caixa_posicao.tabela).select("d").order("d", { ascending: false }).limit(1));
    const date = l && l.length ? String(l[0].d) : "";
    return { date, rows: date ? await lerCaixaPosicao(date, opcoes) : [] };
  }

  // ---------------------------------------------------------------------------------------------
  // CAIXA: valor a receber (doc emp_<empresa>, itens em texto JSON)

  // Equivale a getDocs(collection("caixa_valor_receber")) sem o _estado: snapshot de imitação com docs
  // { companyId, ini, fim, origem, por, falhas, atualizadoEm, itens: "<texto JSON>" }.
  async function listarValorReceber() {
    const [pais, itens] = await Promise.all([
      B.lerTudo(() => sb().from(M.caixa_valor_receber.tabela).select("*").order("id", { ascending: true })),
      B.lerTudo(() => sb().from(M.caixa_valor_receber_itens.tabela).select("*")
        .order("caixa_valor_receber_id", { ascending: true }).order("ordem", { ascending: true })),
    ]);
    const porPai = {};
    itens.forEach((l) => { (porPai[l.caixa_valor_receber_id] = porPai[l.caixa_valor_receber_id] || []).push(l); });
    return B.snapLista(pais.map((p) => B.snapDoc(p.id, M.montarValorReceber(p, porPai[p.id] || []))));
  }

  // RPC gravar_caixa_valor_receber(p_registro jsonb, p_itens jsonb). registro = o doc do app
  // ({ companyId, ini, fim, atualizadoEm, origem, por, falhas, itens }); itens (lista ou texto JSON) vem de
  // registro.itens se não for passado. Devolve quantos itens gravou.
  async function gravarValorReceber(registro, itens, cliente) {
    const r = registro || {};
    const lista = M.itensValorReceber(itens !== undefined && itens !== null ? itens : r.itens);
    return checar(await cli(cliente).rpc("gravar_caixa_valor_receber", { p_registro: copia(M.sem(r, ["itens"])), p_itens: copia(lista) }));
  }

  // _estado do cron (só servidor: passar o cliente service role). Doc no formato antigo (itens em texto JSON) ou null.
  async function lerEstadoValorReceber(cliente) {
    const l = checar(await cli(cliente).from(M.caixa_valor_receber_estado.tabela).select("*").eq("id", "_estado").maybeSingle());
    if (!l) return null;
    const o = B.paraObjeto(M.caixa_valor_receber_estado, l);
    delete o.id;
    return o;
  }
  async function gravarEstadoValorReceber(dados, opcoes, cliente) {
    let final = dados || {};
    if (opcoes && opcoes.merge) {
      const atual = await lerEstadoValorReceber(cliente);
      if (atual) final = window.DadosNucleo.fundir(atual, final);
    }
    const l = M.aplicarPadroes("caixa_valor_receber_estado", B.paraLinha(M.caixa_valor_receber_estado, final, "_estado"));
    checar(await cli(cliente).from(M.caixa_valor_receber_estado.tabela).upsert(l, { onConflict: "id" }));
  }

  // ---------------------------------------------------------------------------------------------
  // CONTAS PAGAS (Compras › Controle financeiro e cron das 7h)

  // Títulos do mês (objetos do bulk-data do Sienge, na ordem gravada) ou null se o mês não foi gravado.
  async function lerMesPago(companyId, ym) {
    const id = String(companyId || "todas") + "_" + ym;
    const pai = checar(await sb().from(M.cfin_pagos.tabela).select("id").eq("id", id).maybeSingle());
    if (!pai) return null;
    const itens = await B.lerTudo(() => sb().from(M.cfin_pagos_bills.tabela).select("ordem, dados")
      .eq("cfin_pagos_id", id).order("ordem", { ascending: true }));
    return itens.map((l) => l.dados);
  }

  // Cabeçalho do mês no formato do doc ({ companyId, ym, n, em, ate, fechado }) ou null.
  async function lerCabecalhoMesPago(companyId, ym, cliente) {
    const l = checar(await cli(cliente).from(M.cfin_pagos.tabela).select("*").eq("id", String(companyId || "todas") + "_" + ym).maybeSingle());
    if (!l) return null;
    const o = B.paraObjeto(M.cfin_pagos, l);
    delete o.id;
    return o;
  }

  // RPC gravar_cfin_pagos_mes(p_company_id text, p_ym text, p_bills jsonb, p_ate date, p_fechado boolean).
  // extra = { ate, fechado } (o cron); a tela não manda. Devolve quantos títulos gravou.
  async function gravarMesPago(companyId, ym, bills, extra, cliente) {
    const e = extra || {};
    const args = { p_company_id: String(companyId || "todas"), p_ym: ym, p_bills: copia(Array.isArray(bills) ? bills : []) };
    if (e.ate !== undefined) args.p_ate = e.ate || null;
    if (e.fechado !== undefined) args.p_fechado = !!e.fechado;
    return checar(await cli(cliente).rpc("gravar_cfin_pagos_mes", args));
  }

  // Marcador _corte ({ ate, ymFechado, em }) ou null.
  async function lerCortePagos(cliente) {
    const l = checar(await cli(cliente).from(M.cfin_pagos.tabela).select("*").eq("id", "_corte").maybeSingle());
    if (!l) return null;
    const o = B.paraObjeto(M.cfin_pagos, l);
    delete o.id;
    if (o.fechado === false) delete o.fechado; // default da coluna; o doc _corte não tem fechado
    if (o.ate === undefined) o.ate = "";
    return o;
  }
  async function marcarCortePagos(ate, ymFechado, cliente) {
    const l = B.paraLinha(M.cfin_pagos, { ate: ate || "", ymFechado: ymFechado || "2025-12", em: new Date().toISOString() }, "_corte");
    checar(await cli(cliente).from(M.cfin_pagos.tabela).upsert(l, { onConflict: "id" }));
  }

  // ---------------------------------------------------------------------------------------------
  // ANTECIPAÇÕES

  // O que antecipacoes.js lerMes guarda: { eventos: [...], atualizadoEm, fonte } ou { eventos: [], atualizadoEm: "",
  // vazio: true } se o mês não existe. Eventos em ordem de data e k.
  async function lerMesAntecipacoes(mes) {
    const pai = checar(await sb().from(M.antecipacoes_mes.tabela).select("*").eq("id", mes).maybeSingle());
    if (!pai) return M.montarAntecipacaoMes(null);
    const eventos = await B.lerTudo(() => sb().from(M.antecipacoes_mes_eventos.tabela).select("*")
      .eq("antecipacoes_mes_id", mes).order("data", { ascending: true }).order("id", { ascending: true }));
    return M.montarAntecipacaoMes(pai, eventos);
  }

  // RPC substituir_antecipacoes_janela(p_ini date, p_fim date, p_eventos jsonb, p_fonte text). SÓ SERVIDOR:
  // passar o cliente service role. Devolve quantos eventos gravou.
  async function substituirJanelaAntecipacoes(ini, fim, eventos, fonte, cliente) {
    const args = { p_ini: ini, p_fim: fim, p_eventos: copia(Array.isArray(eventos) ? eventos : []) };
    if (fonte) args.p_fonte = fonte;
    return checar(await cli(cliente).rpc("substituir_antecipacoes_janela", args));
  }

  // ---------------------------------------------------------------------------------------------
  // PAGADORIA: lotes do Gerar pagamento

  // Todos os lotes no formato do app ({ id, criadoPor, ..., conta: {...}, sienge: {...}, itens: [...] }).
  async function listarLotes() {
    const linhas = await B.lerTudo(() => sb().from(M.pagamento_lotes.tabela).select("*, pagamento_lotes_itens(*)")
      .order("id", { ascending: true }));
    return linhas.map((l) => M.montarLote(l));
  }

  async function lerLote(id) {
    const l = checar(await sb().from(M.pagamento_lotes.tabela).select("*, pagamento_lotes_itens(*)").eq("id", String(id)).maybeSingle());
    return l ? M.montarLote(l) : null;
  }

  // RPC salvar_pagamento_lote(p_lote jsonb): upsert do cabeçalho e troca dos itens (setDoc do lote inteiro). Devolve o id.
  async function salvarLote(lote) {
    return checar(await sb().rpc("salvar_pagamento_lote", { p_lote: copia(lote) }));
  }

  // deleteDoc do lote (os itens saem em cascata).
  async function excluirLote(id) {
    checar(await sb().from(M.pagamento_lotes.tabela).delete().eq("id", String(id)));
  }

  // Conta de parceria do CC (gravarContaParceria de centros-custo.js). conta null zera as colunas conta_*.
  // Devolve o updatedAt gravado (ms): é o atualizado_em do banco (o gatilho troca pelo horário do servidor).
  async function gravarContaParceria(ccId, conta, por) {
    const obj = { cc_id: String(ccId), conta: conta || null, updatedAt: Date.now(), updatedBy: por || "" };
    const l = B.paraLinha(M.cc_conta_parceria, obj, String(ccId));
    const r = checar(await sb().from(M.cc_conta_parceria.tabela).upsert(l, { onConflict: "id" }).select("atualizado_em").maybeSingle());
    return (r && Date.parse(r.atualizado_em)) || obj.updatedAt;
  }

  // ---------------------------------------------------------------------------------------------
  // PARTICIPAÇÕES (prestação de contas Ellenco)

  // where("companyId", "==", x): períodos no formato do doc ({ id, companyId, closing, fileName, saldoTotal,
  // expenses: [...], pdfUrl, pdfPath, cacheVer, updatedAt, updatedBy }).
  async function listarPeriodosParticipacoes(companyId) {
    const linhas = await B.lerTudo(() => sb().from(M.participacoes_periods.tabela).select("*, participacoes_periods_expenses(*)")
      .eq("company_id", String(companyId)).order("closing", { ascending: true }));
    return linhas.map((l) => M.montarPeriodo(l));
  }

  // RPC salvar_participacoes_period(p_period jsonb) (savePeriodToFirebase, merge: campos ausentes ficam como estão;
  // sem "expenses" as despesas não mudam). Devolve o id.
  async function salvarPeriodoParticipacoes(period) {
    const p = copia(M.sem(period, ["updatedAtServer"]));
    if (!p.id && p.companyId && p.closing) p.id = M.idPeriodoParticipacoes(p.companyId, p.closing);
    return checar(await sb().rpc("salvar_participacoes_period", { p_period: p }));
  }

  // ---------------------------------------------------------------------------------------------
  // DFC (Orçamento › Novo orçamento)

  // Doc no formato atual ({ fileName, savedAt (ms), year, n, payload: "<JSON das linhas>", partes: [] }) ou null.
  async function lerOrcamentoDfc(id) {
    const l = checar(await sb().from(M.dfc_orcamento.tabela).select("*, dfc_orcamento_linhas(*)").eq("id", String(id)).maybeSingle());
    return l ? M.montarOrcamentoDfc(l) : null;
  }

  // RPC gravar_dfc_orcamento(p_id text, p_file_name text, p_saved_at timestamptz, p_year integer, p_linhas jsonb).
  // pack = { fileName, savedAt (ms), year, lines }. Devolve quantas linhas gravou (conferir com lines.length).
  async function gravarOrcamentoDfc(id, pack) {
    const p = pack || {};
    return checar(await sb().rpc("gravar_dfc_orcamento", {
      p_id: String(id), p_file_name: p.fileName || "", p_saved_at: B.paraBanco(p.savedAt || Date.now(), "ms"),
      p_year: p.year != null ? Number(p.year) : null, p_linhas: copia(Array.isArray(p.lines) ? p.lines : []),
    }));
  }

  // Doc "c<empresa>" no formato atual ({ empresa, fim, ate, v, em, n, payload: "<JSON das linhas compactas>",
  // partes: [] }) ou null.
  async function lerRealizadoDfc(empresa) {
    const l = checar(await sb().from(M.dfc_realizado.tabela).select("*, dfc_realizado_itens(*)").eq("id", "c" + empresa).maybeSingle());
    return l ? M.montarRealizadoDfc(l) : null;
  }

  // RPC gravar_dfc_realizado(p_empresa text, p_fim date, p_ate date, p_itens jsonb). itens: objetos
  // { gid, code, cc, i, v, ccn, cn } ou compactos [gid, code, cc, i, v, ccn, cn]. Devolve quantos gravou.
  async function gravarRealizadoDfc(empresa, fim, ate, itens) {
    return checar(await sb().rpc("gravar_dfc_realizado", {
      p_empresa: String(empresa), p_fim: fim, p_ate: ate || fim, p_itens: copia(Array.isArray(itens) ? itens : []),
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // RESULTADO DE CAIXA

  // Equivale a getDocs(collection("resultado_caixa")) (opcoes.tipo = "forecast" para o where do forecast):
  // snapshot de imitação. Cada doc vem com entradas/contas/contasPorCc já como objeto, planosJson em texto JSON e
  // partes: [] (o aplicarDoc da tela aceita esse formato; não há mais docs "parte").
  async function listarResultadoCaixa(opcoes) {
    const o = opcoes || {};
    const linhas = await B.lerTudo(() => {
      let q = sb().from(M.resultado_caixa.tabela).select(o.colunas || "*");
      if (o.tipo) q = q.eq("tipo", o.tipo);
      return q.order("id", { ascending: true });
    });
    return B.snapLista(linhas.map((l) => B.snapDoc(l.id, (() => { const d = M.montarResultado(l); delete d.id; return d; })())));
  }

  // salvarArquivoNuvem / salvarForecastNuvem: setDoc do doc inteiro. Aceita o doc com "payload" (texto JSON com
  // entradas/contas/contasPorCc/planosJson) — ele é aberto nas colunas; "partes" é ignorado.
  async function gravarResultadoCaixa(id, doc) {
    const obj = M.abrirResultado(doc || {});
    const l = M.aplicarPadroes("resultado_caixa", B.paraLinha(M.resultado_caixa, obj, id));
    checar(await sb().from(M.resultado_caixa.tabela).upsert(l, { onConflict: "id" }));
    return id;
  }

  async function excluirResultadoCaixa(id) {
    checar(await sb().from(M.resultado_caixa.tabela).delete().eq("id", String(id)));
  }

  // ---------------------------------------------------------------------------------------------
  // RYDOO: rydoo_titulos (setDoc com merge; competencia sai do id)
  async function gravarTituloRydoo(id, dados, opcoes) {
    let final = dados || {};
    if (opcoes && opcoes.merge) {
      const atual = await tabela("rydoo_titulos").obter(id);
      if (atual) { delete atual.id; final = window.DadosNucleo.fundir(atual, final); }
    }
    const l = B.paraLinha(M.rydoo_titulos, final, id);
    l.competencia = M.competenciaRydoo(id);
    checar(await sb().from(M.rydoo_titulos.tabela).upsert(l, { onConflict: "id" }));
    return id;
  }

  // ---------------------------------------------------------------------------------------------
  // FISCAL: fila de notas em tempo real (onSnapshot(orderBy("criadoEm","desc"), limit(400))).
  // cb({ docs, mudancas }) como o DadosNucleo.tabela().ouvir. Devolve função para parar.
  function ouvirFilaNotas(cb, aoErro) {
    return tabela("fiscal_notas_envio").ouvir(cb, { ordem: ["criado_em", "desc"], limite: 400, aoErro });
  }

  // ---------------------------------------------------------------------------------------------
  // MARKETING: caches do budget

  // { start, end, savedAt (ms), bills } ou null (a validade de 30 min continua com a tela).
  async function lerCacheTitulosMarketing(ccId) {
    const l = checar(await sb().from(M.marketing_budget_titulos.tabela).select("*").eq("id", String(ccId)).maybeSingle());
    return M.montarCacheTitulos(l);
  }
  async function gravarCacheTitulosMarketing(ccId, start, end, bills, savedAt) {
    const l = M.aplicarPadroes("marketing_budget_titulos", B.paraLinha(M.marketing_budget_titulos,
      { start, end, savedAt: savedAt || Date.now(), bills: Array.isArray(bills) ? bills : [] }, String(ccId)));
    checar(await sb().from(M.marketing_budget_titulos.tabela).upsert(l, { onConflict: "id" }));
  }

  // { meses: { "AAAA-MM": { vendas, distratos } } } (lerCacheVendas). Sem linhas: { meses: {} }.
  async function lerCacheVendasMarketing(ccId) {
    const linhas = await B.lerTudo(() => sb().from(M.marketing_budget_vendas.tabela).select("ym, vendas, distratos")
      .eq("cc_id", String(ccId)).order("ym", { ascending: true }));
    const out = { meses: {} };
    linhas.forEach((l) => {
      out.meses[l.ym] = { vendas: Array.isArray(l.vendas) ? l.vendas : [], distratos: Array.isArray(l.distratos) ? l.distratos : [] };
    });
    return out;
  }
  // porMes = { "AAAA-MM": { vendas, distratos } }. Meses fora do padrão são ignorados. Devolve quantos gravou.
  async function gravarCacheVendasMarketing(ccId, porMes, savedAt) {
    const em = savedAt || Date.now();
    const linhas = Object.keys(porMes || {}).filter((ym) => /^\d{4}-\d{2}$/.test(ym)).map((ym) =>
      M.linhaVendasMarketing({ vendas: porMes[ym].vendas || [], distratos: porMes[ym].distratos || [], savedAt: em }, String(ccId), ym));
    for (let i = 0; i < linhas.length; i += 100) {
      checar(await sb().from(M.marketing_budget_vendas.tabela).upsert(linhas.slice(i, i + 100), { onConflict: "id" }));
    }
    return linhas.length;
  }

  // ---------------------------------------------------------------------------------------------
  // MÚTUO

  // Docs { id, operacao, competencia, atualizadoEm, centros: { <chave>: {...} } } (carregarHistorico).
  async function listarExecucoesMutuo() {
    const linhas = await B.lerTudo(() => sb().from(M.mutuo_execucoes.tabela).select("*, mutuo_execucoes_centros(*)")
      .order("competencia", { ascending: false }));
    return linhas.map((l) => M.montarExecucaoMutuo(l));
  }
  async function lerExecucaoMutuo(id) {
    const l = checar(await sb().from(M.mutuo_execucoes.tabela).select("*, mutuo_execucoes_centros(*)").eq("id", String(id)).maybeSingle());
    if (!l) return null;
    const o = M.montarExecucaoMutuo(l);
    delete o.id;
    return o;
  }

  // gravarHistorico(id, comp, chave, dados): setDoc({ operacao, competencia, atualizadoEm, centros: { [chave]: dados } },
  // { merge: true }). O centro é fundido com o que já existe (merge profundo, como no Firestore).
  async function gravarExecucaoMutuo(id, cabecalho, chave, dados) {
    const c = cabecalho || {};
    const pai = B.paraLinha(M.mutuo_execucoes, { operacao: c.operacao, competencia: c.competencia }, String(id));
    delete pai.extra; // merge: não apaga o extra de quem gravou antes
    checar(await sb().from(M.mutuo_execucoes.tabela).upsert(pai, { onConflict: "id", defaultToNull: false }));
    if (chave === undefined || chave === null) return id;
    const atual = checar(await sb().from(M.mutuo_execucoes_centros.tabela).select("*")
      .eq("mutuo_execucoes_id", String(id)).eq("chave", String(chave)).maybeSingle());
    let final = dados || {};
    if (atual) { const o = B.paraObjeto(M.mutuo_execucoes_centros, atual); delete o.id; final = window.DadosNucleo.fundir(o, final); }
    const l = M.linhaCentroMutuo(final, String(id), chave);
    checar(await sb().from(M.mutuo_execucoes_centros.tabela).upsert(l, { onConflict: "mutuo_execucoes_id,chave" }));
    return id;
  }

  // Última nota de débito registrada no Integra (mutuo_meta/notas_debito.ultima), 0 se não houver.
  async function lerUltimaNotaDebito() {
    const l = checar(await sb().from(M.mutuo_meta.tabela).select("ultima").eq("id", "notas_debito").maybeSingle());
    return Number(l && l.ultima) || 0;
  }

  // RPC registrar_nota_debito_mutuo(p_numero integer, p_por text): só avança. Devolve a última gravada.
  async function registrarNotaDebito(numero, por) {
    const args = { p_numero: Number(numero) };
    if (por) args.p_por = por;
    return checar(await sb().rpc("registrar_nota_debito_mutuo", args));
  }

  // ---------------------------------------------------------------------------------------------
  // TÍTULOS INCOMPLETOS: doc "atual" (primeiros em texto JSON, como hoje) ou null.
  async function lerTitulosIncompletos() {
    const o = await tabela("titulos_incompletos_batimento").obter("atual");
    if (!o) return null;
    delete o.id;
    return o;
  }

  window.DadosFinanceiro = {
    pronto,
    tabela,
    // caixa diário
    lerConfigCaixa: aposPronto(lerConfigCaixa),
    gravarConfigCaixa: aposPronto(gravarConfigCaixa),
    lerMesCaixa: aposPronto(lerMesCaixa),
    gravarMesCaixa: aposPronto(gravarMesCaixa),
    lerBaseCaixa: aposPronto(lerBaseCaixa),
    marcarBaseCaixa: aposPronto(marcarBaseCaixa),
    gravarCaixaPosicao: aposPronto(gravarCaixaPosicao),
    listarDatasCaixaPosicao: aposPronto(listarDatasCaixaPosicao),
    lerCaixaPosicao: aposPronto(lerCaixaPosicao),
    lerCaixaPosicaoRecente: aposPronto(lerCaixaPosicaoRecente),
    listarValorReceber: aposPronto(listarValorReceber),
    gravarValorReceber: aposPronto(gravarValorReceber),
    lerEstadoValorReceber: aposPronto(lerEstadoValorReceber),
    gravarEstadoValorReceber: aposPronto(gravarEstadoValorReceber),
    // contas pagas / antecipações
    lerMesPago: aposPronto(lerMesPago),
    lerCabecalhoMesPago: aposPronto(lerCabecalhoMesPago),
    gravarMesPago: aposPronto(gravarMesPago),
    lerCortePagos: aposPronto(lerCortePagos),
    marcarCortePagos: aposPronto(marcarCortePagos),
    lerMesAntecipacoes: aposPronto(lerMesAntecipacoes),
    substituirJanelaAntecipacoes: aposPronto(substituirJanelaAntecipacoes),
    // pagadoria
    listarLotes: aposPronto(listarLotes),
    lerLote: aposPronto(lerLote),
    salvarLote: aposPronto(salvarLote),
    excluirLote: aposPronto(excluirLote),
    gravarContaParceria: aposPronto(gravarContaParceria),
    // participações
    listarPeriodosParticipacoes: aposPronto(listarPeriodosParticipacoes),
    salvarPeriodoParticipacoes: aposPronto(salvarPeriodoParticipacoes),
    // DFC / resultado de caixa
    lerOrcamentoDfc: aposPronto(lerOrcamentoDfc),
    gravarOrcamentoDfc: aposPronto(gravarOrcamentoDfc),
    lerRealizadoDfc: aposPronto(lerRealizadoDfc),
    gravarRealizadoDfc: aposPronto(gravarRealizadoDfc),
    listarResultadoCaixa: aposPronto(listarResultadoCaixa),
    gravarResultadoCaixa: aposPronto(gravarResultadoCaixa),
    excluirResultadoCaixa: aposPronto(excluirResultadoCaixa),
    // rydoo / fiscal
    gravarTituloRydoo: aposPronto(gravarTituloRydoo),
    ouvirFilaNotas,
    // marketing
    lerCacheTitulosMarketing: aposPronto(lerCacheTitulosMarketing),
    gravarCacheTitulosMarketing: aposPronto(gravarCacheTitulosMarketing),
    lerCacheVendasMarketing: aposPronto(lerCacheVendasMarketing),
    gravarCacheVendasMarketing: aposPronto(gravarCacheVendasMarketing),
    // mútuo
    listarExecucoesMutuo: aposPronto(listarExecucoesMutuo),
    lerExecucaoMutuo: aposPronto(lerExecucaoMutuo),
    gravarExecucaoMutuo: aposPronto(gravarExecucaoMutuo),
    lerUltimaNotaDebito: aposPronto(lerUltimaNotaDebito),
    registrarNotaDebito: aposPronto(registrarNotaDebito),
    // títulos incompletos
    lerTitulosIncompletos: aposPronto(lerTitulosIncompletos),
  };
  window.dispatchEvent(new Event("dados-financeiro-pronto"));
})();
