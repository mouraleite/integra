/* Publica na produção um pedido "Encaminhar para produção" aprovado pelo administrador.
   Faz o mesmo que "juntar <branch> na main" + deploy.bat, direto no GitHub:
   1) junta na main exatamente o commit que o desenvolvedor enviou (o que o administrador viu);
   2) sobe a versão do index.html (selo vX.Y.Z e os ?v= dos scripts), igual ao _version_bump.ps1;
   3) cria a tag da versão;
   4) avança as branches de teste que estão iguais à main (como o passo 6 do deploy.bat).
   A Vercel publica sozinha quando a main muda.

   Segurança: só aceita quem está logado no Integra (token do Entra ID) E tem perfil ADMINISTRADOR
   no cadastro de usuários. Precisa da variável GITHUB_PUBLICAR_TOKEN na Vercel (token do GitHub
   com permissão "Contents: Read and write" só no repositório integra). */
const https = require("https");
const { conferirAcesso } = require("../../lib/integra-auth");

const REPO = "mouraleite/integra";
const BRANCHES_TESTE = ["develop", "Marcelo", "lucelia"];
const FIRESTORE = "https://firestore.googleapis.com/v1/projects/crm-gestao-mldu/databases/(default)/documents";

function responder(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function lerBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let tamanho = 0;
    req.on("data", (c) => {
      tamanho += c.length;
      if (tamanho > 20000) { reject(new Error("Pedido grande demais.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(new Error("Pedido inválido.")); }
    });
    req.on("error", reject);
  });
}

function pedir(url, opcoes, corpo) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, Object.assign({ timeout: 20000 }, opcoes), (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        const texto = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = null; }
        resolve({ status: resp.statusCode, json, texto });
      });
    });
    r.on("timeout", () => r.destroy(new Error("Tempo esgotado.")));
    r.on("error", reject);
    if (corpo) r.write(corpo);
    r.end();
  });
}

function github(metodo, caminho, dados) {
  const corpo = dados ? JSON.stringify(dados) : null;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + process.env.GITHUB_PUBLICAR_TOKEN,
    "User-Agent": "integra-publicar",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (corpo) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(corpo);
  }
  return pedir("https://api.github.com/repos/" + REPO + caminho, { method: metodo, headers }, corpo);
}

// Lê um documento do Firestore (formato REST) e devolve um objeto simples.
function valorFs(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) {
    const o = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(f).forEach((k) => { o[k] = valorFs(f[k]); });
    return o;
  }
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(valorFs);
  return null;
}

async function lerDoc(caminho) {
  const r = await pedir(FIRESTORE + "/" + caminho, { method: "GET", headers: { Accept: "application/json" } });
  if (r.status !== 200 || !r.json || !r.json.fields) return null;
  return valorFs({ mapValue: { fields: r.json.fields } });
}

function normal(s) {
  return String(s || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function ehAdministrador(email) {
  const doc = await lerDoc("config/crm_users");
  if (!doc) return false;
  let lista = doc.list || doc.crm_users || "[]";
  if (typeof lista === "string") {
    try { lista = JSON.parse(lista); } catch (e) { lista = []; }
  }
  if (!Array.isArray(lista)) return false;
  const alvo = String(email || "").toLowerCase().trim();
  const u = lista.find((x) => x && (String(x.email || "").toLowerCase().trim() === alvo
    || String(x.login_email || "").toLowerCase().trim() === alvo));
  if (!u) return false;
  if (normal(u.status || "ATIVO") === "INATIVO") return false;
  return normal(u.profile_name) === "ADMINISTRADOR";
}

function hojeBrasil() {
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  return p; // dd/mm/aaaa
}

// Mesma regra do _version_bump.ps1.
function subirVersao(html) {
  const m = /v(\d+)\.(\d+)\.(\d+)\s*&nbsp;/.exec(html);
  if (!m) throw new Error("Não achei a versão (vX.X.X) no index.html.");
  const patch = Number(m[3]) + 1;
  const nova = m[1] + "." + m[2] + "." + patch;
  const hoje = hojeBrasil();
  let out = html.replace(/v\d+\.\d+\.\d+\s*&nbsp;.+?\d{2}\/\d{2}\/\d{4}/, "v" + nova + " &nbsp;&middot;&nbsp; " + hoje);
  out = out.replace(/\?v=\d+/g, "?v=" + patch);
  return { html: out, versao: nova, hoje };
}

module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") return responder(res, 405, { error: "Somente POST." });

  const acesso = await conferirAcesso(req);
  if (!acesso.ok || acesso.motivo !== "ok") return responder(res, 401, { error: "Faça login no Integra para publicar." });
  if (!(await ehAdministrador(acesso.email))) return responder(res, 403, { error: "Só o administrador pode publicar na produção." });
  if (!process.env.GITHUB_PUBLICAR_TOKEN) {
    return responder(res, 503, { error: "A publicação automática ainda não está configurada (falta GITHUB_PUBLICAR_TOKEN na Vercel).", naoConfigurado: true });
  }

  let body;
  try { body = await lerBody(req); } catch (e) { return responder(res, 400, { error: e.message }); }
  const id = String((body && body.solicitacao) || "").trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return responder(res, 400, { error: "Solicitação inválida." });

  const sol = await lerDoc("solicitacoes_producao/" + id);
  if (!sol) return responder(res, 404, { error: "Solicitação não encontrada." });
  if (sol.status !== "pendente") return responder(res, 409, { error: "Esta solicitação já foi decidida (" + sol.status + ")." });
  const branch = String(sol.branch || "");
  const sha = String(sol.sha || "");
  if (BRANCHES_TESTE.indexOf(branch) < 0) return responder(res, 400, { error: "Branch não permitida." });
  if (!/^[0-9a-f]{40}$/.test(sha)) return responder(res, 400, { error: "A solicitação não tem o código da versão enviada." });

  // O commit pedido precisa ser da branch do desenvolvedor (não aceita commit de outro lugar).
  const cmp = await github("GET", "/compare/" + sha + "..." + encodeURIComponent(branch));
  if (cmp.status !== 200 || !cmp.json || (cmp.json.status !== "identical" && cmp.json.status !== "ahead")) {
    return responder(res, 409, { error: "O que foi pedido não está mais na branch " + branch + ". Peça para o desenvolvedor encaminhar de novo." });
  }

  const quem = String(sol.solicitante && (sol.solicitante.nome || sol.solicitante.email) || "desenvolvedor");
  const mensagem = "Junta " + branch + " na produção (pedido de " + quem + ", aprovado por " + acesso.email + ")";
  // 1) junta na main
  let merge = await github("POST", "/merges", { base: "main", head: sha, commit_message: mensagem });
  // Conflito com a produção: se depois do pedido a branch só recebeu atualizações com a produção
  // (commits de "merge", nenhuma alteração nova do desenvolvedor), usa a branch já atualizada.
  if (merge.status === 409 && cmp.json.status === "ahead") {
    // Alterações do desenvolvedor (commits que não são "merge") que ainda não estão na produção:
    // precisam ser exatamente as mesmas no pedido e na ponta da branch.
    const proprios = async (ref) => {
      const r = await github("GET", "/compare/main..." + encodeURIComponent(ref));
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.commits)) return null;
      return r.json.commits.filter((c) => !(Array.isArray(c.parents) && c.parents.length > 1)).map((c) => c.sha).sort().join(",");
    };
    const depois = Array.isArray(cmp.json.commits) ? cmp.json.commits : [];
    const ponta = depois.length ? depois[depois.length - 1].sha : "";
    const doPedido = await proprios(sha);
    const daPonta = /^[0-9a-f]{40}$/.test(ponta) ? await proprios(ponta) : null;
    if (doPedido && daPonta !== null && doPedido === daPonta) {
      merge = await github("POST", "/merges", { base: "main", head: ponta, commit_message: mensagem });
    }
  }
  if (merge.status === 409) {
    return responder(res, 409, { error: "As alterações de " + branch + " batem de frente com o que já está na produção. Peça ao Claude: \"juntar " + branch + " na main\" e rode o deploy.bat.", conflito: true });
  }
  if (merge.status !== 201 && merge.status !== 204) {
    console.warn("[publicar] merge", merge.status, merge.texto && merge.texto.slice(0, 300));
    return responder(res, 502, { error: "O GitHub não aceitou juntar na produção (código " + merge.status + ")." });
  }

  // 2) sobe a versão do index.html (tenta 3 vezes se alguém publicar ao mesmo tempo)
  let versao = "";
  let commitFinal = "";
  for (let tentativa = 0; tentativa < 3 && !commitFinal; tentativa++) {
    const arq = await github("GET", "/contents/index.html?ref=main");
    if (arq.status !== 200 || !arq.json || !arq.json.content) {
      return responder(res, 502, { error: "Juntei na produção, mas não consegui ler o index.html para subir a versão. Rode o deploy.bat.", juntou: true });
    }
    let novo;
    try { novo = subirVersao(Buffer.from(arq.json.content, "base64").toString("utf8")); } catch (e) {
      return responder(res, 502, { error: "Juntei na produção, mas " + e.message + " Rode o deploy.bat.", juntou: true });
    }
    const put = await github("PUT", "/contents/index.html", {
      message: "v" + novo.versao + " - " + novo.hoje,
      content: Buffer.from(novo.html, "utf8").toString("base64"),
      sha: arq.json.sha,
      branch: "main"
    });
    if (put.status === 200 || put.status === 201) {
      versao = novo.versao;
      commitFinal = put.json && put.json.commit && put.json.commit.sha;
    } else if (put.status !== 409) {
      console.warn("[publicar] versão", put.status, put.texto && put.texto.slice(0, 300));
      return responder(res, 502, { error: "Juntei na produção, mas não consegui subir a versão (código " + put.status + "). Rode o deploy.bat.", juntou: true });
    }
  }
  if (!commitFinal) return responder(res, 502, { error: "Juntei na produção, mas outra publicação estava acontecendo. Rode o deploy.bat.", juntou: true });

  // 3) tag da versão (se falhar, não atrapalha a publicação)
  try { await github("POST", "/git/refs", { ref: "refs/tags/v" + versao, sha: commitFinal }); } catch (e) {}

  // 4) avança as branches de teste que não têm nada fora da main (só avanço, nunca sobrescreve)
  const testes = {};
  for (const b of BRANCHES_TESTE) {
    try {
      const r = await github("PATCH", "/git/refs/heads/" + encodeURIComponent(b), { sha: commitFinal, force: false });
      testes[b] = r.status === 200 ? "atualizada" : "tem alterações fora da produção";
    } catch (e) {
      testes[b] = "não atualizada";
    }
  }

  return responder(res, 200, { publicado: true, versao, commit: commitFinal, branch, testes });
};
