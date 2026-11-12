// Ambientes de teste do Integra (cada desenvolvedor tem a sua branch e o seu endereço na Vercel).
// - Para o administrador: bolha "Produção | Testes" no topo; ao clicar em Testes abre a lista dos ambientes,
//   com o que cada um tem fora da produção. Na produção, uma faixa laranja única resume as alterações pendentes.
// - Para todos: faixa azul quando a página aberta é um ambiente de teste.
// Lê o repositório público mouraleite/integra pela API do GitHub (sem senha, limite de 60 consultas/hora por rede).
// A cada 5 minutos faz 1 consulta (lista de branches); a comparação com a main só é refeita quando uma branch muda.
// Para um novo desenvolvedor: acrescentar uma linha em AMBIENTES, cadastrar o endereço no Entra ID (SPA) e no deploy.bat.
(function () {
  const REPO = "mouraleite/integra";
  const URL_PRODUCAO = "https://crm-gestao.vercel.app/";
  const AMBIENTES = [
    { chave: "dani", nome: "Teste Dani", pessoa: "da Dani", branch: "develop", cor: "#2563eb" },
    { chave: "marcelo", nome: "Teste Marcelo", pessoa: "do Marcelo", branch: "Marcelo", cor: "#7c3aed" },
    { chave: "lucelia", nome: "Teste Lucélia", pessoa: "da Lucélia", branch: "lucelia", cor: "#0891b2" }
  ].map((a) => {
    const slug = a.branch.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return Object.assign(a, { host: "crm-gestao-git-" + slug + "-", url: "https://crm-gestao-git-" + slug + "-crm-mldu.vercel.app/" });
  });
  const DISPENSADO = "integra_testes_dispensado";
  const INTERVALO = 5 * 60 * 1000;
  const API = "https://api.github.com/repos/" + REPO;
  const dados = {}; // chave do ambiente -> comparação com a main; null = branch não existe
  let versaoProducao = 0;
  let menuAberto = false;
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

  function alteracoesUteis(cmp) {
    return ((cmp && cmp.commits) || []).filter((c) => !(c.parents && c.parents.length > 1));
  }

  function pendentesDe(amb) {
    return alteracoesUteis(dados[amb.chave]).length;
  }

  function comPendencia() {
    return AMBIENTES.filter((a) => pendentesDe(a) > 0);
  }

  function fmtData(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function caminhoAtual() {
    return location.pathname.replace(/^\//, "") + location.search + location.hash;
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
      ".avdev-btn{border:1px solid currentColor;background:#fff;color:inherit;border-radius:6px;padding:4px 10px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap;}",
      ".avdev-btn.forte{background:#c2410c;border-color:#c2410c;color:#fff;}",
      ".avdev-fundo{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;}",
      ".avdev-modal{background:#fff;border-radius:10px;max-width:820px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:calc(100vh - 80px);}",
      ".avdev-modal header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e8f0;}",
      ".avdev-modal header h2{margin:0;font-size:1.05rem;color:#105436;}",
      ".avdev-corpo{padding:14px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px;font-size:.86rem;color:#1e293b;}",
      ".avdev-amb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;padding-bottom:6px;border-bottom:2px solid currentColor;}",
      ".avdev-amb h3{margin:0;font-size:.98rem;}",
      ".avdev-amb span{font-size:.76rem;color:#64748b;}",
      ".avdev-item{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;}",
      ".avdev-item h4{margin:0 0 4px;font-size:.9rem;color:#0f172a;}",
      ".avdev-item .avdev-meta{font-size:.74rem;color:#64748b;margin-bottom:6px;}",
      ".avdev-item pre{white-space:pre-wrap;font-family:inherit;margin:0;color:#334155;}",
      ".avdev-arqs{margin:0;padding-left:18px;font-size:.78rem;color:#475569;columns:2;}",
      ".avdev-passos{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;}",
      ".avdev-passos ol{margin:6px 0 0;padding-left:18px;}",
      ".avdev-alt{position:relative;display:inline-flex;align-items:center;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:99px;padding:2px;gap:2px;flex-shrink:0;}",
      ".avdev-alt>a,.avdev-alt>button{position:relative;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:0;background:transparent;border-radius:99px;font-size:.76rem;font-weight:700;color:#475569;text-decoration:none;white-space:nowrap;cursor:pointer;font-family:inherit;}",
      ".avdev-alt>a:hover,.avdev-alt>button:hover{background:#e2e8f0;}",
      ".avdev-alt>.on{color:#fff;}",
      ".avdev-alt>a.on.prod{background:#105436;cursor:default;}",
      ".avdev-alt .avdev-ponto{width:8px;height:8px;border-radius:50%;background:#f97316;box-shadow:0 0 0 2px #fff;}",
      ".avdev-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:340px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,.16);z-index:1300;padding:6px;}",
      ".avdev-menu-tit{font-size:.7rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em;padding:6px 8px 4px;}",
      ".avdev-linha{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;}",
      ".avdev-linha:hover{background:#f8fafc;}",
      ".avdev-linha.aqui{background:#f1f5f9;}",
      ".avdev-linha .avdev-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}",
      ".avdev-linha .avdev-nome{font-size:.84rem;font-weight:700;color:#0f172a;white-space:nowrap;}",
      ".avdev-linha .avdev-sub{font-size:.74rem;color:#64748b;white-space:nowrap;}",
      ".avdev-linha .avdev-sub.pend{color:#c2410c;font-weight:600;}",
      ".avdev-linha .avdev-btn{padding:4px 8px;font-size:.74rem;color:#105436;}",
      "@media (max-width:640px){.avdev-arqs{columns:1;}.avdev-alt>a,.avdev-alt>button{padding:5px 8px;}.avdev-menu{min-width:280px;}}"
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

  // Resumo das alterações; sem chave = todos os ambientes com pendência.
  function abrirResumo(chave) {
    const lista = chave ? AMBIENTES.filter((a) => a.chave === chave) : comPendencia();
    if (!lista.length) return;
    estilo();
    const status = { added: "novo", removed: "removido", modified: "alterado", renamed: "renomeado" };
    const blocos = lista.map((amb) => {
      const d = dados[amb.chave];
      const commits = alteracoesUteis(d).slice().reverse();
      const itens = commits.map((c) => {
        const msg = String((c.commit && c.commit.message) || "").trim();
        const titulo = msg.split("\n")[0];
        const resto = msg.split("\n").slice(1).join("\n").trim();
        const autor = (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || "";
        const quando = c.commit && c.commit.author && c.commit.author.date;
        return `<div class="avdev-item"><h4>${esc(titulo)}</h4>
          <div class="avdev-meta">${esc(autor)}${quando ? " • " + esc(fmtData(quando)) : ""}</div>
          ${resto ? `<pre>${esc(resto)}</pre>` : ""}</div>`;
      }).join("");
      const arqs = ((d && d.files) || []).map((f) => `<li>${esc(f.filename)} <span style="color:#94a3b8;">(${esc(status[f.status] || f.status)})</span></li>`).join("");
      return `<div class="avdev-amb" style="color:${amb.cor};"><h3>${esc(amb.nome)}</h3><span>branch ${esc(amb.branch)}</span>
          <a class="avdev-btn" style="margin-left:auto;" href="${esc(amb.url + caminhoAtual())}" target="_blank" rel="noopener">Abrir o ${esc(amb.nome)}</a></div>
        ${itens || "<p>Nenhuma alteração fora da produção.</p>"}
        ${arqs ? `<div><strong>Arquivos mexidos (${d.files.length})</strong><ul class="avdev-arqs">${arqs}</ul></div>` : ""}`;
    }).join("");
    const juntar = lista.map((a) => `"juntar ${esc(a.branch)} na main"`).join(" ou ");
    const fundo = document.createElement("div");
    fundo.className = "avdev-fundo";
    fundo.innerHTML = `<div class="avdev-modal" role="dialog" aria-modal="true">
      <header><h2>Alterações nos ambientes de teste (ainda fora da produção)</h2><button type="button" class="avdev-btn" data-fechar>Fechar</button></header>
      <div class="avdev-corpo">
        ${blocos}
        <div class="avdev-passos">
          <strong>Como levar para a produção</strong>
          <ol>
            <li>Teste no ambiente de teste (usa os dados reais).</li>
            <li>Se estiver tudo certo, peça ao Claude: <b>${juntar}</b>.</li>
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

  function linhaMenu(amb, atual) {
    const d = dados[amb.chave];
    const aqui = atual && atual.chave === amb.chave;
    const pend = pendentesDe(amb);
    let sub;
    if (d === null) sub = "branch ainda não existe";
    else if (!d) sub = "consultando…";
    else if (pend) sub = pend + (pend === 1 ? " alteração" : " alterações") + " fora da produção";
    else if (d.atrasadoPor) sub = "sem alterações • falta atualizar com a produção";
    else sub = "igual à produção";
    const versao = d && d.versaoBase ? "v" + d.versaoBase + " • " : "";
    return `<div class="avdev-linha${aqui ? " aqui" : ""}">
      <i data-lucide="flask-conical" style="width:16px;height:16px;color:${amb.cor};flex-shrink:0;"></i>
      <div class="avdev-txt"><span class="avdev-nome">${esc(amb.nome)}${aqui ? " (você está aqui)" : ""}</span>
        <span class="avdev-sub${pend ? " pend" : ""}">${esc(versao + sub)}</span></div>
      ${pend ? `<button type="button" class="avdev-btn" data-avdev="resumo" data-amb="${esc(amb.chave)}">O que mudou</button>` : ""}
      ${aqui || d === null ? "" : `<a class="avdev-btn" href="${esc(amb.url + caminhoAtual())}" title="Abrir esta tela no ${esc(amb.nome)}">Abrir</a>`}
    </div>`;
  }

  // Bolha "Produção | Testes" na barra do topo, só para administradores.
  function pintarAlternador() {
    const barra = document.querySelector(".topbar-actions.topbar-support-wrap") || document.querySelector(".topbar-actions");
    let alt = document.getElementById("avdev-alt");
    if (!barra || !ehAdmin()) {
      if (alt) alt.remove();
      menuAberto = false;
      return;
    }
    if (!alt) {
      alt = document.createElement("div");
      alt.id = "avdev-alt";
      alt.className = "avdev-alt";
      barra.insertBefore(alt, barra.firstChild);
    }
    const atual = ambienteAtual();
    const naProd = !atual;
    const totalPend = AMBIENTES.reduce((s, a) => s + pendentesDe(a), 0);
    const rotuloTeste = atual ? atual.nome : "Testes" + (totalPend ? " +" + totalPend : "");
    const tituloTeste = totalPend
      ? comPendencia().map((a) => a.nome + ": " + pendentesDe(a)).join(" • ") + " fora da produção"
      : "Ambientes de teste sem alterações fora da produção";
    alt.innerHTML = `<a class="prod${naProd ? " on" : ""}" ${naProd ? "" : `href="${URL_PRODUCAO + esc(caminhoAtual())}"`} title="${naProd ? "Você está na produção" : "Abrir esta tela na produção"}"><i data-lucide="globe" style="width:13px;height:13px;"></i>Produção${versaoProducao ? " v" + versaoProducao : ""}</a>`
      + `<button type="button" class="${atual ? "on" : ""}" style="${atual ? "background:" + atual.cor + ";" : ""}" data-avdev="menu" title="${esc(tituloTeste)}" aria-expanded="${menuAberto}">`
      + `<i data-lucide="flask-conical" style="width:13px;height:13px;"></i>${esc(rotuloTeste)}${totalPend && !atual ? '<span class="avdev-ponto"></span>' : ""}<i data-lucide="chevron-down" style="width:13px;height:13px;"></i></button>`
      + (menuAberto ? `<div class="avdev-menu" role="menu"><div class="avdev-menu-tit">Ambientes de teste</div>${AMBIENTES.map((a) => linhaMenu(a, atual)).join("")}</div>` : "");
    alt.querySelectorAll("[data-avdev]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const acao = b.getAttribute("data-avdev");
        if (acao === "menu") { menuAberto = !menuAberto; pintarAlternador(); }
        if (acao === "resumo") { menuAberto = false; pintarAlternador(); abrirResumo(b.getAttribute("data-amb")); }
      };
    });
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(alt);
    else if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  function assinaturaPendencias() {
    return comPendencia().map((a) => {
      const c = dados[a.chave].commits;
      return a.chave + ":" + (c.length ? c[c.length - 1].sha : "");
    }).join("|");
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
    const pend = comPendencia();
    const assinatura = assinaturaPendencias();
    if (!atual && ehAdmin() && pend.length && ler(DISPENSADO) !== assinatura) {
      const total = pend.reduce((s, a) => s + pendentesDe(a), 0);
      const quem = pend.map((a) => esc(a.nome) + " (" + pendentesDe(a) + ")").join(", ");
      html += `<div class="avdev-barra alteracoes">
        <span><strong>Há ${total} ${total === 1 ? "alteração" : "alterações"} nos ambientes de teste</strong> que ainda não ${total === 1 ? "está" : "estão"} na produção: ${quem}. Quer ver antes de levar para a produção?</span>
        <span class="avdev-acoes">
          <button type="button" class="avdev-btn forte" data-avdev="resumo">Ver o que mudou</button>
          <button type="button" class="avdev-btn" data-avdev="dispensar">Dispensar</button>
        </span>
      </div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-avdev]").forEach((b) => {
      b.onclick = () => {
        const acao = b.getAttribute("data-avdev");
        if (acao === "resumo") abrirResumo();
        if (acao === "dispensar") { gravar(DISPENSADO, assinatura); pintar(); }
      };
    });
  }

  // Consulta condicional (ETag): se nada mudou, o GitHub responde 304.
  async function pedir(url) {
    const chave = "integra_gh_" + url;
    let salvo = null;
    try { salvo = JSON.parse(ler(chave, sessionStorage) || "null"); } catch (e) { salvo = null; }
    const headers = { Accept: "application/vnd.github+json" };
    if (salvo && salvo.etag) headers["If-None-Match"] = salvo.etag;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 304 && salvo) return salvo.corpo;
    if (!res.ok) return salvo ? salvo.corpo : null;
    const corpo = await res.json();
    gravar(chave, JSON.stringify({ etag: res.headers.get("ETag") || "", corpo }), sessionStorage);
    return corpo;
  }

  // Comparação entre dois commits nunca muda: guarda pelo par de SHAs e não pergunta de novo.
  async function comparar(shaMain, shaBranch) {
    const chave = "integra_cmp_" + shaMain.slice(0, 12) + "_" + shaBranch.slice(0, 12);
    try { const s = JSON.parse(ler(chave, sessionStorage) || "null"); if (s) return s; } catch (e) {}
    const res = await fetch(API + "/compare/" + shaMain + "..." + shaBranch, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    const corpo = {
      commits: (j.commits || []).map((c) => ({ sha: c.sha, parents: (c.parents || []).map((p) => ({ sha: p.sha })), commit: { message: c.commit && c.commit.message, author: c.commit && c.commit.author }, author: c.author ? { login: c.author.login } : null })),
      files: (j.files || []).map((f) => ({ filename: f.filename, status: f.status })),
      baseMsg: j.merge_base_commit && j.merge_base_commit.commit && j.merge_base_commit.commit.message,
      atrasadoPor: Number(j.behind_by) || 0
    };
    gravar(chave, JSON.stringify(corpo), sessionStorage);
    return corpo;
  }

  async function mensagemDoCommit(sha) {
    const chave = "integra_msg_" + sha.slice(0, 12);
    const s = ler(chave, sessionStorage);
    if (s != null) return s;
    const res = await fetch(API + "/commits/" + sha, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!res.ok) return "";
    const j = await res.json();
    const msg = String((j.commit && j.commit.message) || "");
    gravar(chave, msg, sessionStorage);
    return msg;
  }

  function versaoDe(msg) {
    const m = /v1\.0\.(\d+)/.exec(String(msg || ""));
    return m ? Number(m[1]) : 0;
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
    const branches = await pedir(API + "/branches?per_page=100");
    if (!Array.isArray(branches)) return;
    const sha = {};
    branches.forEach((b) => { if (b && b.name && b.commit) sha[b.name] = b.commit.sha; });
    const shaMain = sha.main;
    if (!shaMain) return;
    for (const amb of AMBIENTES) {
      if (!sha[amb.branch]) { dados[amb.chave] = null; continue; }
      try {
        const cmp = await comparar(shaMain, sha[amb.branch]);
        if (!cmp) continue; // falha temporária: mantém o que já tinha
        dados[amb.chave] = { commits: cmp.commits, files: cmp.files, versaoBase: versaoDe(cmp.baseMsg), atrasadoPor: cmp.atrasadoPor };
      } catch (e) {}
    }
    // Na produção, a versão é a da própria página (rodapé do menu). No teste, lê a mensagem do último commit da main.
    let vp = ambienteAtual() ? 0 : versaoDaPagina();
    if (!vp) vp = versaoDe(await mensagemDoCommit(shaMain).catch(() => ""));
    if (vp) versaoProducao = vp;
  }

  let ultimaConsulta = 0;

  async function ciclo() {
    try {
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
    // Fecha a lista de ambientes ao clicar fora dela.
    document.addEventListener("click", (e) => {
      if (!menuAberto) return;
      const alt = document.getElementById("avdev-alt");
      if (alt && alt.contains(e.target)) return;
      menuAberto = false;
      pintarAlternador();
    });
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
