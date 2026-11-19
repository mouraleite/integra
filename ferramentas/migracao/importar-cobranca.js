// Fase 4 (área cobrança / clientes / relacionamento / jurídico): leva o export do Firestore para as tabelas no Supabase.
// Usa os mesmos mapas do front (js/cobranca/mapas-cobranca.js + js/nucleo/dados-base.js), então o que entra é o que a
// tela lê. Regras de cada coleção: docs/mapa-tabelas/cobranca-juridico.md.
//
// Uso:
//   node ferramentas/migracao/importar-cobranca.js --export <pasta> --seco      só monta e confere, não grava
//   node ferramentas/migracao/importar-cobranca.js --export <pasta>            grava (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
//   ... --so customer_notes,jud_notes                                           só algumas tabelas
//   ... --dias-cache 7                                                          dias de sienge_defaulters_history (padrão 7;
//                                                                               0 = todos), contados do dia mais novo do export
//   ... --sem-teste                                                             não importa as notas "TESTE" e as de teste do
//                                                                               título 4868 / cliente 5187 (decisão do dono)
// Pode rodar de novo: tudo é upsert pela chave (registro_cadastro troca o arquivo inteiro pela RPC). Não apaga nada
// além das linhas do arquivo da tela Registro.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const B = require("../../js/nucleo/dados-base.js");
const M = require("../../js/cobranca/mapas-cobranca.js");

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

// Timestamps do export ({__tipo:"timestamp", iso}) viram epoch ms (os tipos "iso"/"ms" do mapa aceitam os dois).
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

function lerColecao(pasta, nome) {
  const f = path.join(pasta, nome + ".ndjson");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => {
    const d = JSON.parse(l);
    return { id: d.id, data: normal(d.data || {}) };
  });
}

// Texto JSON -> objeto (campos de M.JSON_TEXTO). Se não parsear, fica a string (jsonb aceita) e registra.
function parsearJsonTexto(colecao, id, obj, avisos) {
  (M.JSON_TEXTO[colecao] || []).forEach((k) => {
    if (typeof obj[k] !== "string") return;
    try { obj[k] = JSON.parse(obj[k]); } catch (e) { avisos.push(colecao + "/" + id + ": " + k + " não é JSON válido (gravado como texto)"); }
  });
  return obj;
}

// criado_em / atualizado_em a partir do doc (regra comum do cobranca-juridico.md).
function carimbos(linha, obj, opcoes) {
  const o = opcoes || {};
  const criado = B.paraBanco(o.criado !== undefined ? o.criado : (obj.createdAt || obj.created_at || obj.date), "iso");
  const atual = B.paraBanco(o.atualizado !== undefined ? o.atualizado : (obj.updatedAt || obj.updated_at), "iso");
  if (criado && !linha.criado_em) linha.criado_em = criado;
  if (atual) linha.atualizado_em = atual;
  if (linha.criado_em && linha.atualizado_em && linha.atualizado_em < linha.criado_em) linha.atualizado_em = linha.criado_em;
  return linha;
}

// Colunas not null com default: null/ausente vira o default (lote homogêneo, sem violar not null).
const PADROES = {
  sienge_customers: { phones: [], addresses: [], contacts: [], procurators: [], sub_types: [], family_income: [], is_subjudice: false },
  customer_notes: { text: "", promised_installments: [], pinned: false, attachments: [], past_texts: [] },
  jud_notes: { text: "", pinned: false },
  processos_contra: { anexos: [] },
  custas_judiciais: { tipos: [], guias: [], comprovantes: [], anexos: [] },
  boletos_honorarios: { terceirizado: false, parcelas: [], totais: {} },
  boletos_pagamentos: { parcelas: [] },
  boletos_baixa_banco: { parcelas: [], parcelas_numero: [] },
  reneg_propostas: { status: "ativa", sinal_pago: false, selected_bill_ids: [] },
  reneg_liberacao: { status: "pendente", contratos: [] },
  relacionamento_docs_assinatura: { status: "aguardando" },
};
// Colunas not null sem default: linha sem valor não entra (aviso).
const OBRIGATORIAS = {
  sienge_customers: ["name"], sienge_defaulters_history: ["tipo"], inadimplencia_snapshots: ["date"],
  customer_notes: ["customer_id", "date"], jud_notes: ["customer_id", "date"], processos_judiciais: ["customer_id"],
  processos_contra_motivos: ["nome"], custas_judiciais: ["customer_id", "sale_id"], boletos_honorarios: ["competencia"],
  boletos_pagamentos: ["rec_id", "competencia"], boletos_baixa_banco: ["titulo"], nex_letters: ["doc_id", "item_id", "customer_id"],
  reneg_propostas: ["customer_id", "sale_id"], relacionamento_docs_assinatura: ["tipo"], webro_repasse_pendente: ["titulo"],
};

function idLegado(customerId, n) {
  return "leg_" + crypto.createHash("sha1").update(String(customerId) + "|" + M.identidadeNota(n)).digest("hex").slice(0, 24);
}

// Mesmas regras do app (isExactTesteOccurrence e isTitulo4868BoletoOccurrence).
function notaDeTeste(n, customerId) {
  const t = String((n && n.text) || "").replace(/ /g, " ").trim().toUpperCase().replace(/\s+/g, " ");
  if (t === "TESTE") return true;
  const sale = String(n.saleId != null ? n.saleId : (n.titulo || "")).replace(/^B-/i, "").split("-")[0].trim();
  const cid = String(customerId != null && String(customerId) !== "" ? customerId : (n.customerId || "")).trim();
  if (sale && sale !== "4868") return false;
  if (!sale && cid && cid !== "5187") return false;
  if (sale !== "4868" && cid !== "5187") return false;
  const tn = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (tn.includes("TESTE") && (tn.includes("BOLETO GERADO") || tn.includes("[SISTEMA]"))) || (!!n.checkPayment && tn.includes("TESTE"));
}

// Notas: listas por cliente vindas de várias coleções (na ordem de prioridade), mescladas pela regra do app.
function montarNotas(tabela, fontes, semTeste, avisos) {
  const porCliente = new Map();
  fontes.forEach((f) => {
    f.docs.forEach((d) => {
      const pares = f.legado ? [[d.id, d.data.notes]] : Object.keys(d.data).map((k) => [k, d.data[k]]);
      pares.forEach(([cid, lista]) => {
        if (!Array.isArray(lista)) return;
        const k = String(cid);
        if (!porCliente.has(k)) porCliente.set(k, []);
        porCliente.get(k).push(lista);
      });
    });
  });
  const linhas = [];
  const usados = new Map();
  let teste = 0, semId = 0, repetidos = 0;
  porCliente.forEach((listas, cid) => {
    M.mesclarNotas.apply(null, listas).forEach((n) => {
      if (notaDeTeste(n, cid)) {
        teste++;
        if (semTeste) return;
      }
      const nota = Object.assign({}, n);
      if (!nota.id) { nota.id = idLegado(cid, n); semId++; }
      if (usados.has(nota.id)) {
        if (usados.get(nota.id) !== cid) avisos.push(tabela + ": id " + nota.id + " em mais de um cliente (" + usados.get(nota.id) + ", " + cid + "); fica o primeiro");
        repetidos++;
        return;
      }
      usados.set(nota.id, cid);
      const l = B.paraLinha(M[tabela], nota, nota.id);
      l.customer_id = cid;
      linhas.push(carimbos(l, nota, { criado: nota.date }));
    });
  });
  if (semId) avisos.push(tabela + ": " + semId + " notas sem id ganharam id 'leg_<sha1>'");
  if (repetidos) avisos.push(tabela + ": " + repetidos + " notas com id repetido descartadas");
  if (teste) avisos.push(tabela + ": " + teste + " notas de teste (\"TESTE\" / título 4868) " + (semTeste ? "não importadas" : "importadas (use --sem-teste para tirar)"));
  return linhas;
}

// Tabela -> { linhas, conflito, rpc? }
function montar(pasta, opcoes) {
  const op = opcoes || {};
  const saida = {};
  const avisos = [];
  const add = (tabela, linhas, conflito) => {
    const t = (saida[tabela] = saida[tabela] || { linhas: [], conflito });
    t.linhas.push.apply(t.linhas, linhas);
  };
  const umPorUm = (colecao, transformar, criado) => lerColecao(pasta, colecao).map((d) => {
    const obj = transformar ? transformar(d) : d.data;
    return carimbos(B.paraLinha(M[colecao], obj, d.id), obj, criado ? criado(obj) : undefined);
  });

  // ---- sienge_customers: createdAt é data do Sienge, não do Integra -> criado_em fica now()
  add("sienge_customers", lerColecao(pasta, "sienge_customers").map((d) => {
    const l = B.paraLinha(M.sienge_customers, d.data, d.id);
    if (l.is_subjudice == null) l.is_subjudice = false;
    return l;
  }));

  // ---- sienge_defaulters_history: cache; só os últimos N dias; estados do cron ficam de fora (o cron recria)
  const cache = lerColecao(pasta, "sienge_defaulters_history");
  const dias = op.diasCache == null ? 7 : Number(op.diasCache);
  const tipos = cache.map((d) => M.tipoCacheDia(d.id, d.data));
  const maisNovo = tipos.reduce((m, t) => (t && t.date && t.date > m ? t.date : m), "");
  const corte = dias > 0 && maisNovo ? new Date(Date.parse(maisNovo + "T12:00:00Z") - (dias - 1) * 864e5).toISOString().slice(0, 10) : "";
  let foraCache = 0, estados = 0;
  add("sienge_defaulters_history", cache.map((d, i) => {
    const t = tipos[i];
    if (!t) { avisos.push("sienge_defaulters_history: id fora do padrão ignorado: " + d.id); return null; }
    if (t.tipo === "estado") { estados++; return null; }
    if (corte && t.date < corte) { foraCache++; return null; }
    const obj = parsearJsonTexto("sienge_defaulters_history", d.id, Object.assign({}, d.data), avisos);
    const l = B.paraLinha(M.sienge_defaulters_history, obj, d.id);
    l.tipo = t.tipo;
    l.indice = t.indice;
    if (!l.date) l.date = t.date;
    return carimbos(l, obj, { criado: obj.createdAt || null });
  }).filter(Boolean));
  if (foraCache) avisos.push("sienge_defaulters_history: " + foraCache + " docs anteriores a " + corte + " não importados (--dias-cache " + dias + ")");
  if (estados) avisos.push("sienge_defaulters_history: " + estados + " docs de estado do cron não importados");

  // ---- inadimplencia_snapshots: data_json às vezes texto; date pelo id se faltar
  add("inadimplencia_snapshots", umPorUm("inadimplencia_snapshots", (d) => {
    const o = parsearJsonTexto("inadimplencia_snapshots", d.id, Object.assign({}, d.data), avisos);
    if (!o.date && /^\d{4}-\d{2}-\d{2}$/.test(d.id)) o.date = d.id;
    return o;
  }, (o) => ({ criado: o.created_at || o.saved_at || o.date, atualizado: o.saved_at || null })));

  // ---- notas: shards primeiro, depois o legado
  add("customer_notes", montarNotas("customer_notes", [
    { docs: lerColecao(pasta, "customer_notes_shards") },
    { docs: lerColecao(pasta, "customer_notes"), legado: true },
  ], !!op.semTeste, avisos));
  add("jud_notes", montarNotas("jud_notes", [
    { docs: lerColecao(pasta, "customer_jud_notes_shards") },
    { docs: lerColecao(pasta, "jud_notes_shards") },
    { docs: lerColecao(pasta, "jud_notes"), legado: true },
  ], false, avisos));

  // ---- jurídico
  add("processos_judiciais", umPorUm("processos_judiciais", (d) => Object.assign({ customerId: d.id }, d.data)));
  add("processos_contra_motivos", [].concat.apply([], lerColecao(pasta, "processos_contra_motivos").map((d) => {
    const vistos = new Set();
    return (Array.isArray(d.data.itens) ? d.data.itens : []).map((m, i) => {
      const id = String((m && m.id) || "").trim();
      const nome = String((m && m.nome) || "").trim();
      if (!id || !nome || vistos.has(id)) return null;
      vistos.add(id);
      const l = B.paraLinha(M.processos_contra_motivos, { nome, ordem: i }, id);
      return carimbos(l, {}, { criado: d.data.updatedAt || null, atualizado: d.data.updatedAt || null });
    }).filter(Boolean);
  })));
  add("processos_contra", umPorUm("processos_contra", (d) => {
    const o = Object.assign({}, d.data);
    if (o.customerId === "") o.customerId = null; // '' = parte não é cliente
    return o;
  }));
  add("custas_judiciais", umPorUm("custas_judiciais"));

  // ---- boletos
  add("boletos_honorarios", umPorUm("boletos_honorarios", null, (o) => ({ criado: o.generatedAt || null })));
  add("boletos_pagamentos", umPorUm("boletos_pagamentos", null, (o) => ({ criado: o.checkedAt || null, atualizado: o.checkedAt || null })));
  add("boletos_baixa_banco", umPorUm("boletos_baixa_banco", null, (o) => ({ criado: o.informado_em || null })));

  // ---- NEX: uma linha por carta
  let nexRepetidas = 0;
  add("nex_letters", [].concat.apply([], lerColecao(pasta, "nex_letters").map((d) => {
    const doc = d.data;
    const vistos = new Set();
    const cidDoc = String(doc.customerId || d.id.split("_")[0] || "");
    const titDoc = String(doc.titulo || doc.saleId || d.id.slice(cidDoc.length + 1) || "");
    return (Array.isArray(doc.items) ? doc.items : []).map((it) => {
      if (!it || !it.id) { avisos.push("nex_letters/" + d.id + ": carta sem id ignorada"); return null; }
      if (vistos.has(String(it.id))) { nexRepetidas++; return null; }
      vistos.add(String(it.id));
      const l = B.paraLinha(M.nex_letters, it, it.id);
      l.doc_id = d.id;
      l.customer_id = cidDoc || l.customer_id;
      l.sale_id = doc.saleId != null ? String(doc.saleId) : titDoc;
      if (!l.titulo) l.titulo = titDoc;
      return carimbos(l, it, { criado: it.createdAt || null, atualizado: doc.updatedAt || null });
    }).filter(Boolean);
  })), "doc_id,item_id");
  if (nexRepetidas) avisos.push("nex_letters: " + nexRepetidas + " cartas repetidas no mesmo doc descartadas");

  // ---- renegociação
  add("reneg_propostas", umPorUm("reneg_propostas"));
  add("reneg_liberacao", umPorUm("reneg_liberacao", null, () => ({ criado: null }))); // criadoEm já vai para criado_em

  // ---- relacionamento
  add("relacionamento_docs_assinatura", umPorUm("relacionamento_docs_assinatura"));
  add("webro_repasse_pendente", umPorUm("webro_repasse_pendente", null, (o) => ({ criado: o.baixa || null })));

  // ---- registro_cadastro: ficha "atual" + partes atual_N (pedaços de um texto JSON) -> RPC substituir_registro_cadastro
  const reg = lerColecao(pasta, "registro_cadastro");
  const ficha = (reg.find((d) => d.id === "atual") || {}).data;
  if (ficha) {
    let texto = "";
    const partes = Number(ficha.partes) || 0;
    for (let i = 0; i < partes; i++) {
      const p = reg.find((d) => d.id === "atual_" + i);
      if (!p) { avisos.push("registro_cadastro: parte atual_" + i + " ausente"); texto = ""; break; }
      texto += String(p.data.dados || "");
    }
    let linhas = [];
    try { linhas = JSON.parse(texto || "[]"); } catch (e) { avisos.push("registro_cadastro: texto das partes não é JSON válido"); }
    if (Array.isArray(linhas) && linhas.length) {
      if (ficha.unidades && Number(ficha.unidades) !== linhas.length) {
        avisos.push("registro_cadastro: ficha diz " + ficha.unidades + " unidades, partes têm " + linhas.length);
      }
      saida.registro_cadastro = {
        linhas: [B.paraLinha(M.registro_cadastro, { arquivo: ficha.arquivo, quando: ficha.quando, por: ficha.por, unidades: linhas.length }, "atual")],
        rpc: { nome: "substituir_registro_cadastro", args: { p_arquivo: ficha.arquivo || null, p_quando: B.paraBanco(ficha.quando, "iso"), p_por: ficha.por || null, p_linhas: linhas } },
      };
      saida.registro_cadastro_linhas = { linhas: linhas.map((x, i) => Object.assign(B.paraLinha(M.registro_cadastro_linhas, x), { registro_id: "atual", ordem: i + 1 })), viaRpc: true };
    }
  }

  // ---- padrões e obrigatórias
  Object.keys(saida).forEach((t) => {
    const pad = PADROES[t] || {};
    const obr = OBRIGATORIAS[t] || [];
    let fora = 0;
    saida[t].linhas = saida[t].linhas.filter((l) => {
      Object.keys(pad).forEach((c) => { if (l[c] === null || l[c] === undefined) l[c] = pad[c]; });
      const falta = obr.filter((c) => l[c] === null || l[c] === undefined || l[c] === "");
      if (falta.length) { fora++; return false; }
      return true;
    });
    if (fora) avisos.push(t + ": " + fora + " linhas sem " + obr.join("/") + " não importadas");
  });

  return { saida, avisos };
}

// Ordem de gravação (sem FKs entre elas, exceto registro_cadastro -> linhas, que vão juntas pela RPC).
const ORDEM = ["sienge_customers", "sienge_defaulters_history", "inadimplencia_snapshots", "customer_notes", "jud_notes",
  "processos_judiciais", "processos_contra_motivos", "processos_contra", "custas_judiciais", "boletos_honorarios",
  "boletos_pagamentos", "boletos_baixa_banco", "nex_letters", "reneg_propostas", "reneg_liberacao",
  "relacionamento_docs_assinatura", "registro_cadastro", "registro_cadastro_linhas", "webro_repasse_pendente"];

async function principal() {
  const pasta = arg("export");
  if (!pasta || pasta === true) { console.error("Informe --export <pasta do export>."); process.exit(1); }
  const seco = !!arg("seco");
  const so = arg("so") && arg("so") !== true ? new Set(String(arg("so")).split(",")) : null;
  const dc = arg("dias-cache");
  const { saida, avisos } = montar(path.resolve(pasta), { diasCache: dc && dc !== true ? Number(dc) : undefined, semTeste: !!arg("sem-teste") });
  const sb = seco ? null : require("../../lib/supabase-admin").supabaseAdmin();

  for (const t of ORDEM) {
    const item = saida[t];
    if (!item || (so && !so.has(t))) continue;
    const linhas = item.linhas;
    if (seco) {
      // Tamanho aproximado: lote grande demais para a API vira erro na gravação real.
      const kb = Math.round(Buffer.byteLength(JSON.stringify(linhas)) / 1024);
      console.log("[seco] " + t + ": " + linhas.length + " linhas (~" + kb + " KB)" + (item.rpc ? " via RPC " + item.rpc.nome : "") + (item.viaRpc ? " (vão na RPC de registro_cadastro)" : ""));
      continue;
    }
    if (item.viaRpc) continue;
    if (item.rpc) {
      const r = await sb.rpc(item.rpc.nome, item.rpc.args);
      if (r.error) throw new Error(t + ": " + r.error.message);
      console.log(t + ": " + r.data + " linhas (RPC " + item.rpc.nome + ")");
      continue;
    }
    // Lotes menores para tabelas de linhas grandes (blocos do cache ~1 MB, html das cartas NEX).
    const tam = t === "sienge_defaulters_history" ? 5 : t === "nex_letters" ? 100 : 500;
    for (let i = 0; i < linhas.length; i += tam) {
      const lote = linhas.slice(i, i + tam);
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
