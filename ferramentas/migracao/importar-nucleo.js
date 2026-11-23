// Fase 4 (área núcleo): leva o export do Firestore para as tabelas do núcleo no Supabase.
// Usa os mesmos mapas do front (js/nucleo/mapas-nucleo.js + dados-base.js), então o que entra é o que a tela lê.
// Regras de cada coleção: docs/mapa-tabelas/nucleo.md.
//
// Uso:
//   node ferramentas/migracao/importar-nucleo.js --export <pasta> --seco        só monta e confere, não grava
//   node ferramentas/migracao/importar-nucleo.js --export <pasta>              grava (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
//   ... --so tags,configuracoes                                                 só algumas tabelas
// Pode rodar de novo: tudo é upsert pela chave. Não apaga nada.
const fs = require("fs");
const path = require("path");
const B = require("../../js/nucleo/dados-base.js");
const M = require("../../js/nucleo/mapas-nucleo.js");

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

// Timestamps do export ({__tipo:"timestamp", iso}) viram epoch ms, como o front grava hoje.
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

function json(v, padrao) {
  if (typeof v !== "string") return v === undefined ? padrao : v;
  try { return JSON.parse(v); } catch (e) { return padrao === undefined ? v : padrao; }
}

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function lerColecao(pasta, nome) {
  const f = path.join(pasta, nome + ".ndjson");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => {
    const d = JSON.parse(l);
    return { id: d.id, data: normal(d.data || {}) };
  });
}

// Tabela -> { linhas, conflito, avisos }
function montar(pasta, usuariosBanco) {
  const saida = {};
  const avisos = [];
  const add = (tabela, linhas, conflito) => {
    const t = (saida[tabela] = saida[tabela] || { linhas: [], conflito });
    t.linhas.push.apply(t.linhas, linhas);
  };
  const config = lerColecao(pasta, "config");
  const doc = (id) => (config.find((d) => d.id === id) || {}).data;
  const g = doc("global") || {};

  // ---- configuracoes: chaves de config/global que não viraram tabela
  const VIRAM_TABELA = new Set(["crm_users", "removedEmails", "crm_moura_profiles", "crm_centros_custo_custom",
    "crm_empresas_custom", "crm_moura_condicoes_pagamento", "crm_cancelamento_motivos", "crm_moura_preambles_list",
    "crm_moura_cartorios_list"]);
  const conf = [];
  Object.keys(g).forEach((k) => {
    if (VIRAM_TABELA.has(k) || k.indexOf("crm_perms_") === 0) return;
    conf.push({ chave: k, valor: json(g[k]) });
  });
  const crmUsers = doc("crm_users") || {};
  conf.push({ chave: "removedEmails", valor: crmUsers.removedEmails || json(g.removedEmails, []) || [] });

  // Demais documentos de config/* inteiros (os que viraram tabela ficam de fora)
  const DOCS_TABELA = new Set(["global", "crm_users", "centros_custo", "condicoes_pagamento", "central_email",
    "obra_vgv", "partner_parametrizations", "fluxos_processo"]);
  config.forEach((d) => { if (!DOCS_TABELA.has(d.id)) conf.push({ chave: "config/" + d.id, valor: d.data }); });
  const fluxosDoc = doc("fluxos_processo") || {};
  conf.push({ chave: "config/fluxos_processo", valor: { excluidos: fluxosDoc.excluidos || [], seq: fluxosDoc.seq || 0, updatedAt: fluxosDoc.updatedAt || null } });
  lerColecao(pasta, "settings").forEach((d) => conf.push({ chave: "settings/" + d.id, valor: d.data }));
  lerColecao(pasta, "config_stages").forEach((d) => conf.push({ chave: "config_stages/" + d.id, valor: d.data }));
  // Coleções pequenas guardadas inteiras (cartão Clara). O cache compras_dashboard_cache não é importado: o painel refaz.
  lerColecao(pasta, "cartao_clara").forEach((d) => conf.push({ chave: "cartao_clara/" + d.id, valor: d.data }));
  add("configuracoes", conf.map((c) => ({ chave: c.chave, valor: c.valor === undefined ? null : c.valor })), "chave");

  // ---- perfis (permissões) e usuários completos
  const perfisLista = json(g.crm_moura_profiles, []) || [];
  add("perfis", perfisLista.filter((p) => p && p.name).map((p) => {
    const perms = json(p.perms, null) || json(g["crm_perms_" + p.id], {}) || {};
    return { nome: String(p.name).trim().toUpperCase(), id_legado: p.id, permissoes: perms };
  }), "nome");
  const usuarios = json(crmUsers.list, null) || json(g.crm_users, []) || [];
  // Perfil usado por usuário mas ausente da lista de perfis (a FK exige a linha): usa as permissões gravadas em
  // crm_perms_<nome em minúsculas com _>, como o app faz ao resolver o perfil; sem elas, cria sem permissões.
  const nomesPerfis = new Set(saida.perfis.linhas.map((p) => p.nome));
  usuarios.forEach((u) => {
    const nome = String((u && u.profile_name) || "SEM PERFIL").trim().toUpperCase();
    if (!nomesPerfis.has(nome)) {
      nomesPerfis.add(nome);
      const idProvavel = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "_");
      const perms = json(g["crm_perms_" + idProvavel], null);
      saida.perfis.linhas.push({ nome, id_legado: perms ? idProvavel : null, permissoes: perms || {} });
      avisos.push("perfis: '" + nome + "' usado por usuário e ausente da lista de perfis (" +
        (perms ? "permissões de crm_perms_" + idProvavel : "criado sem permissões") + ")");
    }
  });
  const removidos = new Set((conf.find((c) => c.chave === "removedEmails").valor || []).map((e) => String(e).toLowerCase()));
  add("usuarios", usuarios.filter((u) => u && u.email).map((u) => {
    const l = B.paraLinha(M.usuarios, u);
    l.email = l.email.toLowerCase();
    if (l.login_email) l.login_email = l.login_email.toLowerCase();
    l.perfil = String(l.perfil || "SEM PERFIL").trim().toUpperCase();
    l.status = String(l.status || "ATIVO").toUpperCase().indexOf("INATIVO") >= 0 ? "INATIVO" : "ATIVO";
    if (removidos.has(l.email)) { l.status = "INATIVO"; l.extra.removido = true; }
    return l;
  }), "id_legado");

  // ---- cadastros que saíram de config
  const maisNovo = (a, b, campo) => ((Number(b && b[campo]) || 0) > (Number(a && a[campo]) || 0) ? b : a);
  const cc = Object.assign({}, (doc("centros_custo") || {}).byId || {});
  const ccGlobal = json(g.crm_centros_custo_custom, {}) || {};
  Object.keys(ccGlobal).forEach((id) => {
    const a = cc[id], b = ccGlobal[id];
    const venc = Object.assign({}, maisNovo(a, b, "updatedAt") || b);
    const conta = maisNovo(a, b, "conta_parceria_at");
    if (conta && conta.conta_parceria) { venc.conta_parceria = conta.conta_parceria; venc.conta_parceria_at = conta.conta_parceria_at; }
    cc[id] = venc;
  });
  add("centros_custo", Object.keys(cc).map((id) => B.paraLinha(M.centros_custo, cc[id], id)));

  const emp = json(g.crm_empresas_custom, {}) || {};
  add("empresas", Object.keys(emp).filter((id) => id[0] !== "_" && emp[id] && typeof emp[id] === "object" && isFinite(parseInt(emp[id].company_id, 10)))
    .map((id) => B.paraLinha(M.empresas, emp[id], id)));

  const cond = Object.assign({}, ((doc("condicoes_pagamento") || {}).byId) || {});
  const condG = (json(g.crm_moura_condicoes_pagamento, {}) || {}).byId || {};
  Object.keys(condG).forEach((id) => { cond[id] = maisNovo(cond[id], condG[id], "updatedAt") || condG[id]; });
  add("condicoes_pagamento", Object.keys(cond).map((id) => B.paraLinha(M.condicoes_pagamento, cond[id], id)));

  const motivos = (json(g.crm_cancelamento_motivos, {}) || {}).catalogo || [];
  add("motivos_cancelamento", motivos.map((m, i) => B.paraLinha(M.motivos_cancelamento, Object.assign({}, m, { ordem: i }))));

  add("preambulos", (json(g.crm_moura_preambles_list, []) || []).filter((p) => p && p.id !== undefined)
    .map((p) => B.paraLinha(M.preambulos, p)));

  add("cartorios", (json(g.crm_moura_cartorios_list, []) || []).filter((c) => c && c.nome).map((c, i) => {
    const l = B.paraLinha(M.cartorios, Object.assign({}, c, { ordem: i }));
    delete l.id;
    return l;
  }), "nome");

  add("central_email_templates", ((doc("central_email") || {}).templates || []).map((t) => B.paraLinha(M.central_email_templates, t)));
  const obras = (doc("obra_vgv") || {}).obras || {};
  add("obra_vgv", Object.keys(obras).map((id) => B.paraLinha(M.obra_vgv, obras[id], id)));
  add("parcerias", (json((doc("partner_parametrizations") || {}).list, []) || [])
    .map((p, i) => B.paraLinha(M.parcerias, Object.assign({}, p, { ordem: i }))));
  add("fluxos_processo", (fluxosDoc.fluxos || []).map((f) => B.paraLinha(M.fluxos_processo, f)));

  // ---- coleções com um doc por linha
  ["tags", "anexos_tag_memory", "auditoria_logs", "auditoria_login_relatorios", "usuarios_online",
    "suporte_chamados", "documentos_autenticados", "central_email_envios"].forEach((c) => {
    add(c, lerColecao(pasta, c).map((d) => B.paraLinha(M[c], d.data, d.id)));
  });
  add("sienge_sync_state", lerColecao(pasta, "sienge_sync_state").map((d) => B.paraLinha(M.sienge_sync_state, d.data, d.id)));

  // api_consumo: campos com ponto no nome viram objeto (mesma regra de ApiUsage.nestDottedFields)
  add("api_consumo", lerColecao(pasta, "api_consumo").map((d) => {
    const o = {};
    Object.keys(d.data).forEach((k) => {
      const partes = k.split(".");
      let cur = o;
      for (let i = 0; i < partes.length - 1; i++) {
        if (!cur[partes[i]] || typeof cur[partes[i]] !== "object") cur[partes[i]] = {};
        cur = cur[partes[i]];
      }
      cur[partes[partes.length - 1]] = d.data[k];
    });
    if (!o.date) o.date = d.id;
    return B.paraLinha(M.api_consumo, o, d.id);
  }));

  // auditoria_login_partes -> uma linha por acesso
  const linhasLogin = [];
  lerColecao(pasta, "auditoria_login_partes").forEach((d) => {
    const tuplas = json(d.data.linhas, []) || [];
    const n = Number(d.data.n) || 0;
    const hora = (s) => (s ? new Date(String(s).replace(" ", "T") + ":00-03:00").toISOString() : null);
    tuplas.forEach((t, i) => linhasLogin.push({
      relatorio_id: d.data.relatorioId, ordem: n * 2500 + i, usuario: t[0], ip: t[1], sucesso: !!t[2],
      entrada: hora(t[3]), saida: hora(t[4]), modo: t[5] || null, motivo: t[6] || null,
    }));
  });
  add("auditoria_login_linhas", linhasLogin, "relatorio_id,ordem");

  // anexos_mapa: doc por empreendimento -> uma linha por envio
  add("anexos_mapa", [].concat.apply([], lerColecao(pasta, "anexos_mapa").map((d) => {
    const byKey = d.data.byKey || {};
    return Object.keys(byKey).map((k) => {
      const item = Object.assign({}, byKey[k], { enterpriseId: d.id, chave: k });
      delete item.key;
      return B.paraLinha(M.anexos_mapa, item, d.id + "_" + k);
    });
  })), "enterprise_id,chave");

  // ambientes_dev e alertas_ciente: mapas -> linhas
  add("ambientes_dev", [].concat.apply([], lerColecao(pasta, "ambientes_dev").map((d) =>
    Object.keys(d.data.ambientes || {}).map((amb) => ({
      email: String(d.data.email || d.id).toLowerCase(), ambiente: amb,
      acessado_em: B.paraBanco(d.data.ambientes[amb], "ms"),
    })))), "email,ambiente");
  add("alertas_ciente", [].concat.apply([], lerColecao(pasta, "alertas_ciente").map((d) =>
    Object.keys(d.data).map((k) => {
      const m = k.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
      return m ? { alerta: d.id, tipo: m[1], dia: m[2], usuario_email: "israel@mouraleite.com.br" } : null;
    }).filter(Boolean))), "alerta,tipo,dia");

  // agenda: dono = prefixo do id; usuario_id pelo nome do Sienge ou nome do cadastro
  const porNome = {};
  (usuariosBanco || []).forEach((u) => {
    [u.sienge_user, u.nome].forEach((n) => { if (n) porNome[semAcento(n)] = u.id; });
  });
  ["agenda_personal_notes", "agenda_recurring_notes"].forEach((c) => {
    add(c, lerColecao(pasta, c).map((d) => {
      const i = d.id.indexOf("_");
      const dono = i > 0 ? d.id.slice(0, i) : d.id;
      const resto = i > 0 ? d.id.slice(i + 1) : "";
      const todos = semAcento(dono) === "TODOS";
      const uid = todos ? null : (porNome[semAcento(dono)] || null);
      if (!todos && !uid && usuariosBanco) avisos.push(c + ": dono não encontrado no cadastro: " + dono + " (" + d.id + ")");
      return B.paraLinha(M[c], Object.assign({}, d.data, { dono, data: resto, usuario_id: uid }), d.id);
    }));
  });

  // kmz: <id>_quadras volta para a linha <id>; ids automáticos (formato antigo) ficam de fora
  const kmz = lerColecao(pasta, "kmz_coordinates");
  const quadras = {};
  kmz.filter((d) => /_quadras$/.test(d.id)).forEach((d) => { quadras[d.id.replace(/_quadras$/, "")] = d.data.quadras; });
  add("kmz_coordinates", kmz.filter((d) => /^\d{4,6}$/.test(d.id)).map((d) => {
    const o = Object.assign({}, d.data);
    if (quadras[d.id]) o.quadras = quadras[d.id];
    delete o.quadrasDoc;
    if (!o.empreendimento_id) o.empreendimento_id = d.id;
    return B.paraLinha(M.kmz_coordinates, o, d.id);
  }));
  const kmzFora = kmz.filter((d) => !/^\d{4,6}(_quadras)?$/.test(d.id)).length;
  if (kmzFora) avisos.push("kmz_coordinates: " + kmzFora + " docs no formato antigo não importados");

  return { saida, avisos };
}

// Ordem de gravação: perfis antes de usuários (FK), relatórios antes das linhas.
const ORDEM = ["perfis", "usuarios", "configuracoes", "centros_custo", "empresas", "condicoes_pagamento",
  "motivos_cancelamento", "preambulos", "cartorios", "central_email_templates", "obra_vgv", "parcerias",
  "fluxos_processo", "tags", "anexos_tag_memory", "anexos_mapa", "auditoria_logs", "auditoria_login_relatorios",
  "auditoria_login_linhas", "usuarios_online", "api_consumo", "ambientes_dev", "alertas_ciente", "suporte_chamados",
  "documentos_autenticados", "agenda_personal_notes", "agenda_recurring_notes", "central_email_envios",
  "sienge_sync_state", "kmz_coordinates"];

async function principal() {
  const pasta = arg("export");
  if (!pasta || pasta === true) { console.error("Informe --export <pasta do export>."); process.exit(1); }
  const seco = !!arg("seco");
  const so = arg("so") && arg("so") !== true ? new Set(String(arg("so")).split(",")) : null;

  let sb = null;
  let usuariosBanco = null;
  if (!seco) {
    sb = require("../../lib/supabase-admin").supabaseAdmin();
  }
  // Para resolver o dono da agenda é preciso o id (uuid) dos usuários; no modo seco usa só o export.
  let { saida, avisos } = montar(path.resolve(pasta), null);
  if (!seco) {
    const tab = saida.usuarios;
    if (!so || so.has("perfis") || so.has("usuarios")) {
      for (const t of ["perfis", "usuarios"]) {
        const r = await sb.from(t).upsert(saida[t].linhas, { onConflict: saida[t].conflito || "id", defaultToNull: false });
        if (r.error) throw new Error(t + ": " + r.error.message);
      }
    }
    const r = await sb.from("usuarios").select("id, nome, sienge_user");
    if (r.error) throw r.error;
    usuariosBanco = r.data;
    ({ saida, avisos } = montar(path.resolve(pasta), usuariosBanco));
    saida.usuarios = tab;
  }

  for (const t of ORDEM) {
    const item = saida[t];
    if (!item || (so && !so.has(t))) continue;
    const linhas = item.linhas;
    if (seco || t === "perfis" || t === "usuarios") {
      if (seco) console.log("[seco] " + t + ": " + linhas.length + " linhas");
      continue;
    }
    for (let i = 0; i < linhas.length; i += 500) {
      const lote = linhas.slice(i, i + 500);
      const r = await sb.from(t).upsert(lote, { onConflict: item.conflito || "id", defaultToNull: false });
      if (r.error) throw new Error(t + " (lote " + i + "): " + r.error.message);
    }
    console.log(t + ": " + linhas.length + " linhas");
  }
  avisos.forEach((a) => console.warn("aviso: " + a));
}

module.exports = { montar, ORDEM };

if (require.main === module) principal().catch((e) => {
  console.error("Falhou: " + (e && e.message ? e.message : e));
  process.exit(1);
});
