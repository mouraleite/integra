/* Acesso aos dados do núcleo no Supabase (substitui as chamadas diretas ao Firebase).
   Depende de window.sb (supabase-client.js), window.DadosBase e window.MapasNucleo.

   1) Configuração (config/*, settings/*): o app guarda a configuração como espelho do localStorage num
      "documento" config/global. Aqui o documento é montado e desmontado a partir das tabelas:
        - chaves comuns -> public.configuracoes (uma linha por chave);
        - listas/cadastros -> tabelas próprias (centros_custo, empresas, usuarios, perfis...).
      lerConfig(id) devolve algo com .exists()/.data() como o getDoc; gravarConfig(id, dados, {merge}) grava.
      Só as linhas que mudaram desde a última leitura são enviadas (as regras do banco barram quem não pode).
   2) Tabelas comuns: DadosNucleo.tabela("tags").listar() / obter(id) / gravar(id, obj, {merge}) / criar(obj) /
      excluir(id) / ouvir(cb). Os objetos voltam com os mesmos nomes de campo de antes (ver mapas-nucleo.js). */
(function () {
  "use strict";
  const B = window.DadosBase;
  const M = window.MapasNucleo;

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
  // Memória do que foi lido, para gravar só o que mudou.
  const lido = {};
  function marca(tabela, id, linha) {
    (lido[tabela] = lido[tabela] || {})[id] = JSON.stringify(linha);
  }
  function mudou(tabela, id, linha) {
    const t = lido[tabela];
    return !t || t[id] !== JSON.stringify(linha);
  }

  async function lerTabela(mapa, ordem) {
    const linhas = await B.lerTudo(() => {
      let q = sb().from(mapa.tabela).select("*");
      if (ordem) q = q.order(ordem, { ascending: true });
      return q;
    });
    const chave = mapa.chave || "id";
    linhas.forEach((l) => marca(mapa.tabela, String(l[chave]), soColunasDoMapa(mapa, l)));
    return linhas;
  }

  function soColunasDoMapa(mapa, linha) {
    // Compara só o que o front grava (sem criado_em/atualizado_em), na mesma forma do paraLinha.
    return B.paraLinha(mapa, B.paraObjeto(mapa, linha));
  }

  // Grava as linhas que mudaram. Devolve quantas foram enviadas. Falha de permissão vira aviso, não erro.
  async function gravarLinhas(mapa, linhas, conflito) {
    const chave = mapa.chave || "id";
    const novas = linhas.filter((l) => mudou(mapa.tabela, String(l[chave]), l));
    if (!novas.length) return 0;
    for (let i = 0; i < novas.length; i += 500) {
      const lote = novas.slice(i, i + 500);
      // defaultToNull: false — num lote com linhas de campos diferentes, coluna ausente fica com o default do
      // banco (ou o valor atual), em vez de virar null e esbarrar em coluna obrigatória.
      const r = await sb().from(mapa.tabela).upsert(lote, { onConflict: conflito || chave, defaultToNull: false });
      if (r.error) {
        console.warn("[dados] não gravou " + mapa.tabela + ": " + r.error.message);
        throw r.error;
      }
      lote.forEach((l) => marca(mapa.tabela, String(l[chave]), l));
    }
    return novas.length;
  }

  async function excluirLinhas(mapa, ids) {
    if (!ids.length) return;
    const chave = mapa.chave || "id";
    checar(await sb().from(mapa.tabela).delete().in(chave, ids.map(String)));
    ids.forEach((id) => { if (lido[mapa.tabela]) delete lido[mapa.tabela][String(id)]; });
  }

  // ---------------------------------------------------------------------------------------------
  // configuracoes: valor no banco é JSON; no front, a maioria das chaves é texto com JSON (espelho do localStorage).
  // Chaves que no Firebase já eram objeto/lista (não texto com JSON): voltam assim para o front.
  const CHAVES_OBJETO = new Set(["crm_plano_reembolsaveis", "removedEmails"]);

  function valorParaFront(chave, valor) {
    if (CHAVES_OBJETO.has(chave)) return valor;
    if (typeof valor === "string") return valor;
    return JSON.stringify(valor);
  }
  function valorParaBanco(valor) {
    if (typeof valor !== "string") return valor === undefined ? null : valor;
    const t = valor.trim();
    if (t && "[{\"".indexOf(t[0]) >= 0 || /^-?\d+(\.\d+)?$/.test(t) || t === "true" || t === "false" || t === "null") {
      try { return JSON.parse(t); } catch (e) {}
    }
    return valor;
  }

  async function lerConfiguracoes(prefixo) {
    const linhas = await B.lerTudo(() => {
      let q = sb().from("configuracoes").select("chave, valor, atualizado_em");
      q = prefixo ? q.like("chave", prefixo + "%") : q.not("chave", "like", "%/%");
      return q;
    });
    linhas.forEach((l) => marca("configuracoes", l.chave, { chave: l.chave, valor: l.valor }));
    return linhas;
  }

  async function gravarConfiguracoes(valores) {
    const mudadas = {};
    Object.keys(valores).forEach((k) => {
      const v = valores[k];
      if (mudou("configuracoes", k, { chave: k, valor: v })) mudadas[k] = v;
    });
    if (!Object.keys(mudadas).length) return 0;
    checar(await sb().rpc("gravar_configuracoes", { p_valores: mudadas }));
    Object.keys(mudadas).forEach((k) => marca("configuracoes", k, { chave: k, valor: mudadas[k] }));
    return Object.keys(mudadas).length;
  }

  async function lerConfiguracao(chave) {
    const r = checar(await sb().from("configuracoes").select("valor, atualizado_em").eq("chave", chave).maybeSingle());
    if (r) marca("configuracoes", chave, { chave, valor: r.valor });
    return r;
  }

  // Lê, transforma e grava uma chave sem perder gravação de outra pessoa (substitui runTransaction).
  // fn recebe o valor atual (já como o front espera) e devolve o novo; devolve o valor gravado.
  async function trocarConfiguracao(chave, fn, tentativas) {
    for (let i = 0; i < (tentativas || 6); i++) {
      const atual = await lerConfiguracao(chave);
      const valorFront = atual ? valorParaFront(chave, atual.valor) : undefined;
      const novo = await fn(valorFront);
      if (novo === undefined) return valorFront;
      const ok = checar(await sb().rpc("trocar_configuracao", {
        p_chave: chave, p_valor: valorParaBanco(novo), p_esperado: atual ? atual.atualizado_em : null,
      }));
      if (ok) {
        marca("configuracoes", chave, { chave, valor: valorParaBanco(novo) });
        return novo;
      }
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    }
    throw new Error("Não foi possível gravar " + chave + ": outra pessoa está alterando ao mesmo tempo.");
  }

  // Fusão profunda igual ao setDoc(..., {merge: true}) do Firestore.
  function fundir(base, novo) {
    if (!novo || typeof novo !== "object" || Array.isArray(novo)) return novo;
    const out = base && typeof base === "object" && !Array.isArray(base) ? Object.assign({}, base) : {};
    Object.keys(novo).forEach((k) => {
      const v = novo[k];
      // Mapa vazio zera o campo (no Firestore, merge com {} grava {}); mapa com chaves funde.
      const mapa = v && typeof v === "object" && !Array.isArray(v);
      out[k] = mapa && Object.keys(v).length ? fundir(out[k], v) : v;
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Listas/cadastros que viraram tabela: montar (tabela -> formato antigo) e desmontar (formato antigo -> linhas).
  function mapaPorId(mapa, linhas) {
    const out = {};
    linhas.forEach((l) => { const o = B.paraObjeto(mapa, l); out[String(o.id)] = o; delete o.id; });
    return out;
  }
  function maxMs(linhas, col) {
    return linhas.reduce((m, l) => Math.max(m, Date.parse(l[col || "atualizado_em"]) || 0), 0);
  }

  const especiais = {
    async crm_centros_custo_custom() {
      return JSON.stringify(mapaPorId(M.centros_custo, await lerTabela(M.centros_custo)));
    },
    async crm_empresas_custom() {
      // _v2: marca de formato que o empresas.js espera encontrar (não é empresa).
      return JSON.stringify(Object.assign({ _v2: true }, mapaPorId(M.empresas, await lerTabela(M.empresas))));
    },
    async crm_moura_condicoes_pagamento() {
      const linhas = await lerTabela(M.condicoes_pagamento);
      return JSON.stringify({ byId: mapaPorId(M.condicoes_pagamento, linhas), updatedAt: maxMs(linhas) });
    },
    async crm_cancelamento_motivos() {
      const linhas = await lerTabela(M.motivos_cancelamento, "ordem");
      const catalogo = linhas.map((l) => { const o = B.paraObjeto(M.motivos_cancelamento, l); delete o.id; delete o.ordem; return o; });
      const em = maxMs(linhas);
      return JSON.stringify({ catalogo, em: em ? new Date(em).toISOString() : "" }); // "em" era ISO no Firebase
    },
    async crm_moura_preambles_list() {
      const linhas = await lerTabela(M.preambulos);
      const lista = linhas.map((l) => B.paraObjeto(M.preambulos, l));
      lista.sort((a, b) => Number(a.id) - Number(b.id));
      return JSON.stringify(lista);
    },
    async crm_moura_cartorios_list() {
      const linhas = await lerTabela(M.cartorios, "ordem");
      return JSON.stringify(linhas.map((l) => { const o = B.paraObjeto(M.cartorios, l); delete o.id; delete o.ordem; return o; }));
    },
  };

  async function desmontarEspecial(chave, valorTexto) {
    let v = valorTexto;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return false; } }
    if (!v || typeof v !== "object") return false;
    switch (chave) {
      case "crm_centros_custo_custom":
        await gravarLinhas(M.centros_custo, Object.keys(v).map((id) => B.paraLinha(M.centros_custo, v[id], id)));
        return true;
      case "crm_empresas_custom":
        await gravarLinhas(M.empresas, Object.keys(v).filter((id) => id[0] !== "_" && v[id] && typeof v[id] === "object" && isFinite(parseInt(v[id].company_id, 10)))
          .map((id) => B.paraLinha(M.empresas, v[id], id)));
        return true;
      case "crm_moura_condicoes_pagamento": {
        const byId = v.byId || {};
        await gravarLinhas(M.condicoes_pagamento, Object.keys(byId).map((id) => B.paraLinha(M.condicoes_pagamento, byId[id], id)));
        return true;
      }
      case "crm_cancelamento_motivos": {
        const cat = Array.isArray(v.catalogo) ? v.catalogo : [];
        await gravarLinhas(M.motivos_cancelamento, cat.map((m, i) => B.paraLinha(M.motivos_cancelamento, Object.assign({}, m, { ordem: i }))));
        return true;
      }
      case "crm_moura_preambles_list":
        if (!Array.isArray(v)) return false;
        await gravarLinhas(M.preambulos, v.filter((p) => p && p.id !== undefined).map((p) => B.paraLinha(M.preambulos, p)));
        return true;
      case "crm_moura_cartorios_list":
        if (!Array.isArray(v)) return false;
        await gravarLinhas(M.cartorios, v.filter((c) => c && c.nome).map((c, i) => {
          const linha = B.paraLinha(M.cartorios, Object.assign({}, c, { ordem: i }));
          delete linha.id; // id é gerado no banco; o nome é único
          return linha;
        }), "nome");
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Usuários e perfis (tabelas da Fase 1) no formato antigo de config/crm_users e config/global.
  async function lerUsuariosLista() {
    const linhas = await lerTabela(M.usuarios);
    return linhas
      .filter((l) => !(l.extra && l.extra.removido))
      .map((l) => B.paraObjeto(M.usuarios, l))
      .sort((a, b) => (Number(a.id) || 1e12) - (Number(b.id) || 1e12));
  }

  async function gravarUsuariosLista(lista, removidos) {
    const fora = new Set((removidos || []).map((e) => String(e || "").toLowerCase()));
    const linhas = (Array.isArray(lista) ? lista : [])
      .filter((u) => u && u.email && u.id !== undefined && u.id !== null)
      .map((u) => {
        const l = B.paraLinha(M.usuarios, u);
        l.email = String(l.email).toLowerCase();
        if (l.login_email) l.login_email = String(l.login_email).toLowerCase();
        if (l.status) l.status = String(l.status).toUpperCase().indexOf("INATIVO") >= 0 ? "INATIVO" : "ATIVO";
        if (fora.has(l.email)) { l.status = "INATIVO"; l.extra = Object.assign({}, l.extra, { removido: true }); }
        return l;
      });
    await gravarLinhas(M.usuarios, linhas);
    if (fora.size) {
      // Removidos que não vieram na lista: marcar como removidos (não apaga; outras tabelas apontam para o usuário).
      const r = await sb().from("usuarios").select("id_legado, email, extra").in("email", Array.from(fora));
      const marcar = (checar(r) || []).filter((u) => !(u.extra && u.extra.removido));
      for (const u of marcar) {
        checar(await sb().from("usuarios").update({ status: "INATIVO", extra: Object.assign({}, u.extra, { removido: true }) }).eq("id_legado", u.id_legado));
      }
    }
  }

  async function lerPerfis() {
    const linhas = await lerTabela(M.perfis);
    return linhas.filter((l) => l.id_legado).map((l) => B.paraObjeto(M.perfis, l));
  }

  async function gravarPerfis(lista) {
    const linhas = (Array.isArray(lista) ? lista : []).filter((p) => p && p.id && p.name).map((p) => {
      const l = B.paraLinha(M.perfis, p);
      l.nome = String(l.nome).trim().toUpperCase();
      if (l.permissoes === null || l.permissoes === undefined) delete l.permissoes;
      if (typeof l.permissoes === "string") { try { l.permissoes = JSON.parse(l.permissoes); } catch (e) { delete l.permissoes; } }
      return l;
    });
    await gravarLinhas(M.perfis, linhas);
  }

  async function gravarPermissoes(idPerfil, perms) {
    let p = perms;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { return; } }
    if (!p || typeof p !== "object") return;
    const marcaChave = "perms:" + idPerfil;
    if (!mudou("perfis_perms", marcaChave, p)) return;
    checar(await sb().from("perfis").update({ permissoes: p }).eq("id_legado", idPerfil));
    marca("perfis_perms", marcaChave, p);
  }

  // ---------------------------------------------------------------------------------------------
  // Documentos de config/* montados a partir das tabelas.
  async function montarGlobal() {
    const out = {};
    (await lerConfiguracoes()).forEach((l) => { out[l.chave] = valorParaFront(l.chave, l.valor); });
    const chaves = Object.keys(especiais);
    const valores = await Promise.all(chaves.map((k) => especiais[k]()));
    chaves.forEach((k, i) => { out[k] = valores[i]; });
    out.crm_users = JSON.stringify(await lerUsuariosLista());
    const perfis = await lerPerfis();
    out.crm_moura_profiles = JSON.stringify(perfis);
    perfis.forEach((p) => {
      out["crm_perms_" + p.id] = JSON.stringify(p.perms || {});
      marca("perfis_perms", "perms:" + p.id, p.perms || {});
    });
    return out;
  }

  async function gravarGlobal(dados) {
    const comuns = {};
    const erros = [];
    const tentar = async (fn) => { try { await fn(); } catch (e) { erros.push(e); } };
    for (const k of Object.keys(dados || {})) {
      const v = dados[k];
      if (v === undefined) continue;
      if (k === "crm_users") { await tentar(() => gravarUsuariosLista(typeof v === "string" ? JSON.parse(v) : v, dados.removedEmails)); continue; }
      if (k === "crm_moura_profiles") { await tentar(() => gravarPerfis(typeof v === "string" ? JSON.parse(v) : v)); continue; }
      if (k.indexOf("crm_perms_bak_") === 0) continue;
      if (k.indexOf("crm_perms_") === 0) { await tentar(() => gravarPermissoes(k.slice("crm_perms_".length), v)); continue; }
      if (especiais[k]) { let feito = false; await tentar(async () => { feito = await desmontarEspecial(k, v); }); if (feito) continue; }
      comuns[k] = valorParaBanco(v);
    }
    await tentar(() => gravarConfiguracoes(comuns));
    if (erros.length) {
      const e = new Error("Parte da configuração não foi gravada: " + erros.map((x) => x.message).join("; "));
      e.parcial = true;
      e.erros = erros;
      throw e;
    }
  }

  const docsConfig = {
    async global() { return montarGlobal(); },
    async crm_users() {
      const removidos = await lerConfiguracao("removedEmails");
      return {
        list: JSON.stringify(await lerUsuariosLista()),
        removedEmails: removidos && Array.isArray(removidos.valor) ? removidos.valor : [],
      };
    },
    async centros_custo() {
      const byId = mapaPorId(M.centros_custo, await lerTabela(M.centros_custo));
      return { byId, crm_centros_custo_custom: JSON.stringify(byId) };
    },
    async condicoes_pagamento() { return JSON.parse(await especiais.crm_moura_condicoes_pagamento()); },
    async central_email() {
      const linhas = await lerTabela(M.central_email_templates, "criado_em");
      return { templates: linhas.map((l) => B.paraObjeto(M.central_email_templates, l)) };
    },
    async obra_vgv() {
      const linhas = await lerTabela(M.obra_vgv);
      const obras = {};
      linhas.forEach((l) => { const o = B.paraObjeto(M.obra_vgv, l); if (o.lancamento === undefined) o.lancamento = ""; obras[o.id] = o; });
      return { obras, atualizadoEm: maxMs(linhas) };
    },
    async partner_parametrizations() {
      const linhas = await lerTabela(M.parcerias, "ordem");
      const lista = linhas.map((l) => { const o = B.paraObjeto(M.parcerias, l); delete o.ordem; return o; });
      return { list: JSON.stringify(lista), updatedAt: maxMs(linhas) };
    },
    async fluxos_processo() {
      const linhas = await lerTabela(M.fluxos_processo, "criado_em");
      const meta = await lerConfiguracao("config/fluxos_processo");
      return Object.assign({}, meta ? meta.valor : {}, { fluxos: linhas.map((l) => B.paraObjeto(M.fluxos_processo, l)) });
    },
  };

  const gravacoesConfig = {
    async global(dados) { await gravarGlobal(dados); },
    async crm_users(dados) {
      let lista = dados.list !== undefined ? dados.list : dados.crm_users;
      if (typeof lista === "string") lista = JSON.parse(lista);
      if (Array.isArray(dados.removedEmails)) await gravarConfiguracoes({ removedEmails: dados.removedEmails });
      if (lista) await gravarUsuariosLista(lista, dados.removedEmails);
    },
    async centros_custo(dados) {
      const byId = dados.byId || (dados.crm_centros_custo_custom ? JSON.parse(dados.crm_centros_custo_custom) : {});
      await gravarLinhas(M.centros_custo, Object.keys(byId).map((id) => B.paraLinha(M.centros_custo, byId[id], id)));
    },
    async condicoes_pagamento(dados) {
      await desmontarEspecial("crm_moura_condicoes_pagamento", { byId: dados.byId || {} });
    },
    async central_email(dados) {
      const lista = Array.isArray(dados.templates) ? dados.templates : [];
      const ids = new Set(lista.map((t) => String(t.id)));
      const antes = Object.keys(lido.central_email_templates || {});
      await gravarLinhas(M.central_email_templates, lista.map((t) => B.paraLinha(M.central_email_templates, t)));
      await excluirLinhas(M.central_email_templates, antes.filter((id) => !ids.has(id)));
    },
    async obra_vgv(dados) {
      const obras = dados.obras || {};
      await gravarLinhas(M.obra_vgv, Object.keys(obras).map((id) => B.paraLinha(M.obra_vgv, obras[id], id)));
    },
    async partner_parametrizations(dados) {
      let lista = dados.list;
      if (typeof lista === "string") lista = JSON.parse(lista);
      if (!Array.isArray(lista)) return;
      const ids = new Set(lista.map((p) => String(p.id)));
      const antes = Object.keys(lido.parcerias || {});
      await gravarLinhas(M.parcerias, lista.map((p, i) => B.paraLinha(M.parcerias, Object.assign({}, p, { ordem: i }))));
      await excluirLinhas(M.parcerias, antes.filter((id) => !ids.has(id)));
    },
    async fluxos_processo(dados) {
      const fluxos = Array.isArray(dados.fluxos) ? dados.fluxos : [];
      await gravarLinhas(M.fluxos_processo, fluxos.map((f) => B.paraLinha(M.fluxos_processo, f)));
      const excluidos = Array.isArray(dados.excluidos) ? dados.excluidos.map(String) : [];
      await excluirLinhas(M.fluxos_processo, excluidos.filter((id) => (lido.fluxos_processo || {})[id] !== undefined));
      const meta = {};
      ["excluidos", "seq", "updatedAt"].forEach((k) => { if (dados[k] !== undefined) meta[k] = dados[k]; });
      if (Object.keys(meta).length) await trocarConfiguracao("config/fluxos_processo", (atual) => Object.assign({}, atual ? JSON.parse(atual) : {}, meta));
    },
  };

  // Caminho "config/<id>" ou "settings/<id>" para os documentos genéricos (guardados inteiros em configuracoes).
  function chaveDoc(colecao, id) { return colecao + "/" + id; }

  async function lerDocGenerico(colecao, id) {
    const r = await lerConfiguracao(chaveDoc(colecao, id));
    return r ? r.valor : null;
  }

  async function gravarDocGenerico(colecao, id, dados, opcoes) {
    const chave = chaveDoc(colecao, id);
    if (opcoes && opcoes.merge) {
      await trocarConfiguracao(chave, (atual) => fundir(atual ? JSON.parse(atual) : {}, dados));
    } else {
      checar(await sb().rpc("gravar_configuracoes", { p_valores: { [chave]: dados } }));
      marca("configuracoes", chave, { chave, valor: dados });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // API de configuração
  const cacheGlobal = { at: 0, p: null };

  // opcoes.fresco: ignora a leitura guardada de config/global (usar antes de ler-alterar-gravar).
  async function lerConfig(id, colecao, opcoes) {
    const col = colecao || "config";
    let dados;
    if (col === "config" && id === "global") {
      const agora = Date.now();
      if (!cacheGlobal.p || agora - cacheGlobal.at > 5000 || (opcoes && opcoes.fresco)) {
        cacheGlobal.at = agora;
        cacheGlobal.p = docsConfig.global().catch((e) => { cacheGlobal.p = null; throw e; });
      }
      dados = await cacheGlobal.p;
    } else if (col === "config" && docsConfig[id]) {
      dados = await docsConfig[id]();
    } else {
      dados = await lerDocGenerico(col, id);
    }
    return B.snapDoc(id, dados);
  }

  async function gravarConfig(id, dados, opcoes, colecao) {
    const col = colecao || "config";
    if (col === "config" && id === "global") cacheGlobal.p = null;
    if (col === "config" && gravacoesConfig[id]) return gravacoesConfig[id](dados || {}, opcoes || {});
    return gravarDocGenerico(col, id, dados || {}, opcoes || {});
  }

  // Equivale a getDocs(collection("config")): todos os documentos de config.
  async function listarConfig() {
    const ids = Object.keys(docsConfig);
    const genericos = (await lerConfiguracoes("config/")).filter((l) => l.chave.split("/").length === 2);
    const docs = await Promise.all(ids.map(async (id) => B.snapDoc(id, await docsConfig[id]())));
    genericos.forEach((l) => {
      const id = l.chave.slice("config/".length);
      if (ids.indexOf(id) < 0) docs.push(B.snapDoc(id, l.valor));
    });
    return B.snapLista(docs);
  }

  // Escuta mudanças em chaves de configuracoes. cb(chave, valorDoFront). Devolve função para parar.
  function ouvirConfiguracao(chaves, cb) {
    const alvo = new Set([].concat(chaves));
    let canal = null;
    let vivo = true;
    prepararRealtime().then(() => {
      if (!vivo) return;
      canal = sb().channel("configuracoes-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: "configuracoes" }, (p) => {
          const linha = p.new && p.new.chave ? p.new : p.old;
          if (!linha || !alvo.has(linha.chave)) return;
          cacheGlobal.p = null;
          cb(linha.chave, p.eventType === "DELETE" ? undefined : valorParaFront(linha.chave, p.new.valor));
        })
        .subscribe();
    }).catch((e) => console.warn("[dados] configuracoes realtime: " + e.message));
    return () => { vivo = false; try { if (canal) sb().removeChannel(canal); } catch (e) {} };
  }

  // ---------------------------------------------------------------------------------------------
  // Tabelas comuns
  function tabela(nomeOuMapa) {
    const mapa = typeof nomeOuMapa === "string" ? M[nomeOuMapa] : nomeOuMapa;
    if (!mapa) throw new Error("Tabela sem mapa: " + nomeOuMapa);
    const chave = mapa.chave || "id";
    const obj = (l) => B.paraObjeto(mapa, l);

    // filtros: [["coluna", "eq", valor], ...]; ordem: ["coluna", "desc"]; limite: n
    async function listar(opcoes) {
      const o = opcoes || {};
      const montar = () => {
        let q = sb().from(mapa.tabela).select(o.colunas || "*");
        (o.filtros || []).forEach((f) => { q = q.filter(f[0], f[1], f[2]); });
        if (o.ordem) q = q.order(o.ordem[0], { ascending: o.ordem[1] !== "desc" });
        return q;
      };
      if (o.limite) {
        const r = await montar().limit(o.limite);
        return (checar(r) || []).map(obj);
      }
      return (await B.lerTudo(montar)).map(obj);
    }

    async function obter(id) {
      const r = await sb().from(mapa.tabela).select("*").eq(chave, String(id)).maybeSingle();
      return obj(checar(r));
    }

    async function gravar(id, dados, opcoes) {
      let final = dados || {};
      if (opcoes && opcoes.merge) {
        const atual = await obter(id);
        if (atual) { delete atual.id; final = fundir(atual, final); }
      }
      const linha = B.paraLinha(mapa, final, id);
      checar(await sb().from(mapa.tabela).upsert(linha, { onConflict: chave }));
      return id;
    }

    async function criar(dados) {
      const id = B.novoId();
      await gravar(id, dados);
      return id;
    }

    async function excluir(id) {
      checar(await sb().from(mapa.tabela).delete().eq(chave, String(id)));
    }

    // cb({ docs: [objetos], mudancas: [{tipo: "added"|"modified"|"removed", doc}] }). Devolve função para parar.
    // opcoes.aoErro(e): chamado se a leitura falhar ou o canal em tempo real cair (como o 2º argumento do onSnapshot).
    function ouvir(cb, opcoes) {
      let vivo = true;
      let canal = null;
      let atual = new Map();
      let fila = Promise.resolve();
      const aoErro = (e) => {
        console.warn("[dados] " + mapa.tabela + ": " + (e && e.message));
        if (vivo && opcoes && typeof opcoes.aoErro === "function") { try { opcoes.aoErro(e); } catch (x) {} }
      };
      const carregar = (mudancas) => {
        fila = fila.then(async () => {
          const lista = await listar(opcoes);
          if (!vivo) return;
          atual = new Map(lista.map((d) => [String(d.id), d]));
          cb({ docs: lista, mudancas: mudancas || lista.map((d) => ({ tipo: "added", doc: d })) });
        }).catch(aoErro);
        return fila;
      };
      prepararRealtime().then(() => {
        if (!vivo) return;
        canal = sb().channel(mapa.tabela + "-" + Math.random().toString(36).slice(2))
          .on("postgres_changes", { event: "*", schema: "public", table: mapa.tabela }, (p) => {
            const tipo = p.eventType === "INSERT" ? "added" : p.eventType === "DELETE" ? "removed" : "modified";
            const linha = tipo === "removed" ? p.old : p.new;
            const doc = linha && Object.keys(linha).length > 1 ? obj(linha) : atual.get(String(linha && linha[chave]));
            carregar(doc ? [{ tipo, doc }] : []);
          })
          .subscribe((estado, erro) => {
            if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") aoErro(erro || new Error("tempo real: " + estado));
          });
        return carregar();
      }).catch(aoErro);
      return () => { vivo = false; try { if (canal) sb().removeChannel(canal); } catch (e) {} };
    }

    return {
      mapa, ouvir,
      listar: aposPronto(listar), obter: aposPronto(obter), gravar: aposPronto(gravar),
      criar: aposPronto(criar), excluir: aposPronto(excluir),
      paraLinha: (o, id) => B.paraLinha(mapa, o, id), paraObjeto: obj,
    };
  }

  window.DadosNucleo = {
    pronto,
    lerConfig: aposPronto(lerConfig),
    gravarConfig: aposPronto(gravarConfig),
    listarConfig: aposPronto(listarConfig),
    ouvirConfiguracao,
    trocarConfiguracao: aposPronto(trocarConfiguracao),
    lerConfiguracao: aposPronto(async (chave) => { const r = await lerConfiguracao(chave); return r ? valorParaFront(chave, r.valor) : undefined; }),
    gravarConfiguracoes: aposPronto((valores) => gravarConfiguracoes(Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, valorParaBanco(v)])))),
    mesclarConfiguracao: aposPronto(async (chave, parcial) => checar(await sb().rpc("mesclar_configuracao", { p_chave: chave, p_parcial: parcial }))),
    lerSetting: aposPronto((id) => lerConfig(id, "settings")),
    gravarSetting: aposPronto((id, dados, opcoes) => gravarConfig(id, dados, opcoes, "settings")),
    incrementarApiConsumo: aposPronto(async (dia, delta) => checar(await sb().rpc("incrementar_api_consumo", { p_data: dia, p_delta: delta }))),
    tabela, fundir,
  };
  window.dispatchEvent(new Event("dados-nucleo-pronto"));
})();
