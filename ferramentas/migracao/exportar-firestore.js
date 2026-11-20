// Exporta as coleções do Firestore para arquivos locais e gera um relatório de campos por coleção.
// Só lê; não grava nada no Firebase. É a base para desenhar as tabelas do Supabase.
//
// Uso (na raiz do repositório):
//   node ferramentas/migracao/exportar-firestore.js [--saida <pasta>] [--so col1,col2] [--amostra N]
//
// Sem --saida, grava em ../integra-export/<data-hora> (fora do Git: os dados são da empresa).
// --amostra N lê só os N primeiros documentos de cada coleção (útil para um inventário rápido).
const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getFirestore, collection, query, orderBy, limit, startAfter, getDocs, documentId,
  Timestamp, GeoPoint, DocumentReference, Bytes,
} = require("firebase/firestore");

const RAIZ = path.resolve(__dirname, "..", "..");

// ---------- argumentos ----------
const args = process.argv.slice(2);
const arg = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const agora = new Date();
const carimbo = agora.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
const SAIDA = path.resolve(arg("--saida") || path.join(RAIZ, "..", "integra-export", carimbo));
const SO = arg("--so") ? arg("--so").split(",").map((s) => s.trim()).filter(Boolean) : null;
const AMOSTRA = arg("--amostra") ? Number(arg("--amostra")) : null;
const PAGINA = 500;

// ---------- config do Firebase antigo (o front não usa mais o firebase-config.js) ----------
function lerConfigFirebase() {
  return Object.assign({}, require("./firebase-legado"));
}

// ---------- lista de coleções: varre o código, porque o SDK cliente não lista coleções ----------
const CONHECIDAS = [
  "config", "settings", "sienge_defaulters_history", "vistorias", "kmz_coordinates", "caucao_base",
  "resultado_caixa", "custas_judiciais", "sienge_customers", "reneg_propostas", "cfin_pagos", "tags",
  "processos_contra", "nex_letters", "inadimplencia_snapshots", "customer_notes_shards",
  "orcamento_empreendimento", "documentos_autenticados", "dfc_orcamento", "construction_checks",
  "caixa_movimentos", "estoque_comercial", "dfc_realizado", "anexos_mapa", "agenda_personal_notes",
  "orcamento_receita", "vistoria_avisos", "rydoo_titulos", "rydoo_meta", "rydoo_arquivos", "reneg_liberacao",
  "mutuo_execucoes", "mutuo_meta", "jud_notes", "jud_notes_shards", "customer_jud_notes_shards",
  "customer_notes", "caixa_posicao", "caixa_radar", "caixa_diario_config", "caixa_valor_receber",
  "agenda_recurring_notes", "vistoria_batimento", "comercial_batimento", "titulos_incompletos_batimento",
  "tag_solicitacoes", "processos_judiciais", "processos_contra_motivos", "participacoes_periods",
  "participacoes_credores", "orcamento_forecast", "fiscal_notas_aprendizado", "fiscal_notas_envio",
  "engenharia_acompanhamento", "config_stages", "auditoria_logs", "auditoria_login_relatorios",
  "auditoria_login_partes", "anexos_tag_memory", "tabelas_vigentes", "marketing_budgets",
  "marketing_budget_config", "marketing_budget_titulos", "marketing_budget_vendas", "boletos_baixa_banco",
  "boletos_honorarios", "boletos_pagamentos", "relacionamento_docs_assinatura", "webro_repasse_pendente",
  "antecipacoes_mes", "cc_conta_parceria", "pagamento_lotes", "api_consumo", "usuarios_online",
  "suporte_chamados", "solicitacoes_producao", "ambientes_dev", "sienge_creditors", "sienge_sync_state",
  "anexos_juridicos", "cartao_clara",
];

function varrerCodigo() {
  const achadas = new Set();
  const padroes = [
    /collection\(\s*[\w.]+\s*,\s*["'`]([a-z][a-z0-9_]+)["'`]/g,
    /doc\(\s*[\w.]+\s*,\s*["'`]([a-z][a-z0-9_]+)["'`]\s*,/g,
    /\b[A-Z_]*COL[A-Z_]*\s*[=:]\s*["'`]([a-z][a-z0-9_]+)["'`]/g,
    /collections\/([a-z][a-z0-9_]+)\b/g,
  ];
  const pastas = ["js", "api", "lib", "vistoria-app"];
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visitar(p);
      else if (/\.(js|html)$/.test(e.name)) {
        const txt = fs.readFileSync(p, "utf8");
        for (const re of padroes) for (const m of txt.matchAll(re)) achadas.add(m[1]);
      }
    }
  };
  for (const d of pastas) if (fs.existsSync(path.join(RAIZ, d))) visitar(path.join(RAIZ, d));
  for (const f of ["vistoria.html"]) if (fs.existsSync(path.join(RAIZ, f))) {
    const txt = fs.readFileSync(path.join(RAIZ, f), "utf8");
    for (const re of padroes) for (const m of txt.matchAll(re)) achadas.add(m[1]);
  }
  return achadas;
}

// ---------- serialização dos tipos do Firestore ----------
function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Timestamp) return "timestamp";
  if (v instanceof GeoPoint) return "geopoint";
  if (v instanceof DocumentReference) return "referencia";
  if (v instanceof Bytes) return "bytes";
  if (typeof v === "number") return Number.isInteger(v) ? "inteiro" : "decimal";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(v)) return "texto-data";
    if ((v.startsWith("{") || v.startsWith("[")) && v.length > 1) { try { JSON.parse(v); return "texto-json"; } catch (_) {} }
    return "texto";
  }
  return typeof v; // boolean, object
}
function serializar(v) {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(serializar);
  if (v instanceof Timestamp) return { __tipo: "timestamp", iso: v.toDate().toISOString() };
  if (v instanceof GeoPoint) return { __tipo: "geopoint", lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __tipo: "referencia", caminho: v.path };
  if (v instanceof Bytes) return { __tipo: "bytes", base64: v.toBase64() };
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = serializar(v[k]); return o; }
  return v;
}

// ---------- relatório de campos ----------
function novoPerfil() { return { docs: 0, bytes: 0, maiorDoc: 0, campos: {} }; }
function registrar(perfil, data) {
  perfil.docs++;
  for (const [k, v] of Object.entries(data)) {
    const c = perfil.campos[k] || (perfil.campos[k] = { presente: 0, tipos: {}, exemplo: null, chavesFilhas: null });
    c.presente++;
    const t = tipoDe(v);
    c.tipos[t] = (c.tipos[t] || 0) + 1;
    if (c.exemplo === null && v !== null && v !== "") {
      const s = JSON.stringify(serializar(v));
      c.exemplo = s && s.length > 120 ? s.slice(0, 117) + "..." : s;
    }
    if (t === "object") {
      c.chavesFilhas = c.chavesFilhas || {};
      for (const kk of Object.keys(v).slice(0, 40)) c.chavesFilhas[kk] = (c.chavesFilhas[kk] || 0) + 1;
    }
  }
}

// ---------- exportação ----------
async function exportarColecao(db, nome, perfil) {
  const arq = fs.createWriteStream(path.join(SAIDA, `${nome}.ndjson`), { encoding: "utf8" });
  let ultimo = null;
  while (true) {
    const tamanho = AMOSTRA ? Math.min(PAGINA, AMOSTRA - perfil.docs) : PAGINA;
    if (tamanho <= 0) break;
    const partes = [collection(db, nome), orderBy(documentId()), limit(tamanho)];
    if (ultimo) partes.splice(2, 0, startAfter(ultimo));
    const snap = await getDocs(query(...partes));
    for (const d of snap.docs) {
      const data = d.data();
      const linha = JSON.stringify({ id: d.id, data: serializar(data) });
      perfil.bytes += linha.length;
      perfil.maiorDoc = Math.max(perfil.maiorDoc, linha.length);
      registrar(perfil, data);
      arq.write(linha + "\n");
    }
    if (snap.size < tamanho) break;
    ultimo = snap.docs[snap.docs.length - 1];
  }
  await new Promise((r) => arq.end(r));
}

function relatorioMarkdown(perfis) {
  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  let md = `# Inventário do Firestore (crm-gestao-mldu)\n\nGerado em ${agora.toISOString()}${AMOSTRA ? ` · amostra de ${AMOSTRA} docs por coleção` : ""}.\n\n`;
  md += "| Coleção | Docs | Tamanho | Maior doc | Campos |\n|---|---:|---:|---:|---:|\n";
  const nomes = Object.keys(perfis).sort((a, b) => perfis[b].docs - perfis[a].docs);
  for (const n of nomes) { const p = perfis[n]; md += `| ${n} | ${p.docs} | ${kb(p.bytes)} | ${kb(p.maiorDoc)} | ${Object.keys(p.campos).length} |\n`; }
  for (const n of nomes) {
    const p = perfis[n]; if (!p.docs) continue;
    md += `\n## ${n}\n\n${p.docs} docs.\n\n| Campo | Presente | Tipos | Exemplo |\n|---|---:|---|---|\n`;
    const campos = Object.entries(p.campos).sort((a, b) => b[1].presente - a[1].presente);
    for (const [k, c] of campos.slice(0, 120)) {
      const tipos = Object.entries(c.tipos).map(([t, q]) => `${t} ${q}`).join(", ");
      const ex = (c.exemplo || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      md += `| \`${k}\` | ${c.presente} | ${tipos} | ${ex} |\n`;
    }
    if (campos.length > 120) md += `\n_+${campos.length - 120} campos (ver _relatorio.json)._\n`;
  }
  return md;
}

(async () => {
  const cfg = lerConfigFirebase();
  const db = getFirestore(initializeApp(cfg));
  const nomes = SO || [...new Set([...CONHECIDAS, ...varrerCodigo()])].sort();
  fs.mkdirSync(SAIDA, { recursive: true });
  console.log(`Exportando ${nomes.length} coleções do projeto ${cfg.projectId} para ${SAIDA}`);

  const perfis = {}, erros = {};
  for (const nome of nomes) {
    const perfil = (perfis[nome] = novoPerfil());
    const t0 = Date.now();
    try {
      await exportarColecao(db, nome, perfil);
      console.log(`  ${nome.padEnd(36)} ${String(perfil.docs).padStart(7)} docs  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      erros[nome] = String(e && e.message || e);
      console.log(`  ${nome.padEnd(36)} ERRO: ${erros[nome]}`);
    }
  }
  const vazias = Object.keys(perfis).filter((n) => !perfis[n].docs && !erros[n]);
  for (const n of vazias) { try { fs.unlinkSync(path.join(SAIDA, `${n}.ndjson`)); } catch (_) {} delete perfis[n]; }

  fs.writeFileSync(path.join(SAIDA, "_relatorio.json"), JSON.stringify({ geradoEm: agora.toISOString(), projeto: cfg.projectId, amostra: AMOSTRA, perfis, vazias, erros }, null, 2));
  fs.writeFileSync(path.join(SAIDA, "_relatorio.md"), relatorioMarkdown(perfis));
  const total = Object.values(perfis).reduce((s, p) => s + p.docs, 0);
  console.log(`\nPronto: ${Object.keys(perfis).length} coleções com dados, ${total} documentos. ${vazias.length} nomes sem documentos, ${Object.keys(erros).length} com erro.`);
  console.log(`Relatório: ${path.join(SAIDA, "_relatorio.md")}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
