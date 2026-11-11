// Aviso no topo do Integra:
// - para o administrador, quando a branch develop (ambiente de teste) tem alterações que ainda não estão na produção;
// - para todos, quando a página aberta é o próprio ambiente de teste.
// Lê o repositório público mouraleite/integra pela API do GitHub (sem senha). Guarda a resposta por 10 minutos.
(function () {
  const REPO = "mouraleite/integra";
  const URL_TESTE = "https://crm-gestao-git-develop-crm-mldu.vercel.app/";
  const URL_PRODUCAO = "https://crm-gestao.vercel.app/";
  const CACHE = "integra_develop_compare_v2";
  const DISPENSADO = "integra_develop_dispensado";
  const TEMPO_CACHE = 10 * 60 * 1000;
  let dados = null;
  let iniciou = false;

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function ler(chave, store) {
    try { return (store || localStorage).getItem(chave); } catch (e) { return null; }
  }

  function gravar(chave, valor, store) {
    try { (store || localStorage).setItem(chave, valor); } catch (e) {}
  }

  function ambienteDeTeste() {
    return String(location.hostname || "").toLowerCase().indexOf("crm-gestao-git-develop") === 0;
  }

  function ehAdmin() {
    // Administrador de verdade ou quem ligou "Ver como administrador".
    try {
      if (typeof window.crmAdministradorReal === "function" && window.crmAdministradorReal()) return true;
      if (typeof window.crmVerComoAdmin === "function" && window.crmVerComoAdmin()) return true;
      return typeof window.isCrmSuperAdmin === "function" && !!window.isCrmSuperAdmin();
    } catch (e) {
      return false;
    }
  }

  function estilo() {
    if (document.getElementById("avdev-style")) return;
    const st = document.createElement("style");
    st.id = "avdev-style";
    st.textContent = [
      ".avdev-barra{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:9px 14px;margin:0 0 12px;border-radius:8px;font-size:.84rem;}",
      ".avdev-barra.alteracoes{background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;}",
      ".avdev-barra.teste{background:#eff6ff;border:1px solid #93c5fd;color:#1e3a8a;}",
      ".avdev-barra strong{font-weight:700;}",
      ".avdev-barra .avdev-acoes{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;}",
      ".avdev-btn{border:1px solid currentColor;background:#fff;color:inherit;border-radius:6px;padding:4px 10px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:none;}",
      ".avdev-btn.forte{background:#c2410c;border-color:#c2410c;color:#fff;}",
      ".avdev-fundo{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;}",
      ".avdev-modal{background:#fff;border-radius:10px;max-width:820px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:calc(100vh - 80px);}",
      ".avdev-modal header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e8f0;}",
      ".avdev-modal header h2{margin:0;font-size:1.05rem;color:#105436;}",
      ".avdev-corpo{padding:14px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px;font-size:.86rem;color:#1e293b;}",
      ".avdev-item{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;}",
      ".avdev-item h3{margin:0 0 4px;font-size:.92rem;color:#0f172a;}",
      ".avdev-item .avdev-meta{font-size:.74rem;color:#64748b;margin-bottom:6px;}",
      ".avdev-item pre{white-space:pre-wrap;font-family:inherit;margin:0;color:#334155;}",
      ".avdev-arqs{margin:0;padding-left:18px;font-size:.78rem;color:#475569;columns:2;}",
      ".avdev-passos{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;}",
      ".avdev-passos ol{margin:6px 0 0;padding-left:18px;}",
      ".avdev-alt{display:inline-flex;align-items:center;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:99px;padding:2px;gap:2px;flex-shrink:0;}",
      ".avdev-alt a{position:relative;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:99px;font-size:.76rem;font-weight:700;color:#475569;text-decoration:none;white-space:nowrap;}",
      ".avdev-alt a:hover{background:#e2e8f0;}",
      ".avdev-alt a.on.prod{background:#105436;color:#fff;cursor:default;}",
      ".avdev-alt a.on.teste{background:#2563eb;color:#fff;cursor:default;}",
      ".avdev-alt .avdev-ponto{width:8px;height:8px;border-radius:50%;background:#f97316;box-shadow:0 0 0 2px #fff;}",
      "@media (max-width:640px){.avdev-arqs{columns:1;}.avdev-alt a{padding:5px 8px;}}"
    ].join("");
    document.head.appendChild(st);
  }

  function lugar() {
    const main = document.querySelector("main.main-content");
    if (!main) return null;
    let box = document.getElementById("avdev-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "avdev-box";
      main.insertBefore(box, main.firstChild);
    }
    return box;
  }

  function nomeArquivoStatus(s) {
    return { added: "novo", removed: "removido", modified: "alterado", renamed: "renomeado" }[s] || s;
  }

  function alteracoesUteis(cmp) {
    return (cmp.commits || []).filter((c) => !(c.parents && c.parents.length > 1));
  }

  function fmtData(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function abrirResumo() {
    if (!dados) return;
    estilo();
    const lista = alteracoesUteis(dados).slice().reverse();
    const itens = lista.map((c) => {
      const msg = String((c.commit && c.commit.message) || "").trim();
      const titulo = msg.split("\n")[0];
      const resto = msg.split("\n").slice(1).join("\n").trim();
      const autor = (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || "";
      const quando = c.commit && c.commit.author && c.commit.author.date;
      return `<div class="avdev-item">
        <h3>${esc(titulo)}</h3>
        <div class="avdev-meta">${esc(autor)}${quando ? " • " + esc(fmtData(quando)) : ""}</div>
        ${resto ? `<pre>${esc(resto)}</pre>` : ""}
      </div>`;
    }).join("");
    const arqs = (dados.files || []).map((f) => `<li>${esc(f.filename)} <span style="color:#94a3b8;">(${esc(nomeArquivoStatus(f.status))})</span></li>`).join("");
    const fundo = document.createElement("div");
    fundo.className = "avdev-fundo";
    fundo.innerHTML = `<div class="avdev-modal" role="dialog" aria-modal="true">
      <header><h2>Alterações no ambiente de teste (ainda fora da produção)</h2><button type="button" class="avdev-btn" data-fechar>Fechar</button></header>
      <div class="avdev-corpo">
        ${itens || "<p>Nenhuma descrição disponível.</p>"}
        ${arqs ? `<div><strong>Arquivos mexidos (${(dados.files || []).length})</strong><ul class="avdev-arqs">${arqs}</ul></div>` : ""}
        <div class="avdev-passos">
          <strong>Como levar para a produção</strong>
          <ol>
            <li>Teste no <a href="${URL_TESTE}" target="_blank" rel="noopener">ambiente de teste</a> (usa os dados reais).</li>
            <li>Se estiver tudo certo, peça ao Claude: <b>"juntar develop na main"</b>.</li>
            <li>Rode o <b>deploy.bat</b>.</li>
          </ol>
        </div>
      </div>
    </div>`;
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo || (e.target && e.target.hasAttribute && e.target.hasAttribute("data-fechar"))) fundo.remove();
    });
    document.body.appendChild(fundo);
  }

  // Seletor "Produção | Teste" na barra do topo, só para administradores. Abre a mesma tela no outro ambiente.
  function pintarAlternador() {
    const barra = document.querySelector(".topbar-actions.topbar-support-wrap") || document.querySelector(".topbar-actions");
    let alt = document.getElementById("avdev-alt");
    if (!barra || !ehAdmin()) {
      if (alt) alt.remove();
      return;
    }
    const caminho = location.pathname.replace(/^\//, "") + location.search + location.hash;
    const teste = ambienteDeTeste();
    const pendentes = dados ? alteracoesUteis(dados).length : 0;
    if (!alt) {
      alt = document.createElement("div");
      alt.id = "avdev-alt";
      alt.className = "avdev-alt";
      barra.insertBefore(alt, barra.firstChild);
    }
    const vp = dados && dados.versaoProducao;
    const vt = dados && dados.versaoBaseTeste;
    const rotuloProd = "Produção" + (vp ? " v" + vp : "");
    const rotuloTeste = "Teste" + (vt ? " v" + vt : "") + (pendentes ? " +" + pendentes : "");
    let tituloTeste = teste ? "Você está no ambiente de teste" : "Abrir esta tela no ambiente de teste";
    if (pendentes) tituloTeste += " • " + pendentes + (pendentes === 1 ? " alteração" : " alterações") + " ainda fora da produção";
    else if (dados && dados.atrasadoPor) tituloTeste += " • ainda sem as últimas versões da produção (atualiza no próximo deploy)";
    else if (dados) tituloTeste += " • igual à produção";
    alt.innerHTML = `<a class="prod${teste ? "" : " on"}" ${teste ? `href="${URL_PRODUCAO + esc(caminho)}"` : ""} title="${teste ? "Abrir esta tela na produção" : "Você está na produção"}"><i data-lucide="globe" style="width:13px;height:13px;"></i>${esc(rotuloProd)}</a>`
      + `<a class="teste${teste ? " on" : ""}" ${teste ? "" : `href="${URL_TESTE + esc(caminho)}"`} title="${esc(tituloTeste)}"><i data-lucide="flask-conical" style="width:13px;height:13px;"></i>${esc(rotuloTeste)}${pendentes && !teste ? '<span class="avdev-ponto"></span>' : ""}</a>`;
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(alt);
    else if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  function pintar() {
    pintarAlternador();
    const box = lugar();
    if (!box) return;
    estilo();
    let html = "";
    if (ambienteDeTeste()) {
      html += `<div class="avdev-barra teste"><span><strong>Ambiente de teste.</strong> Esta não é a produção, mas os dados são reais (Sienge e banco do Integra): o que for gravado aqui vale de verdade.</span></div>`;
    }
    if (dados && !ambienteDeTeste() && ehAdmin()) {
      const lista = alteracoesUteis(dados);
      const topo = dados.commits && dados.commits.length ? dados.commits[dados.commits.length - 1].sha : "";
      if (lista.length && ler(DISPENSADO) !== topo) {
        const autores = Array.from(new Set(lista.map((c) => (c.commit && c.commit.author && c.commit.author.name) || ""))).filter(Boolean).join(", ");
        html += `<div class="avdev-barra alteracoes">
          <span><strong>Há ${lista.length} ${lista.length === 1 ? "alteração" : "alterações"} no ambiente de teste</strong> que ainda não ${lista.length === 1 ? "está" : "estão"} na produção${autores ? " (" + esc(autores) + ")" : ""}. Quer ver antes de levar para a produção?</span>
          <span class="avdev-acoes">
            <button type="button" class="avdev-btn forte" data-avdev="resumo">Ver o que mudou</button>
            <a class="avdev-btn" href="${URL_TESTE}" target="_blank" rel="noopener">Abrir o ambiente de teste</a>
            <button type="button" class="avdev-btn" data-avdev="dispensar" data-sha="${esc(topo)}">Dispensar</button>
          </span>
        </div>`;
      }
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-avdev]").forEach((b) => {
      b.onclick = () => {
        const acao = b.getAttribute("data-avdev");
        if (acao === "resumo") abrirResumo();
        if (acao === "dispensar") { gravar(DISPENSADO, b.getAttribute("data-sha") || ""); pintar(); }
      };
    });
  }

  async function consultar() {
    const guardado = ler(CACHE, sessionStorage);
    if (guardado) {
      try {
        const g = JSON.parse(guardado);
        if (g && Date.now() - g.em < TEMPO_CACHE) { dados = g.dados; return; }
      } catch (e) {}
    }
    const opts = { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" };
    const [res, resMain] = await Promise.all([
      fetch("https://api.github.com/repos/" + REPO + "/compare/main...develop", opts),
      fetch("https://api.github.com/repos/" + REPO + "/commits/main", opts).catch(() => null)
    ]);
    if (!res.ok) return;
    const j = await res.json();
    let main = null;
    try { main = resMain && resMain.ok ? await resMain.json() : null; } catch (e) { main = null; }
    const versao = (msg) => { const m = /v1\.0\.(\d+)/.exec(String(msg || "")); return m ? Number(m[1]) : 0; };
    dados = {
      commits: (j.commits || []).map((c) => ({ sha: c.sha, parents: c.parents, commit: { message: c.commit && c.commit.message, author: c.commit && c.commit.author }, author: c.author ? { login: c.author.login } : null })),
      files: (j.files || []).map((f) => ({ filename: f.filename, status: f.status })),
      // Versão da produção = último "v1.0.XXXX" da main; base do teste = última versão da main que a develop já contém.
      versaoProducao: versao(main && main.commit && main.commit.message),
      versaoBaseTeste: versao(j.merge_base_commit && j.merge_base_commit.commit && j.merge_base_commit.commit.message),
      atrasadoPor: Number(j.behind_by) || 0
    };
    gravar(CACHE, JSON.stringify({ em: Date.now(), dados }), sessionStorage);
  }

  async function ciclo() {
    try {
      if (ehAdmin()) await consultar();
    } catch (e) {}
    pintar();
  }

  function iniciar() {
    if (iniciou) return;
    iniciou = true;
    ciclo();
    setInterval(ciclo, TEMPO_CACHE);
    // Liga/desliga na hora quando a pessoa ativa ou sai do "Ver como administrador".
    let eraAdmin = ehAdmin();
    setInterval(() => {
      const agora = ehAdmin();
      if (agora !== eraAdmin) {
        eraAdmin = agora;
        ciclo();
      }
    }, 2000);
  }

  // Espera o login carregar (o perfil de administrador só é conhecido depois dele).
  let tentativas = 0;
  const espera = setInterval(() => {
    tentativas++;
    const logado = typeof window.crmUsuarioAcesso === "function" && window.crmUsuarioAcesso();
    if (logado || tentativas > 60) {
      clearInterval(espera);
      iniciar();
    }
  }, 2000);

  window.IntegraAvisoDevelop = { atualizar: () => { try { sessionStorage.removeItem(CACHE); } catch (e) {} ciclo(); }, abrirResumo };
})();
