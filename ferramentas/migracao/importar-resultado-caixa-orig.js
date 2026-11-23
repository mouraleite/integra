// Excel original de cada envio do Resultado de Caixa: no Firestore ficava em resultado_caixa_orig (texto base64,
// picado em docs "<id>__o<n>" acima de 400 mil caracteres). No Supabase vira um arquivo no bucket "arquivos",
// em resultado_caixa_orig/<id> (o mesmo caminho que js/financeiro/resultado-caixa.js grava e lê).
// O nome do arquivo não vai junto: a tela usa o origNome do item (coluna extra de resultado_caixa).
//
// Uso:
//   node ferramentas/migracao/importar-resultado-caixa-orig.js --export <pasta> --seco   só monta e confere
//   node ferramentas/migracao/importar-resultado-caixa-orig.js --export <pasta>         grava (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
// Pode rodar de novo: o envio usa upsert.
const fs = require("fs");
const path = require("path");
const B = require("../../js/nucleo/dados-base.js");

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function caminho(id) {
  return "resultado_caixa_orig/" + String(id || "").replace(/[\\/]/g, "_");
}

// { id -> Buffer } só dos docs "original" (as partes entram no pai).
function montar(pasta) {
  const f = path.join(pasta, "resultado_caixa_orig.ndjson");
  const arquivos = {};
  const avisos = [];
  if (!fs.existsSync(f)) return { arquivos, avisos };
  const docs = {};
  fs.readFileSync(f, "utf8").split("\n").filter(Boolean).forEach((l) => {
    const d = JSON.parse(l);
    docs[d.id] = d.data || {};
  });
  Object.keys(docs).forEach((id) => {
    const x = docs[id];
    if (x.tipo === "original-parte") return;
    let b64 = String(x.texto || "");
    if (Array.isArray(x.partes) && x.partes.length) {
      b64 = "";
      for (const pid of x.partes) {
        if (!docs[pid]) { avisos.push(id + ": falta a parte " + pid); b64 = ""; break; }
        b64 += String(docs[pid].texto || "");
      }
    }
    if (!b64) { avisos.push(id + ": sem conteúdo"); return; }
    arquivos[id] = Buffer.from(b64, "base64");
  });
  return { arquivos, avisos };
}

async function principal() {
  const pasta = arg("export");
  if (!pasta || pasta === true) throw new Error("Informe --export <pasta>.");
  const { arquivos, avisos } = montar(path.resolve(pasta));
  const ids = Object.keys(arquivos);
  const kb = Math.round(ids.reduce((s, id) => s + arquivos[id].length, 0) / 1024);
  console.log("resultado_caixa_orig: " + ids.length + " arquivos (" + kb + " KB)");
  avisos.forEach((a) => console.log("  aviso: " + a));
  if (arg("seco")) return;
  const sb = require("../../lib/supabase-admin").supabaseAdmin();
  for (const id of ids) {
    const r = await sb.storage.from("arquivos").upload(B.chaveStorage(caminho(id)), arquivos[id], {
      contentType: "application/octet-stream", upsert: true,
    });
    if (r.error) throw new Error(id + ": " + r.error.message);
  }
  console.log("resultado_caixa_orig: ok");
}

if (require.main === module) {
  principal().catch((e) => { console.error("Falhou: " + ((e && e.message) || e)); process.exit(1); });
}

module.exports = { montar, caminho };
