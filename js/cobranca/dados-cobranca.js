/* Acesso aos dados da área cobrança / clientes / relacionamento / jurídico no Supabase (substitui o Firebase).
   Depende de window.sb (supabase-client.js), window.DadosBase, window.DadosNucleo e window.MapasCobranca.
   Ordem no index.html: dados-base.js, mapas-nucleo.js, dados-nucleo.js, mapas-cobranca.js, dados-cobranca.js.

   1) Tabelas comuns (um doc do Firestore = uma linha): DadosCobranca.tabela("custas_judiciais").listar() / obter(id) /
      gravar(id, obj, {merge}) / criar(obj) / excluir(id) / ouvir(cb) — é o DadosNucleo.tabela com o mapa desta área.
   2) Formas que viraram várias linhas, devolvidas no mesmo formato que o app usa hoje:
      - ocorrências de cobrança e etapas judiciais (antes shards { <cliente>: [notas] }): listas por cliente;
      - cartas NEX (antes doc "<cliente>_<título>" com items[]): o doc é remontado a partir das cartas;
      - arquivo da tela Registro (antes "atual" + partes "atual_N" de um texto JSON): ficha + linhas;
      - catálogo de motivos do processo contra (antes doc "lista" com itens[]);
      - cache diário da carteira (sienge_defaulters_history): tipo/indice derivados do id e texto JSON -> jsonb.
   As gravações que precisam ser atômicas usam as RPCs da migration 202611191310_cobranca_juridico.sql. */
(function () {
  "use strict";
  const B = window.DadosBase;
  const M = window.MapasCobranca;

  function sb() {
    if (!window.sb) throw new Error("Supabase não inicializado.");
    return window.sb;
  }
  // supabase-client.js é módulo (carrega depois dos scripts comuns): toda função pública espera por ele.
  const pronto = window.sb ? Promise.resolve() : new Promise((ok) => window.addEventListener("supabase-pronto", ok, { once: true }));
  function aposPronto(fn) {
    return async function () { await pronto; return fn.apply(this, arguments); };
  }
  // Realtime só entrega linhas liberadas pela RLS se o token já estiver no canal.
  async function prepararRealtime() {
    await pronto;
    if (typeof window.sbToken === "function") await window.sbToken();
  }
  function checar(r) {
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Tabelas comuns: reaproveita o CRUD/listener do núcleo com o mapa desta área.
  function tabela(nome) {
    const mapa = M[nome];
    if (!mapa) throw new Error("Tabela sem mapa (cobrança): " + nome);
    return window.DadosNucleo.tabela(mapa);
  }

  function novoUuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return B.novoId();
  }

  // ---------------------------------------------------------------------------------------------
  // Ocorrências (customer_notes) e etapas judiciais (jud_notes): uma linha por nota.
  const NOTAS = {
    cob: { mapa: M.customer_notes, rpc: "salvar_notas_cliente", prefixo: "" },
    jud: { mapa: M.jud_notes, rpc: "salvar_notas_juridicas", prefixo: "jud_" },
  };

  const identidade = (n) => (typeof window.occurrenceIdentity === "function" ? window.occurrenceIdentity(n) : M.identidadeNota(n));

  function linhaParaNota(mapa, l) {
    const n = B.paraObjeto(mapa, l);
    return n;
  }

  async function lerNotas(tipo, customerId) {
    const cfg = NOTAS[tipo];
    const linhas = await B.lerTudo(() => sb().from(cfg.mapa.tabela).select("*")
      .eq("customer_id", String(customerId)).order("date", { ascending: true }).order("id", { ascending: true }));
    return linhas.map((l) => linhaParaNota(cfg.mapa, l));
  }

  // { <customerId>: [notas] } de todos os clientes (substitui o getDocs dos shards na carga inicial).
  async function lerTodasNotas(tipo) {
    const cfg = NOTAS[tipo];
    const linhas = await B.lerTudo(() => sb().from(cfg.mapa.tabela).select("*")
      .order("customer_id", { ascending: true }).order("date", { ascending: true }).order("id", { ascending: true }));
    const out = {};
    linhas.forEach((l) => { (out[l.customer_id] = out[l.customer_id] || []).push(linhaParaNota(cfg.mapa, l)); });
    return out;
  }

  // Grava as notas de um cliente. notas = lista no formato do app (camelCase).
  // opcoes.dropIdentities: como no saveNotesToFirebase (id, identidade ou date das notas apagadas);
  // opcoes.remover: ids a apagar. Notas sem id ganham um id aqui (o objeto do app é alterado), para não duplicar
  // na próxima gravação. Em conflito, o banco só troca se a versão enviada for igual ou mais nova (carimbo).
  // Devolve a lista completa do cliente depois de gravar.
  async function salvarNotas(tipo, customerId, notas, opcoes) {
    const cfg = NOTAS[tipo];
    const cid = String(customerId == null ? "" : customerId);
    if (!cid) throw new Error("customerId obrigatório para gravar notas.");
    const o = opcoes || {};
    const drop = new Set([].concat(o.dropIdentities || []).filter((x) => x != null && x !== "").map(String));
    const caiu = (n) => drop.size && (drop.has(identidade(n)) || drop.has(String((n && n.date) || "")) || drop.has(String((n && n.id) || "")));
    const remover = new Set([].concat(o.remover || []).filter(Boolean).map(String));
    if (drop.size) {
      // Os apagados podem ter sido identificados por identidade/data: achar os ids no banco.
      (await lerNotas(tipo, cid)).forEach((n) => { if (n.id && caiu(n)) remover.add(String(n.id)); });
    }
    const enviar = (Array.isArray(notas) ? notas : []).filter((n) => n && !caiu(n)).map((n) => {
      if (!n.id) n.id = cfg.prefixo + novoUuid();
      return B.paraLinha(cfg.mapa, n);
    });
    const r = await sb().rpc(cfg.rpc, { p_customer_id: cid, p_notas: enviar, p_remover: Array.from(remover) });
    return (checar(r) || []).map((l) => linhaParaNota(cfg.mapa, l));
  }

  // Tempo real das notas de um cliente (substitui o onSnapshot do shard). cb(listaCompleta). Devolve função para parar.
  function ouvirNotas(tipo, customerId, cb, aoErro) {
    const cfg = NOTAS[tipo];
    const cid = String(customerId);
    let vivo = true;
    let canal = null;
    let fila = Promise.resolve();
    const erro = (e) => {
      console.warn("[dados] " + cfg.mapa.tabela + ": " + (e && e.message));
      if (vivo && typeof aoErro === "function") { try { aoErro(e); } catch (x) {} }
    };
    const recarregar = () => {
      fila = fila.then(async () => {
        const lista = await lerNotas(tipo, cid);
        if (vivo) cb(lista);
      }).catch(erro);
      return fila;
    };
    prepararRealtime().then(() => {
      if (!vivo) return;
      canal = sb().channel(cfg.mapa.tabela + "-" + cid + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: cfg.mapa.tabela, filter: "customer_id=eq." + cid }, recarregar)
        .subscribe((estado, e) => {
          if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") erro(e || new Error("tempo real: " + estado));
        });
      return recarregar();
    }).catch(erro);
    return () => { vivo = false; try { if (canal) sb().removeChannel(canal); } catch (e) {} };
  }

  // ---------------------------------------------------------------------------------------------
  // NEX: o doc "<cliente>_<título>" { customerId, saleId, titulo, items, updatedAt } é remontado das cartas.
  const chaveNex = (customerId, titulo) => String(customerId || "") + "_" + String(titulo || "");

  function cartaParaItem(l) {
    const it = B.paraObjeto(M.nex_letters, l);
    return it;
  }

  function montarDocsNex(linhas) {
    const docs = new Map();
    linhas.forEach((l) => {
      let d = docs.get(l.doc_id);
      if (!d) {
        d = { id: l.doc_id, customerId: l.customer_id, saleId: l.sale_id, titulo: l.sale_id, items: [], updatedAt: 0 };
        docs.set(l.doc_id, d);
      }
      d.items.push(cartaParaItem(l));
      d.updatedAt = Math.max(d.updatedAt, Date.parse(l.atualizado_em) || 0);
    });
    return Array.from(docs.values());
  }

  const ordemCartas = (q) => q.order("doc_id", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true });

  // filtros.customerId: só as do cliente (where customerId ==); filtros.semHtml: não traz o html (pesado).
  async function listarNex(filtros) {
    const f = filtros || {};
    const linhas = await B.lerTudo(() => {
      let q = sb().from(M.nex_letters.tabela).select(f.semHtml ? "id, doc_id, item_id, customer_id, sale_id, titulo, customer_name, letter_type, unit_label, date, author, status, tracking, zero_paid, lost_pay_iso, delivered_at, ar_digital, created_at, extra, atualizado_em" : "*");
      if (f.customerId != null) q = q.eq("customer_id", String(f.customerId));
      return ordemCartas(q);
    }, 500);
    return montarDocsNex(linhas);
  }

  // Um doc pelo id "<cliente>_<título>" (getDoc). null se não houver cartas.
  async function lerNex(docId) {
    const linhas = await B.lerTudo(() => ordemCartas(sb().from(M.nex_letters.tabela).select("*").eq("doc_id", String(docId))), 500);
    const docs = montarDocsNex(linhas);
    return docs.length ? docs[0] : null;
  }

  // Substitui as cartas do "<cliente>_<título>" (saveNexHistory). Lista vazia apaga. Devolve os itens gravados.
  async function salvarNex(customerId, titulo, items) {
    const cid = String(customerId == null ? "" : customerId);
    const tit = String(titulo == null ? "" : titulo);
    const docId = chaveNex(cid, tit);
    const itens = (Array.isArray(items) ? items : []).filter((it) => it && it.id).map((it) => {
      const l = B.paraLinha(M.nex_letters, it);
      l.sale_id = tit;
      if (!l.titulo) l.titulo = tit;
      return l;
    });
    const r = await sb().rpc("salvar_nex_letters", { p_doc_id: docId, p_customer_id: cid, p_titulo: tit, p_itens: itens });
    return (checar(r) || []).map(cartaParaItem);
  }

  // ---------------------------------------------------------------------------------------------
  // Processo contra: catálogo de motivos [{ id, nome }] na ordem da tela.
  async function lerMotivosProcessoContra() {
    const r = await sb().from(M.processos_contra_motivos.tabela).select("id, nome, ordem")
      .order("ordem", { ascending: true }).order("nome", { ascending: true });
    return (checar(r) || []).map((l) => ({ id: l.id, nome: l.nome }));
  }

  async function salvarMotivosProcessoContra(itens) {
    const lista = (Array.isArray(itens) ? itens : []).map((m) => ({ id: String((m && m.id) || "").trim(), nome: String((m && m.nome) || "").trim() }))
      .filter((m) => m.id && m.nome);
    const r = await sb().rpc("salvar_processos_contra_motivos", { p_itens: lista });
    return (checar(r) || []).map((l) => ({ id: l.id, nome: l.nome }));
  }

  // ---------------------------------------------------------------------------------------------
  // Tela Registro: { arquivo, quando, por, unidades, linhas: [{ empresaId, empresa, obraId, obra, unidade, letra }] }.
  // opcoes.soFicha: não lê as linhas (para comparar "quando" antes de baixar o arquivo inteiro).
  async function lerRegistroCadastro(opcoes) {
    const r = await sb().from(M.registro_cadastro.tabela).select("*").eq("id", "atual").maybeSingle();
    const ficha = checar(r);
    if (!ficha) return null;
    const out = B.paraObjeto(M.registro_cadastro, ficha);
    delete out.id;
    if (opcoes && opcoes.soFicha) return out;
    const linhas = await B.lerTudo(() => sb().from(M.registro_cadastro_linhas.tabela)
      .select("ordem, empresa_id, empresa, obra_id, obra, unidade, letra, extra")
      .eq("registro_id", "atual").order("ordem", { ascending: true }));
    out.linhas = linhas.map((l) => {
      const o = B.paraObjeto(M.registro_cadastro_linhas, l);
      ["empresaId", "empresa", "obraId", "obra", "unidade", "letra"].forEach((k) => { if (o[k] === undefined) o[k] = ""; });
      return o;
    });
    return out;
  }

  // Troca o arquivo inteiro numa transação só. Devolve a quantidade de unidades gravadas.
  async function salvarRegistroCadastro(arquivo, quando, por, linhas) {
    const r = await sb().rpc("substituir_registro_cadastro", {
      p_arquivo: arquivo || null, p_quando: B.paraBanco(quando, "iso"), p_por: por || null, p_linhas: Array.isArray(linhas) ? linhas : [],
    });
    return checar(r);
  }

  // ---------------------------------------------------------------------------------------------
  // Cache diário da carteira (sienge_defaulters_history). Ids iguais aos do Firestore ("AAAA-MM-DD", "_chunk_N"...).
  const JSON_DIA = M.JSON_TEXTO.sienge_defaulters_history;

  function linhaCacheDia(id, dados) {
    const o = Object.assign({}, dados || {});
    JSON_DIA.forEach((k) => {
      if (typeof o[k] === "string") { try { o[k] = JSON.parse(o[k]); } catch (e) {} }
    });
    const t = M.tipoCacheDia(id, o);
    if (!t) throw new Error("sienge_defaulters_history: id fora do padrão: " + id);
    const l = B.paraLinha(M.sienge_defaulters_history, o, id);
    l.tipo = t.tipo;
    l.indice = t.indice;
    if (t.date && !l.date) l.date = t.date;
    return l;
  }

  // opcoes.comoTexto: devolve data/paidMap/paidInstallmentIds como texto JSON (como o Firestore), para trocar
  // a chamada sem mexer no JSON.parse de quem lê. null se não existir.
  async function lerCacheDia(id, opcoes) {
    const r = await sb().from(M.sienge_defaulters_history.tabela).select("*").eq("id", String(id)).maybeSingle();
    const l = checar(r);
    if (!l) return null;
    const o = B.paraObjeto(M.sienge_defaulters_history, l);
    delete o.id;
    if (opcoes && opcoes.comoTexto) JSON_DIA.forEach((k) => { if (o[k] !== undefined && typeof o[k] !== "string") o[k] = JSON.stringify(o[k]); });
    return o;
  }

  // Lê a ficha do dia e seus blocos ("<dia>_chunk_N") e devolve a lista concatenada (como o app monta).
  // prefixo: "chunk" (padrão) ou "pronta" (fila pronta: ficha "<dia>_pronta" + "<dia>_pronta_N").
  async function lerBlocosDia(dia, prefixo) {
    const tipoBloco = prefixo === "pronta" ? "pronta_bloco" : "bloco";
    const idFicha = prefixo === "pronta" ? dia + "_pronta" : dia;
    const ficha = await lerCacheDia(idFicha);
    if (!ficha) return null;
    const blocos = await B.lerTudo(() => sb().from(M.sienge_defaulters_history.tabela).select("indice, data")
      .eq("date", dia).eq("tipo", tipoBloco).lt("indice", Number(ficha.chunks) || 0).order("indice", { ascending: true }), 50);
    const lista = [];
    blocos.forEach((b) => { if (Array.isArray(b.data)) lista.push.apply(lista, b.data); });
    return { ficha, lista };
  }

  // setDoc / setDoc merge / updateDoc de um doc do cache.
  async function gravarCacheDia(id, dados, opcoes) {
    let final = dados || {};
    if (opcoes && opcoes.merge) {
      const atual = await lerCacheDia(id);
      if (atual) final = window.DadosNucleo.fundir(atual, final);
    }
    checar(await sb().from(M.sienge_defaulters_history.tabela).upsert(linhaCacheDia(id, final), { onConflict: "id" }));
    return id;
  }

  window.DadosCobranca = {
    pronto,
    tabela,
    // ocorrências de cobrança
    lerNotasCliente: aposPronto((customerId) => lerNotas("cob", customerId)),
    lerTodasNotasClientes: aposPronto(() => lerTodasNotas("cob")),
    salvarNotasCliente: aposPronto((customerId, notas, opcoes) => salvarNotas("cob", customerId, notas, opcoes)),
    ouvirNotasCliente: (customerId, cb, aoErro) => ouvirNotas("cob", customerId, cb, aoErro),
    // etapas judiciais
    lerNotasJuridicas: aposPronto((customerId) => lerNotas("jud", customerId)),
    lerTodasNotasJuridicas: aposPronto(() => lerTodasNotas("jud")),
    salvarNotasJuridicas: aposPronto((customerId, notas, opcoes) => salvarNotas("jud", customerId, notas, opcoes)),
    ouvirNotasJuridicas: (customerId, cb, aoErro) => ouvirNotas("jud", customerId, cb, aoErro),
    // NEX
    chaveNex,
    listarNex: aposPronto(listarNex),
    lerNex: aposPronto(lerNex),
    salvarNex: aposPronto(salvarNex),
    // processo contra
    lerMotivosProcessoContra: aposPronto(lerMotivosProcessoContra),
    salvarMotivosProcessoContra: aposPronto(salvarMotivosProcessoContra),
    // tela Registro
    lerRegistroCadastro: aposPronto(lerRegistroCadastro),
    salvarRegistroCadastro: aposPronto(salvarRegistroCadastro),
    // cache diário da carteira
    lerCacheDia: aposPronto(lerCacheDia),
    lerBlocosDia: aposPronto(lerBlocosDia),
    gravarCacheDia: aposPronto(gravarCacheDia),
    linhaCacheDia,
  };
  window.dispatchEvent(new Event("dados-cobranca-pronto"));
})();
