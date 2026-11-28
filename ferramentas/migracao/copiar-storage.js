// Fase 4: copia os arquivos do Firebase Storage (bucket crm-gestao-mldu) para o bucket privado "arquivos" do Supabase.
// O caminho continua o mesmo; a chave no Supabase é DadosBase.chaveStorage(caminho) (sem acento etc.), a mesma que o
// front (js/nucleo/storage-supabase.js) e o servidor (api/_lib/arquivo.js) usam. Os registros no banco não mudam.
//
// Uso (variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY):
//   node ferramentas/migracao/copiar-storage.js --seco                 lista e confere (quantos, tamanho, chaves repetidas)
//   node ferramentas/migracao/copiar-storage.js                        copia tudo
//   ... --prefixo vistorias/                                           só uma pasta
//   ... --limite 50                                                    só os primeiros N (ensaio)
//   ... --paralelo 6                                                   cópias ao mesmo tempo (padrão 6)
//   ... --reescrever                                                   no fim, troca os links antigos do Firebase gravados
//                                                                      no banco por /arquivo?p=... (RPC reescrever_urls_storage)
//   ... --conferir                                                     compara a contagem por pasta (Firebase x Supabase)
// Pode rodar de novo: guarda o md5 de cada arquivo copiado em ..\integra-export\storage-copiados.json e pula o que não
// mudou no Firebase. Arquivo que sumiu do Firebase não é apagado no Supabase.
const fs = require("fs");
const path = require("path");
const B = require("../../js/nucleo/dados-base.js");
const FB = require("./firebase-legado");

const RAIZ = path.join(__dirname, "..", "..");
const BUCKET_FB = FB.storageBucket;
const BUCKET_SB = "arquivos";
const API_FB = "https://firebasestorage.googleapis.com/v0/b/" + BUCKET_FB + "/o";

function arg(nome) {
  const i = process.argv.indexOf("--" + nome);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const SECO = !!arg("seco");
const PREFIXO = typeof arg("prefixo") === "string" ? arg("prefixo") : "";
const LIMITE = arg("limite") ? Number(arg("limite")) : 0;
const PARALELO = arg("paralelo") ? Math.max(1, Number(arg("paralelo"))) : 6;
const ESTADO = path.resolve(RAIZ, "..", "integra-export", "storage-copiados.json");

async function pedir(url, tentativas) {
  let ultimo;
  for (let i = 0; i < (tentativas || 4); i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429 || r.status >= 500) { ultimo = new Error("HTTP " + r.status); await espera(1500 * (i + 1)); continue; }
      return r;
    } catch (e) {
      ultimo = e;
      await espera(1500 * (i + 1));
    }
  }
  throw ultimo;
}
function espera(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Todos os objetos do Firebase (lista sem delimitador = todos, recursivo), com tamanho/md5/tipo.
async function listarFirebase() {
  const nomes = [];
  let pagina = "";
  do {
    const url = API_FB + "?maxResults=1000" + (PREFIXO ? "&prefix=" + encodeURIComponent(PREFIXO) : "")
      + (pagina ? "&pageToken=" + encodeURIComponent(pagina) : "");
    const r = await pedir(url);
    if (!r.ok) throw new Error("Firebase recusou a lista (" + r.status + "): " + (await r.text()).slice(0, 200));
    const j = await r.json();
    (j.items || []).forEach((it) => { if (it && it.name && !it.name.endsWith("/")) nomes.push(it.name); });
    pagina = j.nextPageToken || "";
    process.stdout.write("\rlistando o Firebase: " + nomes.length + " arquivos");
  } while (pagina && !(LIMITE && nomes.length >= LIMITE));
  process.stdout.write("\n");
  return LIMITE ? nomes.slice(0, LIMITE) : nomes;
}

async function metadados(nome) {
  const r = await pedir(API_FB + "/" + encodeURIComponent(nome));
  if (!r.ok) throw new Error("metadados " + r.status);
  const j = await r.json();
  return { size: Number(j.size) || 0, md5: j.md5Hash || "", tipo: j.contentType || "application/octet-stream" };
}

async function baixar(nome) {
  const r = await pedir(API_FB + "/" + encodeURIComponent(nome) + "?alt=media");
  if (!r.ok) throw new Error("download " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, "utf8")); } catch (e) { return {}; }
}
function gravarEstado(estado) {
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify(estado));
}

function pasta(nome) {
  return nome.split("/")[0] || "(raiz)";
}

// Contagem por pasta de 1º nível no Supabase (lista recursiva pela API de Storage).
async function contarSupabase(sb, prefixo) {
  const b = sb.storage.from(BUCKET_SB);
  let total = 0;
  const filas = [prefixo || ""];
  while (filas.length) {
    const p = filas.shift();
    for (let de = 0; ; de += 1000) {
      const r = await b.list(p, { limit: 1000, offset: de });
      if (r.error) throw r.error;
      const itens = r.data || [];
      itens.forEach((o) => {
        if (o.id === null || o.id === undefined) filas.push((p ? p + "/" : "") + o.name);
        else if (o.name !== ".emptyFolderPlaceholder") total++;
      });
      if (itens.length < 1000) break;
    }
  }
  return total;
}

async function principal() {
  const nomes = await listarFirebase();
  // Chaves repetidas: dois caminhos que viram a mesma chave no Supabase (só muda acento/caractere especial).
  const porChave = new Map();
  nomes.forEach((n) => {
    const k = B.chaveStorage(n);
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(n);
  });
  const repetidas = [...porChave.entries()].filter(([, l]) => l.length > 1);
  const trocadas = nomes.filter((n) => B.chaveStorage(n) !== n).length;
  const porPasta = {};
  nomes.forEach((n) => { porPasta[pasta(n)] = (porPasta[pasta(n)] || 0) + 1; });
  console.log("Firebase: " + nomes.length + " arquivos em " + Object.keys(porPasta).length + " pastas");
  Object.keys(porPasta).sort().forEach((p) => console.log("  " + p + ": " + porPasta[p]));
  console.log("caminhos com caractere trocado na chave: " + trocadas);
  if (repetidas.length) {
    console.log("ATENÇÃO, " + repetidas.length + " chaves repetidas (o último copiado vence):");
    repetidas.slice(0, 30).forEach(([k, l]) => console.log("  " + k + " <- " + l.join(" | ")));
  }

  const sb = SECO && !arg("conferir") ? null : require("../../lib/supabase-admin").supabaseAdmin();

  if (!SECO) {
    const estado = lerEstado();
    let feitos = 0, pulados = 0, bytes = 0;
    const erros = [];
    let i = 0;
    let ultimoSalvo = Date.now();
    async function trabalhador() {
      while (i < nomes.length) {
        const nome = nomes[i++];
        try {
          const m = await metadados(nome);
          if (m.md5 && estado[nome] === m.md5) { pulados++; continue; }
          const corpo = await baixar(nome);
          const r = await sb.storage.from(BUCKET_SB).upload(B.chaveStorage(nome), corpo, { contentType: m.tipo, upsert: true });
          if (r.error) throw new Error(r.error.message);
          estado[nome] = m.md5 || String(corpo.length);
          feitos++;
          bytes += corpo.length;
        } catch (e) {
          erros.push(nome + ": " + (e && e.message));
        }
        if (Date.now() - ultimoSalvo > 10000) { gravarEstado(estado); ultimoSalvo = Date.now(); }
        process.stdout.write("\rcopiados " + feitos + " · já estavam " + pulados + " · erros " + erros.length
          + " · " + Math.round(bytes / 1048576) + " MB   ");
      }
    }
    await Promise.all(Array.from({ length: PARALELO }, trabalhador));
    gravarEstado(estado);
    process.stdout.write("\n");
    console.log("Copiados: " + feitos + " (" + Math.round(bytes / 1048576) + " MB). Já estavam iguais: " + pulados + ". Erros: " + erros.length + ".");
    erros.slice(0, 50).forEach((e) => console.log("  erro: " + e));
    if (erros.length > 50) console.log("  ... e mais " + (erros.length - 50));
  }

  if (arg("conferir")) {
    console.log("Conferência por pasta (Firebase x Supabase):");
    let diferencas = 0;
    for (const p of Object.keys(porPasta).sort()) {
      const chavesFb = new Set(nomes.filter((n) => pasta(n) === p).map((n) => B.chaveStorage(n)));
      const noSb = p === "(raiz)" ? null : await contarSupabase(sb, B.chaveStorage(p));
      const ok = noSb === null || noSb >= chavesFb.size;
      if (!ok) diferencas++;
      console.log("  " + (ok ? "ok    " : "FALTA ") + p + ": Firebase " + chavesFb.size + " · Supabase " + (noSb === null ? "?" : noSb));
    }
    console.log(diferencas ? diferencas + " pasta(s) com arquivo faltando." : "Todas as pastas conferem.");
  }

  if (arg("reescrever")) {
    if (SECO) { console.log("--reescrever não roda com --seco."); return; }
    const r = await sb.rpc("reescrever_urls_storage");
    if (r.error) throw new Error("reescrever_urls_storage: " + r.error.message);
    const linhas = r.data || [];
    console.log("Links antigos trocados por /arquivo?p=...: " + (linhas.length ? "" : "nenhum"));
    linhas.forEach((l) => console.log("  " + l.tabela + "." + l.coluna + ": " + l.linhas + " linha(s)"));
  }
}

principal().catch((e) => {
  console.error("Falhou: " + ((e && e.message) || e));
  process.exit(1);
});
