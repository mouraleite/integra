// Fase 4: confere a carga. Para cada tabela, compara quantas linhas os importadores montam a partir do export do
// Firestore (as mesmas funções "montar" de importar-*.js) com quantas existem no Supabase.
//
// Uso (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY):
//   node ferramentas/migracao/conferir-contagens.js --export ..\integra-export\<pasta>
//   ... --so financeiro          só uma área (nucleo, cobranca, engenharia, financeiro)
// Saída: uma linha por tabela (esperado x banco). "a menos" no banco é falha da carga; "a mais" é normal se o Integra
// novo já gravou algo depois da carga (no ensaio ou depois da virada). Termina com código 1 se alguma tabela tiver a menos.
const path = require("path");

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const AREAS = {
  nucleo: { arquivo: "./importar-nucleo", chamar: async (m, pasta, sb) => m.montar(pasta, await usuariosDoBanco(sb)) },
  cobranca: { arquivo: "./importar-cobranca", chamar: (m, pasta) => m.montar(pasta, {}) },
  engenharia: { arquivo: "./importar-engenharia", chamar: (m, pasta) => m.montar(pasta, {}) },
  financeiro: { arquivo: "./importar-financeiro", chamar: (m, pasta) => m.montar(pasta, {}) },
};

// O importador do núcleo liga notas da agenda ao usuário do banco (mesma leitura que ele faz).
async function usuariosDoBanco(sb) {
  const r = await sb.from("usuarios").select("id, nome, sienge_user, email, login_email").limit(5000);
  if (r.error) throw r.error;
  return r.data || [];
}

// Linhas distintas pela chave de conflito (a mesma linha pode vir de duas fontes; o upsert grava uma).
function distintas(item) {
  const linhas = item.linhas || [];
  const chaves = String(item.conflito || "id").split(",").map((s) => s.trim());
  if (!linhas.length || !linhas.every((l) => chaves.every((k) => l[k] !== undefined && l[k] !== null))) return linhas.length;
  return new Set(linhas.map((l) => chaves.map((k) => String(l[k])).join("|"))).size;
}

async function contar(sb, tabela) {
  const r = await sb.from(tabela).select("*", { count: "exact", head: true });
  if (r.error) throw new Error(tabela + ": " + r.error.message);
  return r.count || 0;
}

async function principal() {
  const pasta = arg("export");
  if (!pasta || pasta === true) { console.error("Informe --export <pasta do export>."); process.exit(1); }
  const so = typeof arg("so") === "string" ? new Set(arg("so").split(",")) : null;
  const sb = require("../../lib/supabase-admin").supabaseAdmin();

  const esperado = {};      // tabela -> linhas esperadas (soma das áreas)
  const viaRpc = {};        // tabela -> nome da RPC (contagem é o que a RPC grava)
  for (const area of Object.keys(AREAS)) {
    if (so && !so.has(area)) continue;
    const mod = require(AREAS[area].arquivo);
    const { saida, avisos } = await AREAS[area].chamar(mod, path.resolve(pasta), sb);
    console.log(area + ": " + Object.keys(saida).length + " tabelas montadas" + (avisos && avisos.length ? " (" + avisos.length + " avisos do importador)" : ""));
    Object.keys(saida).forEach((t) => {
      const item = saida[t];
      esperado[t] = (esperado[t] || 0) + distintas(item);
      if (item.rpc) viaRpc[t] = item.rpc.nome;
    });
  }

  let menos = 0;
  console.log("\ntabela                                  esperado     banco   situação");
  for (const t of Object.keys(esperado).sort()) {
    const n = await contar(sb, t);
    const e = esperado[t];
    const sit = n === e ? "ok" : n < e ? "A MENOS (" + (e - n) + ")" : "a mais (" + (n - e) + ")";
    if (n < e) menos++;
    console.log(t.padEnd(38) + String(e).padStart(10) + String(n).padStart(10) + "   " + sit + (viaRpc[t] ? "  [RPC " + viaRpc[t] + "]" : ""));
  }
  console.log(menos ? "\n" + menos + " tabela(s) com linhas a menos no banco." : "\nNenhuma tabela com linhas a menos.");
  process.exit(menos ? 1 : 0);
}

principal().catch((e) => {
  console.error("Falhou: " + ((e && e.message) || e));
  process.exit(1);
});
