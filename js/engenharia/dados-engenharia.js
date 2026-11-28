/* Acesso aos dados da área engenharia / vistoria / comercial / orçamento de empreendimento no Supabase
   (substitui o Firebase). Depende de window.sb (supabase-client.js), window.DadosBase, window.DadosNucleo e
   window.MapasEngenharia.
   Ordem no index.html: dados-base.js, mapas-nucleo.js, dados-nucleo.js, mapas-cobranca.js, dados-cobranca.js,
   mapas-engenharia.js, dados-engenharia.js.

   1) Tabelas comuns (um doc do Firestore = uma linha): DadosEngenharia.tabela("vistorias").listar() / obter(id) /
      gravar(id, obj, {merge}) / criar(obj) / excluir(id) / ouvir(cb, {aoErro}) — é o DadosNucleo.tabela com o mapa
      desta área. Vale para vistorias, vistoria_avisos, construction_checks, tabelas_vigentes,
      orcamento_empreendimento, orcamento_receita, tag_solicitacoes, solicitacoes_producao.
      Filtros usam o nome da COLUNA: where("app.responsavelEmail", "==", x) vira
      listar({ filtros: [["app_responsavel_email", "eq", x]] }); where("solicitante.email") -> "solicitante_email".
      Fotos/arquivos: o front grava e recebe URL (fotoFrente, fileUrl, fileUrls); o banco guarda o caminho
      (ver cabeçalho de mapas-engenharia.js).
   2) Formas que viraram várias linhas, devolvidas no formato que o app usa hoje:
      - estoque_comercial (docs cc_<cc>_<n> com units[]) e estoque_comercial_controle (_meta, _batimento_state,
        _conferencia_geral);
      - engenharia_acompanhamento (doc "obras" { linhas, savedAt });
      - caucao_base (_meta, base do dia, _passado, _ajustes);
      - vistoria_batimento e comercial_batimento (caches do cron);
      - orcamento_forecast (id "emp_<companyId>").
   As RPCs são as da migration 202611191320_engenharia_comercial.sql. */
(function () {
  "use strict";
  const B = window.DadosBase;
  const M = window.MapasEngenharia;

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
  const maxIso = (linhas, col) => {
    const ms = linhas.reduce((m, l) => Math.max(m, Date.parse(l[col || "atualizado_em"]) || 0), 0);
    return ms ? new Date(ms).toISOString() : null;
  };

  // Upsert em lotes de 500 (padrão do gravarLinhas do núcleo; defaultToNull: false mantém o default/valor atual
  // das colunas ausentes).
  async function gravarLinhas(tabelaNome, linhas, conflito) {
    for (let i = 0; i < linhas.length; i += 500) {
      checar(await sb().from(tabelaNome).upsert(linhas.slice(i, i + 500), { onConflict: conflito || "id", defaultToNull: false }));
    }
    return linhas.length;
  }

  // ---------------------------------------------------------------------------------------------
  // Tabelas comuns: reaproveita o CRUD/listener do núcleo com o mapa desta área.
  function tabela(nome) {
    const mapa = M[nome];
    if (!mapa) throw new Error("Tabela sem mapa (engenharia): " + nome);
    return window.DadosNucleo.tabela(mapa);
  }

  // ---------------------------------------------------------------------------------------------
  // VISTORIA

  // Envio das fotos/respostas (substitui o updateDoc de vistoria.js:585). fotos = { fotoFrente, fotoMeioFundo,
  // fotoFundoFrente } com URL de download ou caminho. Devolve false se a vistoria não existe ou já foi concluída.
  async function enviarVistoria(id, respostas, fotos) {
    const f = fotos || {};
    const caminho = (v) => (v === undefined || v === null || v === "" ? null : (B.caminhoStorage(v) || String(v)));
    const r = await sb().rpc("enviar_vistoria", {
      p_id: String(id), p_respostas: respostas || {}, p_foto_frente: caminho(f.fotoFrente),
      p_foto_meio_fundo: caminho(f.fotoMeioFundo), p_foto_fundo_frente: caminho(f.fotoFundoFrente),
    });
    return checar(r) === true;
  }

  // Fila de clientes da tela Vistoria (substitui _meta + shards <dia>_p<i>). null se o cron ainda não gerou o dia
  // (mesmo retorno do lerClientesDoBatimento quando o _meta não é de hoje).
  async function lerVistoriaBatimento(dia) {
    const d = dia || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const l = checar(await sb().from(M.vistoria_batimento.tabela).select("clientes").eq("id", d).maybeSingle());
    return l && Array.isArray(l.clientes) ? l.clientes : null;
  }

  // ---------------------------------------------------------------------------------------------
  // ENGENHARIA: acompanhamento de obras. Doc "obras" = { linhas: [...], savedAt: epoch ms }.
  function linhaAcompanhamentoParaObjeto(l) {
    const o = B.paraObjeto(M.engenharia_acompanhamento, l);
    M.DATAS_ACOMPANHAMENTO.forEach((k) => { if (o[k] === undefined) o[k] = ""; }); // "" como o app grava
    if (o.historico && Array.isArray(o.historico) && !o.historico.length) delete o.historico;
    return o;
  }

  // null se não houver linhas (como snap.exists() falso). savedAt = maior atualizado_em (ms).
  async function lerAcompanhamento() {
    const linhas = checar(await sb().from(M.engenharia_acompanhamento.tabela).select("*").order("id", { ascending: true }));
    if (!linhas || !linhas.length) return null;
    return { linhas: linhas.map(linhaAcompanhamentoParaObjeto), savedAt: Date.parse(maxIso(linhas)) || 0 };
  }

  // Substitui a lista inteira (setDoc do doc "obras"): upsert de todas as linhas (o gatilho renova atualizado_em,
  // que vira o savedAt) e exclusão das que saíram. Devolve o savedAt gravado (ms).
  async function salvarAcompanhamento(linhas) {
    const lista = (Array.isArray(linhas) ? linhas : []).filter((r) => r && r.id);
    const ids = lista.map((r) => String(r.id));
    const enviar = lista.map((r) => M.aplicarPadroes("engenharia_acompanhamento", B.paraLinha(M.engenharia_acompanhamento, r, r.id)));
    const gravadas = enviar.length
      ? checar(await sb().from(M.engenharia_acompanhamento.tabela).upsert(enviar, { onConflict: "id", defaultToNull: false }).select("id, atualizado_em"))
      : [];
    let q = sb().from(M.engenharia_acompanhamento.tabela).delete();
    q = ids.length ? q.not("id", "in", "(" + ids.map((x) => '"' + x.replace(/"/g, '""') + '"').join(",") + ")") : q.neq("id", "");
    checar(await q);
    return Date.parse(maxIso(gravadas || [])) || Date.now();
  }

  // ---------------------------------------------------------------------------------------------
  // CAUÇÃO

  // Doc _meta no formato antigo ({ date, count, running, runningAt, done, geradoEm, range: {startDate, endDate},
  // erro, erroEm, prazo, planejadas, ... }). null se não existir.
  async function lerMetaCaucao() {
    const l = checar(await sb().from(M.caucao_base_controle.tabela).select("*").eq("id", "_meta").maybeSingle());
    if (!l) return null;
    const o = B.paraObjeto(M.caucao_base_controle, l);
    delete o.id;
    if (o.running === undefined) o.running = false;
    if (o.done === undefined) o.done = false;
    return o;
  }

  function linhaBaseParaObjeto(l) {
    const o = B.paraObjeto(M.caucao_base, l);
    o.rows = Array.isArray(o.rows) ? o.rows : [];
    o.chunks = 1; // a base inteira está numa linha (compatível com quem ainda olha meta.chunks)
    return o;
  }

  // Base do dia gerada pela rotina (antes <data>_0..N). { rows, date, count, geradoEm, ... } ou null.
  async function lerBaseCaucao(date) {
    const l = checar(await sb().from(M.caucao_base.tabela).select("*").eq("id", String(date)).maybeSingle());
    return l ? linhaBaseParaObjeto(l) : null;
  }

  // Base do passado (antes _passado + _passado_N): { meta: { startDate, endDate, corte, count, geradoEm, chunks }, rows }.
  async function lerPassadoCaucao() {
    const l = checar(await sb().from(M.caucao_base.tabela).select("*").eq("id", "passado").maybeSingle());
    if (!l) return null;
    const o = linhaBaseParaObjeto(l);
    const rows = o.rows;
    delete o.rows; delete o.id;
    return { meta: o, rows };
  }

  // gravarPassado(start, end, rows) da tela: uma linha só (os chunks somem).
  async function gravarPassadoCaucao(start, end, rows, extras) {
    const lista = Array.isArray(rows) ? rows : [];
    const obj = Object.assign({}, extras || {}, {
      startDate: start, endDate: end, count: lista.length, geradoEm: new Date().toISOString(), rows: lista,
    });
    const l = M.aplicarPadroes("caucao_base", B.paraLinha(M.caucao_base, obj, "passado"));
    l.tipo = "passado";
    checar(await sb().from(M.caucao_base.tabela).upsert(l, { onConflict: "id" }));
    return lista.length;
  }

  // Mapa { "titulo|parcela": { vencimento, at } } (doc _ajustes).
  async function lerAjustesCaucao() {
    const linhas = await B.lerTudo(() => sb().from(M.caucao_base_ajustes.tabela).select("*").order("id", { ascending: true }));
    const out = {};
    linhas.forEach((l) => {
      const o = B.paraObjeto(M.caucao_base_ajustes, l);
      const id = o.id;
      delete o.id; delete o.titulo; delete o.parcela;
      out[id] = o;
    });
    return out;
  }

  // setDoc(_ajustes, patch, {merge: true}): upsert só das chaves enviadas. Chave sem "|" ou sem vencimento é ignorada.
  async function registrarAjustesCaucao(patch) {
    const p = patch || {};
    const linhas = Object.keys(p).map((k) => {
      const partes = M.partesAjuste(k);
      if (!partes || !p[k]) return null;
      const l = B.paraLinha(M.caucao_base_ajustes, Object.assign({}, p[k], partes), k);
      if (!l.ajustado_em) l.ajustado_em = new Date().toISOString();
      return M.faltando("caucao_base_ajustes", l).length ? null : l;
    }).filter(Boolean);
    if (!linhas.length) return 0;
    return gravarLinhas(M.caucao_base_ajustes.tabela, linhas);
  }

  // Trava da rotina das 06:30 (runningTransaction em _meta). Só service_role: no servidor, passar o cliente admin
  // em "cliente". Devolve { resultado: 'rodando' | 'feito' | 'ok', anterior }.
  async function travarCaucaoBatimento(hoje, opcoes, cliente) {
    const o = opcoes || {};
    const args = { p_hoje: hoje, p_forcar: !!o.forcar, p_simular: !!o.simular };
    if (o.trava) args.p_trava = o.trava; // intervalo do Postgres, ex.: "4 minutes"
    return checar(await (cliente || sb()).rpc("travar_caucao_batimento", args));
  }

  // ---------------------------------------------------------------------------------------------
  // ESTOQUE COMERCIAL: uma linha por unidade.
  function unidadeParaObjeto(l) {
    return B.paraObjeto(M.estoque_comercial, l);
  }

  // Unidades no formato units[] (camelCase). opcoes.enterpriseId: só um empreendimento;
  // opcoes.colunas: select reduzido (ex.: "id, enterprise_id, pmp3m, extra").
  async function listarUnidadesEstoque(opcoes) {
    const o = opcoes || {};
    const linhas = await B.lerTudo(() => {
      let q = sb().from(M.estoque_comercial.tabela).select(o.colunas || "*");
      if (o.enterpriseId != null) q = q.eq("enterprise_id", String(o.enterpriseId));
      return q.order("enterprise_id", { ascending: true }).order("id", { ascending: true });
    });
    return linhas.map(unidadeParaObjeto);
  }

  // Controle do estoque: o doc (dados) ou null.
  async function lerControleEstoque(id) {
    const l = checar(await sb().from(M.estoque_comercial_controle.tabela).select("dados").eq("id", String(id)).maybeSingle());
    return l ? (l.dados || {}) : null;
  }

  // Equivale a getDocs(collection("estoque_comercial")): um doc "cc_<cc>_0" por empreendimento
  // { enterpriseId, enterpriseName, chunk: 0, units, updatedAt (ISO), date } + os docs de controle.
  // Devolve um QuerySnapshot de imitação (forEach / docs[].id / data()). opcoes.semControle: só os cc_*.
  async function lerEstoqueDocs(opcoes) {
    const linhas = await B.lerTudo(() => sb().from(M.estoque_comercial.tabela).select("*")
      .order("enterprise_id", { ascending: true }).order("id", { ascending: true }));
    const porCc = new Map();
    linhas.forEach((l) => {
      const cc = String(l.enterprise_id);
      let d = porCc.get(cc);
      if (!d) { d = { enterpriseId: cc, enterpriseName: l.enterprise_name || "", chunk: 0, units: [], _linhas: [], date: null }; porCc.set(cc, d); }
      d.units.push(unidadeParaObjeto(l));
      d._linhas.push(l);
      if (l.date && (!d.date || l.date > d.date)) d.date = l.date;
    });
    const docs = [];
    porCc.forEach((d, cc) => {
      d.updatedAt = maxIso(d._linhas);
      delete d._linhas;
      docs.push(B.snapDoc("cc_" + cc + "_0", d));
    });
    if (!(opcoes && opcoes.semControle)) {
      const ctl = checar(await sb().from(M.estoque_comercial_controle.tabela).select("id, dados")) || [];
      ctl.forEach((l) => docs.push(B.snapDoc(l.id, l.dados || {})));
    }
    return B.snapLista(docs);
  }

  // Grava (substitui) as unidades de um empreendimento: as que não vieram são apagadas. Devolve quantas gravou.
  async function salvarEstoqueCc(enterpriseId, units) {
    const cc = String(enterpriseId);
    const lista = (Array.isArray(units) ? units : []).filter((u) => u && u.id !== undefined && u.id !== null && u.id !== "");
    const r = await sb().rpc("substituir_estoque_comercial_cc", { p_enterprise_id: cc, p_unidades: JSON.parse(JSON.stringify(lista)) });
    return checar(r);
  }

  // saveFirebase: grava todos os empreendimentos (agrupando por enterpriseId, "0" se faltar, como o app) e apaga os
  // empreendimentos que não estão mais na lista. Lista vazia não apaga nada (proteção). Devolve { ccs, unidades }.
  async function salvarEstoqueTudo(units) {
    const grupos = {};
    (Array.isArray(units) ? units : []).forEach((u) => {
      if (!u) return;
      const cc = String(u.enterpriseId || "0");
      (grupos[cc] = grupos[cc] || []).push(u);
    });
    const ccs = Object.keys(grupos);
    if (!ccs.length) return { ccs: 0, unidades: 0 };
    let n = 0;
    for (let i = 0; i < ccs.length; i += 5) { // 5 de cada vez (como o app fazia com os setDoc)
      const r = await Promise.all(ccs.slice(i, i + 5).map((cc) => salvarEstoqueCc(cc, grupos[cc])));
      r.forEach((x) => { n += Number(x) || 0; });
    }
    checar(await sb().from(M.estoque_comercial.tabela).delete()
      .not("enterprise_id", "in", "(" + ccs.map((x) => '"' + x.replace(/"/g, '""') + '"').join(",") + ")"));
    return { ccs: ccs.length, unidades: n };
  }

  // setDoc(_meta | _batimento_state | _conferencia_geral, patch, {merge}). opcoes.substituir = setDoc sem merge.
  // Atenção: o merge do banco é raso (dados || patch), igual ao que o app faz nesses docs (campos de 1º nível).
  async function mesclarControleEstoque(id, patch, opcoes) {
    const r = await sb().rpc("mesclar_estoque_comercial_controle", {
      p_id: String(id), p_patch: JSON.parse(JSON.stringify(patch || {})), p_substituir: !!(opcoes && opcoes.substituir),
    });
    return checar(r);
  }

  // ---------------------------------------------------------------------------------------------
  // COMERCIAL: batimento de vendas/distratos (lerBatimento de comercial.js). [{ year, month, vendas, distratos }]
  // em ordem de ano/mês; as linhas _meta/_state ficam de fora.
  async function lerComercialBatimento() {
    const linhas = await B.lerTudo(() => sb().from(M.comercial_batimento.tabela).select("id, ano, mes, vendas, distratos")
      .not("ano", "is", null).order("ano", { ascending: true }).order("mes", { ascending: true }));
    return linhas.map((l) => ({
      year: Number(l.ano), month: Number(l.mes),
      vendas: Array.isArray(l.vendas) ? l.vendas : [], distratos: Array.isArray(l.distratos) ? l.distratos : [],
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // ORÇAMENTO: forecast por empresa (doc "emp_<companyId>" { savedAt, atual, versoes }).
  async function lerForecast(companyId) {
    const l = checar(await sb().from(M.orcamento_forecast.tabela).select("*").eq("id", "emp_" + companyId).maybeSingle());
    if (!l) return null;
    const o = B.paraObjeto(M.orcamento_forecast, l);
    delete o.id;
    return o;
  }

  async function gravarForecast(companyId, dados) {
    const id = "emp_" + companyId;
    const l = M.aplicarPadroes("orcamento_forecast", B.paraLinha(M.orcamento_forecast, dados || {}, id));
    l.company_id = String(companyId);
    checar(await sb().from(M.orcamento_forecast.tabela).upsert(l, { onConflict: "id" }));
    return id;
  }

  window.DadosEngenharia = {
    pronto,
    tabela,
    // vistoria
    enviarVistoria: aposPronto(enviarVistoria),
    lerVistoriaBatimento: aposPronto(lerVistoriaBatimento),
    // engenharia
    lerAcompanhamento: aposPronto(lerAcompanhamento),
    salvarAcompanhamento: aposPronto(salvarAcompanhamento),
    // caução
    lerMetaCaucao: aposPronto(lerMetaCaucao),
    lerBaseCaucao: aposPronto(lerBaseCaucao),
    lerPassadoCaucao: aposPronto(lerPassadoCaucao),
    gravarPassadoCaucao: aposPronto(gravarPassadoCaucao),
    lerAjustesCaucao: aposPronto(lerAjustesCaucao),
    registrarAjustesCaucao: aposPronto(registrarAjustesCaucao),
    travarCaucaoBatimento: aposPronto(travarCaucaoBatimento),
    // estoque comercial
    listarUnidadesEstoque: aposPronto(listarUnidadesEstoque),
    lerEstoqueDocs: aposPronto(lerEstoqueDocs),
    lerControleEstoque: aposPronto(lerControleEstoque),
    salvarEstoqueCc: aposPronto(salvarEstoqueCc),
    salvarEstoqueTudo: aposPronto(salvarEstoqueTudo),
    mesclarControleEstoque: aposPronto(mesclarControleEstoque),
    // comercial
    lerComercialBatimento: aposPronto(lerComercialBatimento),
    // orçamento
    lerForecast: aposPronto(lerForecast),
    gravarForecast: aposPronto(gravarForecast),
    // conversões (sem rede)
    unidadeParaObjeto,
    linhaAcompanhamentoParaObjeto,
  };
  window.dispatchEvent(new Event("dados-engenharia-pronto"));
})();
