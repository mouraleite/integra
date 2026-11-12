// Aviso no topo do Integra, um por ambiente de teste (cada desenvolvedor tem a sua branch e o seu endereço):
// - para o administrador, quando a branch de teste tem alterações que ainda não estão na produção;
// - para todos, quando a página aberta é um ambiente de teste.
// Lê o repositório público mouraleite/integra pela API do GitHub (sem senha). Confere a cada 5 minutos e ao voltar para a aba (consulta condicional; só com a aba visível).
// Para um novo desenvolvedor: acrescentar uma linha em AMBIENTES e cadastrar o endereço no Entra ID (SPA).
(function () {
  const REPO = "mouraleite/integra";
  const URL_PRODUCAO = "https://crm-gestao.vercel.app/";
  const AMBIENTES = [
    { chave: "dani", nome: "Teste Dani", pessoa: "da Dani", branch: "develop", host: "crm-gestao-git-develop-", url: "https://crm-gestao-git-develop-crm-mldu.vercel.app/", cor: "#2563eb" },
    { chave: "marcelo", nome: "Teste Marcelo", pessoa: "do Marcelo", branch: "Marcelo", host: "crm-gestao-git-marcelo-", url: "https://crm-gestao-git-marcelo-crm-mldu.vercel.app/", cor: "#7c3aed" }
  ];
  const INTERVALO = 5 * 60 * 1000;
  const dados = {}; // chave do ambiente -> dados da comparação com a main (null se a branch não existir)
  let versaoProducao = 0;
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

  function chaveDispensado(amb) {
    // A Dani mantém a chave antiga para não reaparecer um aviso já dispensado.
    return amb.chave === "dani" ? "integra_develop_dispensado" : "integra_teste_dispensado_" + amb.chave;
  }

  // Ambiente de teste aberto nesta página (ou null na produção).
  function ambienteAtual() {
    const host = String(location.hostname || "").toLowerCase();
    return AMBIENTES.find((a) => host.indexOf(a.host) === 0) || null;
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
      ".avdev-alt a.on{color:#fff;cursor:default;}",
      ".avdev-alt a.on.prod{background:#105436;}",
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
    return ((cmp && cmp.commits) || []).filter((c) => !(c.parents && c.parents.length > 1));
  }

  function fmtData(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function abrirResumo(chave) {
    const amb = AMBIENTES.find((a) => a.chave === chave) || AMBIENTES[0];
    const d = dados[amb.chave];
    if (!d) return;
    estilo();
    const lista = alteracoesUteis(d).slice().reverse();
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
    const arqs = (d.files || []).map((f) => `<li>${esc(f.filename)} <span style="color:#94a3b8;">(${esc(nomeArquivoStatus(f.status))})</span></li>`).join("");
    const fundo = document.createElement("div");
    fundo.className = "avdev-fundo";
    fundo.innerHTML = `<div class="avdev-modal" role="dialog" aria-modal="true">
      <header><h2>Alterações no ambiente de teste ${esc(amb.pessoa)} (ainda fora da produção)</h2><button type="button" class="avdev-btn" data-fechar>Fechar</button></header>
      <div class="avdev-corpo">
        ${itens || "<p>Nenhuma descrição disponível.</p>"}
        ${arqs ? `<div><strong>Arquivos mexidos (${(d.files || []).length})</strong><ul class="avdev-arqs">${arqs}</ul></div>` : ""}
        <div class="avdev-passos">
          <strong>Como levar para a produção</strong>
          <ol>
            <li>Teste no <a href="${esc(amb.url)}" target="_blank" rel="noopener">ambiente de teste ${esc(amb.pessoa)}</a> (usa os dados reais).</li>
            <li>Se estiver tudo certo, peça ao Claude: <b>"juntar ${esc(amb.branch)} na main"</b>.</li>
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

  // Seletor "Produção | Teste Dani | Teste Marcelo" na barra do topo, só para administradores. Abre a mesma tela no outro ambiente.
  function pintarAlternador() {
    const barra = document.querySelector(".topbar-actions.topbar-support-wrap") || document.querySelector(".topbar-actions");
    let alt = document.getElementById("avdev-alt");
    if (!barra || !ehAdmin()) {
      if (alt) alt.remove();
      return;
    }
    const caminho = location.pathname.replace(/^\//, "") + location.search + location.hash;
    const atual = ambienteAtual();
    if (!alt) {
      alt = document.createElement("div");
      alt.id = "avdev-alt";
      alt.className = "avdev-alt";
      barra.insertBefore(alt, barra.firstChild);
    }
    const naProd = !atual;
    let html = `<a class="prod${naProd ? " on" : ""}" ${naProd ? "" : `href="${URL_PRODUCAO + esc(caminho)}"`} title="${naProd ? "Você está na produção" : "Abrir esta tela na produção"}"><i data-lucide="globe" style="width:13px;height:13px;"></i>Produção${versaoProducao ? " v" + versaoProducao : ""}</a>`;
    AMBIENTES.forEach((amb) => {
      const d = dados[amb.chave];
      if (d === null) return; // branch não existe no GitHub
      const aqui = atual && atual.chave === amb.chave;
      const pendentes = d ? alteracoesUteis(d).length : 0;
      const rotulo = amb.nome + (d && d.versaoBase ? " v" + d.versaoBase : "") + (pendentes ? " +" + pendentes : "");
      let titulo = aqui ? "Você está no ambiente de teste " + amb.pessoa : "Abrir esta tela no ambiente de teste " + amb.pessoa;
      titulo += " (branch " + amb.branch + ")";
      if (pendentes) titulo += " • " + pendentes + (pendentes === 1 ? " alteração" : " alterações") + " ainda fora da produção";
      else if (d && d.atrasadoPor) titulo += " • ainda sem as últimas versões da produção";
      else if (d) titulo += " • igual à produção";
      html += `<a class="${aqui ? "on" : ""}" style="${aqui ? "background:" + amb.cor + ";" : ""}" ${aqui ? "" : `href="${esc(amb.url) + esc(caminho)}"`} title="${esc(titulo)}"><i data-lucide="flask-conical" style="width:13px;height:13px;${aqui ? "" : "color:" + amb.cor + ";"}"></i>${esc(rotulo)}${pendentes && !aqui ? '<span class="avdev-ponto"></span>' : ""}</a>`;
    });
    alt.innerHTML = html;
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(alt);
    else if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  function pintar() {
    pintarAlternador();
    const box = lugar();
    if (!box) return;
    estilo();
    const atual = ambienteAtual();
    let html = "";
    if (atual) {
      html += `<div class="avdev-barra teste" style="border-color:${atual.cor};"><span><strong>Ambiente de teste ${esc(atual.pessoa)}</strong> (branch ${esc(atual.branch)}). Esta não é a produção, mas os dados são reais (Sienge e banco do Integra): o que for gravado aqui vale de verdade.</span></div>`;
    }
    if (!atual && ehAdmin()) {
      AMBIENTES.forEach((amb) => {
        const d = dados[amb.chave];
        if (!d) return;
        const lista = alteracoesUteis(d);
        const topo = d.commits && d.commits.length ? d.commits[d.commits.length - 1].sha : "";
        if (!lista.length || ler(chaveDispensado(amb)) === topo) return;
        html += `<div class="avdev-barra alteracoes">
          <span><strong>Há ${lista.length} ${lista.length === 1 ? "alteração" : "alterações"} no ambiente de teste ${esc(amb.pessoa)}</strong> que ainda não ${lista.length === 1 ? "está" : "estão"} na produção. Quer ver antes de levar para a produção?</span>
          <span class="avdev-acoes">
            <button type="button" class="avdev-btn forte" data-avdev="resumo" data-amb="${esc(amb.chave)}">Ver o que mudou</button>
            <a class="avdev-btn" href="${esc(amb.url)}" target="_blank" rel="noopener">Abrir o ${esc(amb.nome)}</a>
            <button type="button" class="avdev-btn" data-avdev="dispensar" data-amb="${esc(amb.chave)}" data-sha="${esc(topo)}">Dispensar</button>
          </span>
        </div>`;
      });
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-avdev]").forEach((b) => {
      b.onclick = () => {
        const acao = b.getAttribute("data-avdev");
        const chave = b.getAttribute("data-amb");
        const amb = AMBIENTES.find((a) => a.chave === chave);
        if (acao === "resumo") abrirResumo(chave);
        if (acao === "dispensar" && amb) { gravar(chaveDispensado(amb), b.getAttribute("data-sha") || ""); pintar(); }
      };
    });
  }

  // Pergunta ao GitHub com o "ETag" da última resposta: se nada mudou, ele responde 304.
  // Devolve undefined quando a branch não existe (404).
  async function pedir(url, reduzir) {
    const chave = "integra_gh_" + url;
    let salvo = null;
    try { salvo = JSON.parse(ler(chave, sessionStorage) || "null"); } catch (e) { salvo = null; }
    const headers = { Accept: "application/vnd.github+json" };
    if (salvo && salvo.etag) headers["If-None-Match"] = salvo.etag;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 304 && salvo) return salvo.corpo;
    if (res.status === 404) return undefined;
    if (!res.ok) return salvo ? salvo.corpo : null;
    const corpo = reduzir(await res.json());
    gravar(chave, JSON.stringify({ etag: res.headers.get("ETag") || "", corpo }), sessionStorage);
    return corpo;
  }

  function versaoDaPagina() {
    const spans = document.querySelectorAll(".sidebar span, aside span, span");
    for (let i = 0; i < spans.length; i++) {
      const m = /^\s*v1\.0\.(\d+)/.exec(spans[i].textContent || "");
      if (m) return Number(m[1]);
    }
    return 0;
  }

  async function consultar() {
    const base = "https://api.github.com/repos/" + REPO;
    const versao = (msg) => { const m = /v1\.0\.(\d+)/.exec(String(msg || "")); return m ? Number(m[1]) : 0; };
    for (const amb of AMBIENTES) {
      try {
        const cmp = await pedir(base + "/compare/main..." + encodeURIComponent(amb.branch), (j) => ({
          commits: (j.commits || []).map((c) => ({ sha: c.sha, parents: c.parents, commit: { message: c.commit && c.commit.message, author: c.commit && c.commit.author }, author: c.author ? { login: c.author.login } : null })),
          files: (j.files || []).map((f) => ({ filename: f.filename, status: f.status })),
          baseMsg: j.merge_base_commit && j.merge_base_commit.commit && j.merge_base_commit.commit.message,
          atrasadoPor: Number(j.behind_by) || 0
        }));
        if (cmp === undefined) { dados[amb.chave] = null; continue; }
        if (!cmp) continue; // falha temporária: mantém o que já tinha
        dados[amb.chave] = {
          commits: cmp.commits,
          files: cmp.files,
          // Base do teste = última versão da produção que a branch já contém.
          versaoBase: versao(cmp.baseMsg),
          atrasadoPor: cmp.atrasadoPor
        };
      } catch (e) {}
    }
    // Na produção, a versão é a da própria página (rodapé do menu). No teste, pergunta ao GitHub.
    let vp = ambienteAtual() ? 0 : versaoDaPagina();
    if (!vp) {
      const main = await pedir(base + "/commits/main", (j) => ({ msg: j.commit && j.commit.message })).catch(() => null);
      vp = versao(main && main.msg);
    }
    if (vp) versaoProducao = vp;
  }

  let ultimaConsulta = 0;

  async function ciclo() {
    try {
      // Sem login no GitHub o limite é 60 consultas/hora por rede: só consulta com a aba visível.
      if (ehAdmin() && document.visibilityState !== "hidden") {
        ultimaConsulta = Date.now();
        await consultar();
      }
    } catch (e) {}
    pintar();
  }

  function iniciar() {
    if (iniciou) return;
    iniciou = true;
    ciclo();
    setInterval(ciclo, INTERVALO);
    // Ao voltar para a aba do Integra, confere na hora (no máximo 1 vez a cada 2 min).
    const aoVoltar = () => {
      if (document.visibilityState === "hidden" || Date.now() - ultimaConsulta < 120000) return;
      ciclo();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
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

  window.IntegraAvisoDevelop = { atualizar: () => ciclo(), abrirResumo };
})();
