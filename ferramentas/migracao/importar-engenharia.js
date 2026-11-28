// Fase 4 (área engenharia / vistoria / comercial / orçamento de empreendimento): leva o export do Firestore para as
// tabelas no Supabase. Usa os mesmos mapas do front (js/engenharia/mapas-engenharia.js + js/nucleo/dados-base.js),
// então o que entra é o que a tela lê. Regras de cada coleção: docs/mapa-tabelas/engenharia-comercial.md.
//
// Uso:
//   node ferramentas/migracao/importar-engenharia.js --export <pasta> --seco      só monta e confere, não grava
//   node ferramentas/migracao/importar-engenharia.js --export <pasta>            grava (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
//   ... --so vistorias,construction_checks                                        só algumas tabelas
//   ... --sem-caches                                                              não importa as bases da caução (a rotina das
//                                                                                 06:30 regenera); _ajustes e _meta entram sempre
// Pode rodar de novo: tudo é upsert pela chave. Não apaga nada.
//
// Arquivos: as URLs do Firebase Storage viram o caminho do objeto (tipo storagePath do dados-base). URL de outro
// bucket/servidor não é convertida e fica em extra com o nome do campo (ex.: extra.fotoFrente) — o aviso conta quantas.
// vistoria_avisos, vistoria_batimento e comercial_batimento estão vazias no Firestore: nada a importar (caches do cron).
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const B = require("../../js/nucleo/dados-base.js");
const M = require("../../js/engenharia/mapas-engenharia.js");

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

// estoque_comercial tem docs de até 634 KB (15 MB no total): lido linha a linha.
async function lerColecaoStream(pasta, nome, cada) {
  const f = path.join(pasta, nome + ".ndjson");
  if (!fs.existsSync(f)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(f, "utf8"), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.trim()) continue;
    const d = JSON.parse(l);
    cada({ id: d.id, data: normal(d.data || {}) });
  }
}

// criado_em / atualizado_em (regra do engenharia-comercial.md): o importador informa os dois; sem valor na origem,
// os dois = horário da carga.
function carimbos(linha, criado, atualizado, agora) {
  const c = B.paraBanco(criado, "iso") || linha.criado_em || null;
  const a = B.paraBanco(atualizado, "iso") || linha.atualizado_em || null;
  linha.criado_em = c || a || agora;
  linha.atualizado_em = a || linha.criado_em;
  if (linha.atualizado_em < linha.criado_em) linha.atualizado_em = linha.criado_em;
  return linha;
}

// Conta URLs que não viraram caminho (ficaram em extra com o nome do campo).
const CAMPOS_ARQUIVO = ["fotoFrente", "fotoMeioFundo", "fotoFundoFrente", "fileUrl", "fileUrls", "siengeSentUrls"];
function contarExternas(tabela, linha, avisos) {
  const ext = CAMPOS_ARQUIVO.filter((k) => linha.extra && linha.extra[k] !== undefined);
  if (ext.length) avisos.push(tabela + "/" + linha.id + ": URL fora do bucket mantida em extra (" + ext.join(", ") + ")");
}

async function montar(pasta, opcoes) {
  const op = opcoes || {};
  const saida = {};
  const avisos = [];
  const agora = new Date().toISOString();
  const add = (tabela, linhas, extra) => {
    const t = (saida[tabela] = saida[tabela] || Object.assign({ linhas: [] }, extra || {}));
    t.linhas.push.apply(t.linhas, linhas);
  };

  // ---- vistorias: tipos mistos -> texto; createdAt Timestamp ou ISO; 3 fotos URL -> caminho; app achatado
  add("vistorias", lerColecao(pasta, "vistorias").map((d) => {
    const l = B.paraLinha(M.vistorias, d.data, d.id);
    contarExternas("vistorias", l, avisos);
    return carimbos(l, d.data.createdAt, d.data.updatedAt, agora);
  }));

  // ---- construction_checks: fileUrl/fileUrls/fotos -> caminhos
  add("construction_checks", lerColecao(pasta, "construction_checks").map((d) => {
    const l = B.paraLinha(M.construction_checks, d.data, d.id);
    contarExternas("construction_checks", l, avisos);
    return carimbos(l, d.data.createdAt, d.data.updatedAt, agora);
  }));

  // ---- engenharia_acompanhamento: doc "obras" -> uma linha por empreendimento; savedAt -> atualizado_em de todas
  lerColecao(pasta, "engenharia_acompanhamento").forEach((d) => {
    if (d.id !== "obras") { avisos.push("engenharia_acompanhamento: doc " + d.id + " ignorado (só 'obras')"); return; }
    const vistos = new Set();
    add("engenharia_acompanhamento", (Array.isArray(d.data.linhas) ? d.data.linhas : []).map((r) => {
      if (!r || !r.id) { avisos.push("engenharia_acompanhamento: linha sem id ignorada"); return null; }
      if (vistos.has(String(r.id))) { avisos.push("engenharia_acompanhamento: id " + r.id + " repetido; fica o primeiro"); return null; }
      vistos.add(String(r.id));
      const o = Object.assign({}, r);
      delete o.id;
      const l = B.paraLinha(M.engenharia_acompanhamento, o, r.id);
      return carimbos(l, r.inseridoEm || d.data.savedAt, d.data.savedAt, agora);
    }).filter(Boolean));
  });

  // ---- caucao_base: bases (concatena rows na ordem do chunk), _meta -> controle, _ajustes -> uma linha por chave
  const cb = lerColecao(pasta, "caucao_base");
  const bases = {};
  cb.forEach((d) => {
    if (d.id === "_meta") {
      const o = Object.assign({}, d.data, { running: false }); // trava não vem para o banco novo
      delete o.chunks; // a base inteira fica numa linha
      const l = B.paraLinha(M.caucao_base_controle, o, "_meta");
      add("caucao_base_controle", [carimbos(l, o.geradoEm, o.geradoEm, agora)]);
      return;
    }
    if (d.id === "_ajustes") {
      add("caucao_base_ajustes", Object.keys(d.data).map((k) => {
        const p = M.partesAjuste(k);
        const v = d.data[k];
        if (!p || !v || typeof v !== "object") { avisos.push("caucao_base/_ajustes: chave fora do padrão ignorada: " + k); return null; }
        const l = B.paraLinha(M.caucao_base_ajustes, Object.assign({}, v, p), k);
        return carimbos(l, v.at, v.at, agora);
      }).filter(Boolean));
      return;
    }
    const t = M.idCaucaoBase(d.id);
    if (!t) { avisos.push("caucao_base: doc " + d.id + " ignorado (id fora do padrão)"); return; }
    const b = (bases[t.id] = bases[t.id] || { tipo: t.tipo, ficha: null, partes: [] });
    if (t.chunk === null) b.ficha = d.data;
    else b.partes.push({ n: t.chunk, data: d.data });
  });
  if (op.semCaches) {
    if (Object.keys(bases).length) avisos.push("caucao_base: " + Object.keys(bases).length + " bases não importadas (--sem-caches)");
  } else {
    Object.keys(bases).forEach((id) => {
      const b = bases[id];
      b.partes.sort((x, y) => x.n - y.n);
      const rows = [].concat.apply([], b.partes.map((p) => (Array.isArray(p.data.rows) ? p.data.rows : [])));
      const ficha = Object.assign({}, b.ficha || {});
      const esperado = Number(ficha.chunks);
      if (esperado && esperado !== b.partes.length) avisos.push("caucao_base/" + id + ": ficha diz " + esperado + " chunks, export tem " + b.partes.length);
      if (ficha.count != null && Number(ficha.count) !== rows.length) avisos.push("caucao_base/" + id + ": count " + ficha.count + " ≠ " + rows.length + " linhas");
      delete ficha.chunks;
      const obj = Object.assign(ficha, { rows, count: rows.length });
      if (b.tipo === "dia" && !obj.date) obj.date = id;
      if (b.tipo === "dia" && b.partes[0] && b.partes[0].data.date) obj.date = b.partes[0].data.date;
      const l = B.paraLinha(M.caucao_base, obj, id);
      l.tipo = b.tipo;
      add("caucao_base", [carimbos(l, obj.geradoEm, obj.geradoEm, agora)]);
    });
  }

  // ---- estoque_comercial: uma linha por unidade; id repetido entre docs -> vale o doc com updatedAt maior
  const unidades = new Map();
  let repetidas = 0;
  await lerColecaoStream(pasta, "estoque_comercial", (d) => {
    if (M.CONTROLE_ESTOQUE.indexOf(d.id) >= 0) {
      const l = { id: d.id, dados: d.data };
      add("estoque_comercial_controle", [carimbos(l, d.data.updatedAt || d.data.touchedAt, d.data.updatedAt || d.data.touchedAt, agora)]);
      return;
    }
    if (!/^cc_/.test(d.id)) { avisos.push("estoque_comercial: doc " + d.id + " ignorado (nem cc_* nem controle)"); return; }
    const at = String(d.data.updatedAt || "");
    (Array.isArray(d.data.units) ? d.data.units : []).forEach((u) => {
      if (!u || u.id === undefined || u.id === null || u.id === "") { avisos.push("estoque_comercial/" + d.id + ": unidade sem id ignorada"); return; }
      const k = String(u.id);
      const antes = unidades.get(k);
      if (antes) { repetidas++; if (antes.at >= at) return; }
      const l = B.paraLinha(M.estoque_comercial, u, k);
      if (!l.enterprise_id) l.enterprise_id = d.data.enterpriseId != null ? String(d.data.enterpriseId) : null;
      l.date = B.paraBanco(d.data.date, "data");
      unidades.set(k, { at, linha: carimbos(l, d.data.updatedAt, d.data.updatedAt, agora) });
    });
  });
  add("estoque_comercial", Array.from(unidades.values()).map((x) => x.linha));
  if (repetidas) avisos.push("estoque_comercial: " + repetidas + " unidades repetidas entre docs (ficou a de updatedAt maior)");

  // ---- comercial
  add("tabelas_vigentes", lerColecao(pasta, "tabelas_vigentes").map((d) => {
    const o = Object.assign({}, d.data);
    if (o.id !== undefined && String(o.id) !== String(d.id)) avisos.push("tabelas_vigentes/" + d.id + ": campo id diferente do id do doc (" + o.id + "); vale o do doc");
    delete o.id;
    return carimbos(B.paraLinha(M.tabelas_vigentes, o, d.id), o.createdAt, o.updatedAt, agora);
  }));

  // ---- orçamento
  add("orcamento_empreendimento", lerColecao(pasta, "orcamento_empreendimento").map((d) =>
    carimbos(B.paraLinha(M.orcamento_empreendimento, d.data, d.id), d.data.em, d.data.em, agora)));
  add("orcamento_receita", lerColecao(pasta, "orcamento_receita").map((d) =>
    carimbos(B.paraLinha(M.orcamento_receita, d.data, d.id), d.data.em, d.data.em, agora)));
  add("orcamento_forecast", lerColecao(pasta, "orcamento_forecast").map((d) => {
    const l = B.paraLinha(M.orcamento_forecast, d.data, d.id);
    l.company_id = M.companyIdForecast(d.id);
    if (!l.company_id) avisos.push("orcamento_forecast/" + d.id + ": id fora do padrão emp_<companyId>");
    return carimbos(l, d.data.savedAt, d.data.savedAt, agora);
  }));

  // ---- solicitações
  add("tag_solicitacoes", lerColecao(pasta, "tag_solicitacoes").map((d) =>
    carimbos(B.paraLinha(M.tag_solicitacoes, d.data, d.id), d.data.criado_em, d.data.decidido_em || d.data.criado_em, agora)));
  add("solicitacoes_producao", lerColecao(pasta, "solicitacoes_producao").map((d) => {
    const o = d.data;
    const ultimo = Math.max(Number(o.criadoEm) || 0, Number(o.decididoEm) || 0, Number(o.publicadoEm) || 0, Number(o.avisoVistoEm) || 0);
    return carimbos(B.paraLinha(M.solicitacoes_producao, o, d.id), o.criadoEm, ultimo || null, agora);
  }));

  ["vistoria_avisos", "vistoria_batimento", "comercial_batimento"].forEach((c) => {
    const n = lerColecao(pasta, c).length;
    if (n) avisos.push(c + ": " + n + " docs no export não importados (coleção era vazia no mapeamento; ver engenharia-comercial.md)");
  });

  // ---- padrões e obrigatórias
  Object.keys(saida).forEach((t) => {
    let fora = 0;
    saida[t].linhas = saida[t].linhas.filter((l) => {
      M.aplicarPadroes(t, l);
      const falta = M.faltando(t, l);
      if (falta.length) { fora++; return false; }
      return true;
    });
    if (fora) avisos.push(t + ": " + fora + " linhas sem " + (M.OBRIGATORIAS[t] || []).join("/") + " não importadas");
  });

  return { saida, avisos };
}

// Ordem de gravação: vistorias antes de vistoria_avisos (FK); o resto não tem FK entre si.
const ORDEM = ["vistorias", "vistoria_avisos", "construction_checks", "engenharia_acompanhamento", "caucao_base",
  "caucao_base_controle", "caucao_base_ajustes", "estoque_comercial", "estoque_comercial_controle", "tabelas_vigentes",
  "orcamento_empreendimento", "orcamento_receita", "orcamento_forecast", "tag_solicitacoes", "solicitacoes_producao"];

async function principal() {
  const pasta = arg("export");
  if (!pasta || pasta === true) { console.error("Informe --export <pasta do export>."); process.exit(1); }
  const seco = !!arg("seco");
  const so = arg("so") && arg("so") !== true ? new Set(String(arg("so")).split(",")) : null;
  const { saida, avisos } = await montar(path.resolve(pasta), { semCaches: !!arg("sem-caches") });
  const sb = seco ? null : require("../../lib/supabase-admin").supabaseAdmin();

  for (const t of ORDEM) {
    const item = saida[t];
    if (!item || (so && !so.has(t))) continue;
    const linhas = item.linhas;
    if (seco) {
      // Tamanho aproximado: lote grande demais para a API vira erro na gravação real.
      const kb = Math.round(Buffer.byteLength(JSON.stringify(linhas)) / 1024);
      console.log("[seco] " + t + ": " + linhas.length + " linhas (~" + kb + " KB)");
      continue;
    }
    // Lotes menores para linhas grandes (base da caução e receita do orçamento têm dezenas de KB cada).
    const tam = t === "caucao_base" || t === "orcamento_receita" ? 5 : 500;
    for (let i = 0; i < linhas.length; i += tam) {
      const lote = linhas.slice(i, i + tam);
      const r = await sb.from(t).upsert(lote, { onConflict: "id", defaultToNull: false });
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
