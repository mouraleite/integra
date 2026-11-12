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
    if (barra && !ehAdmin() && ambientesDoDev().length) {
      pintarAlternadorDev(barra);
      return;
    }
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

  // ===== Alternador para os desenvolvedores (não administradores) =====
  // Quem entra numa bolha fica registrado em Firestore (ambientes_dev/<e-mail>). Assim, na produção,
  // essa pessoa também vê a bolha "Produção | Teste X" para ir e voltar na mesma tela.
  const DEV_COLECAO = "ambientes_dev";
  let meusAmbientes = null; // lista de chaves; null = ainda não consultado
  let registrouDev = false;

  function emailReal() {
    const u = window.AppState && window.AppState.currentUser;
    return String((u && u.email) || "").trim().toLowerCase();
  }

  function ambientesDoDev() {
    const chaves = new Set(meusAmbientes || []);
    const atual = ambienteAtual();
    if (atual) chaves.add(atual.chave);
    return AMBIENTES.filter((a) => chaves.has(a.chave));
  }

  async function sincronizarDev() {
    const email = emailReal();
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    if (!email || !fx || !db) return;
    const atual = ambienteAtual();
    if (atual && !registrouDev && typeof fx.setDoc === "function") {
      registrouDev = true;
      try {
        await fx.setDoc(fx.doc(db, DEV_COLECAO, email), { email, ambientes: { [atual.chave]: Date.now() } }, { merge: true });
      } catch (e) {
        console.warn("[Ambientes de teste] Não foi possível registrar o acesso à bolha:", e);
      }
    }
    if (meusAmbientes !== null || typeof fx.getDoc !== "function") return;
    const cache = ler("integra_meus_ambientes", sessionStorage);
    if (cache) {
      try { meusAmbientes = JSON.parse(cache); return; } catch (e) {}
    }
    try {
      const snap = await fx.getDoc(fx.doc(db, DEV_COLECAO, email));
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : !!snap.exists);
      const d = existe ? snap.data() : null;
      meusAmbientes = Object.keys((d && d.ambientes) || {}).filter((k) => AMBIENTES.some((a) => a.chave === k));
      gravar("integra_meus_ambientes", JSON.stringify(meusAmbientes), sessionStorage);
    } catch (e) {
      meusAmbientes = [];
    }
  }

  function pintarAlternadorDev(barra) {
    let alt = document.getElementById("avdev-alt");
    if (!alt) {
      alt = document.createElement("div");
      alt.id = "avdev-alt";
      alt.className = "avdev-alt";
      barra.insertBefore(alt, barra.firstChild);
    }
    const atual = ambienteAtual();
    const naProd = !atual;
    alt.innerHTML = `<a class="prod${naProd ? " on" : ""}" ${naProd ? "" : `href="${URL_PRODUCAO + esc(caminhoAtual())}"`} title="${naProd ? "Você está na produção" : "Abrir esta tela na produção"}"><i data-lucide="globe" style="width:13px;height:13px;"></i>Produção</a>`
      + ambientesDoDev().map((a) => {
        const aqui = atual && atual.chave === a.chave;
        return `<a class="${aqui ? "on" : ""}" style="${aqui ? "background:" + a.cor + ";cursor:default;" : ""}" ${aqui ? "" : `href="${esc(a.url + caminhoAtual())}"`} title="${aqui ? "Você está no " + esc(a.nome) : "Abrir esta tela no " + esc(a.nome)}"><i data-lucide="flask-conical" style="width:13px;height:13px;"></i>${esc(a.nome)}</a>`;
      }).join("");
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
      const situacao = textoMinha();
      const pendente = minhaSolic && minhaSolic.status === "pendente";
      html += `<div class="avdev-barra teste" style="border-color:${atual.cor};"><span><strong>Ambiente de teste ${esc(atual.pessoa)}</strong> (branch ${esc(atual.branch)}). Esta não é a produção, mas os dados são reais (Sienge e banco do Integra): o que for gravado aqui vale de verdade.${situacao ? `<br><strong>${situacao}</strong>` : ""}</span>
        <span class="avdev-acoes"><button type="button" class="avdev-btn verde" data-avdev="encaminhar" title="Pede ao administrador para levar as alterações deste ambiente para a produção">${pendente ? "Atualizar solicitação" : "Encaminhar para produção"}</button></span></div>`;
    }
    if (adminReal() && solicPendentes.length) {
      const n = solicPendentes.length;
      const quem = solicPendentes.map((s) => esc(s.ambienteNome || ambientePorChave(s.ambiente).nome)).join(", ");
      html += `<div class="avdev-barra solic">
        <span><strong>${n === 1 ? "1 solicitação" : n + " solicitações"} de envio para a produção</strong> aguardando você: ${quem}.</span>
        <span class="avdev-acoes"><button type="button" class="avdev-btn verde" data-avdev="solicitacoes">Ver solicitações</button></span>
      </div>`;
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
        if (acao === "encaminhar") abrirEncaminhar();
        if (acao === "solicitacoes") abrirSolicitacoes();
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

  // Telas citadas nas linhas alteradas (data-tab="x", id="tab-x", switchTab('x')).
  function abasDoPatch(files) {
    const achadas = new Set();
    const re = /(?:data-tab=["']|id=["']tab-|switchTab\(\s*["'])([a-z0-9_][a-z0-9_-]*)/gi;
    (files || []).forEach((f) => {
      String(f.patch || "").split("\n").forEach((linha) => {
        if (!/^[+-]/.test(linha) || /^(\+\+\+|---)/.test(linha)) return;
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(linha))) achadas.add(m[1]);
      });
    });
    return Array.from(achadas).slice(0, 40);
  }

  // Comparação entre dois commits nunca muda: guarda pelo par de SHAs e não pergunta de novo.
  async function comparar(shaMain, shaBranch) {
    const chave = "integra_cmp3_" + shaMain.slice(0, 12) + "_" + shaBranch.slice(0, 12);
    try { const s = JSON.parse(ler(chave, sessionStorage) || "null"); if (s) return s; } catch (e) {}
    const res = await fetch(API + "/compare/" + shaMain + "..." + shaBranch, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    const corpo = {
      commits: (j.commits || []).map((c) => ({ sha: c.sha, parents: (c.parents || []).map((p) => ({ sha: p.sha })), commit: { message: c.commit && c.commit.message, author: c.commit && c.commit.author }, author: c.author ? { login: c.author.login } : null })),
      files: (j.files || []).map((f) => ({ filename: f.filename, status: f.status, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 })),
      abas: abasDoPatch(j.files || []),
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
        dados[amb.chave] = { commits: cmp.commits, files: cmp.files, versaoBase: versaoDe(cmp.baseMsg), atrasadoPor: cmp.atrasadoPor, sha: sha[amb.branch] };
      } catch (e) {}
    }
    // Na produção, a versão é a da própria página (rodapé do menu). No teste, lê a mensagem do último commit da main.
    let vp = ambienteAtual() ? 0 : versaoDaPagina();
    if (!vp) vp = versaoDe(await mensagemDoCommit(shaMain).catch(() => ""));
    if (vp) versaoProducao = vp;
  }

  // ===== Solicitações de envio para a produção =====
  // O desenvolvedor, no ambiente de teste, clica em "Encaminhar para produção": grava um pedido em
  // Firestore (coleção solicitacoes_producao) com o resumo do que mudou. O administrador de verdade
  // (não quem está em "Ver como administrador") recebe um pop-up com o pedido e aprova ou recusa.
  // Aprovar só registra a decisão: a publicação continua sendo "juntar <branch> na main" + deploy.bat.
  const SOLIC = "solicitacoes_producao";
  const VISTAS = "integra_solic_vistas";
  let solicPendentes = [];
  let minhaSolic = null;
  let ouvindoSolic = false;

  function fb() {
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    return fx && db ? { fx, db } : null;
  }

  function adminReal() {
    try { return typeof window.crmAdministradorReal === "function" && !!window.crmAdministradorReal(); } catch (e) { return false; }
  }

  function usuarioReal() {
    const u = (window.AppState && window.AppState.currentUser) || {};
    const nome = (typeof window.crmNomeReal === "function" && window.crmNomeReal()) || u.name || "";
    return { nome: String(nome), email: String(u.email || "").toLowerCase() };
  }

  function ambientePorChave(chave) {
    return AMBIENTES.find((a) => a.chave === chave) || { chave, nome: chave, branch: chave, cor: "#475569", url: URL_PRODUCAO };
  }

  async function compararAmbiente(amb) {
    const branches = await pedir(API + "/branches?per_page=100");
    if (!Array.isArray(branches)) return null;
    const m = branches.find((b) => b && b.name === "main");
    const b = branches.find((x) => x && x.name === amb.branch);
    if (!m || !b) return null;
    const cmp = await comparar(m.commit.sha, b.commit.sha);
    if (!cmp) return null;
    return { commits: cmp.commits, files: cmp.files, abas: cmp.abas || [], sha: b.commit.sha, shaMain: m.commit.sha, versaoBase: versaoDe(cmp.baseMsg) };
  }

  function resumoDe(d) {
    const commits = alteracoesUteis(d).slice().reverse().map((c) => {
      const msg = String((c.commit && c.commit.message) || "").trim();
      return {
        sha: String(c.sha || "").slice(0, 12),
        titulo: msg.split("\n")[0].slice(0, 300),
        corpo: msg.split("\n").slice(1).join("\n").trim().slice(0, 2000),
        autor: (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || "",
        data: (c.commit && c.commit.author && c.commit.author.date) || ""
      };
    });
    const arquivos = ((d && d.files) || []).slice(0, 300).map((f) => ({
      nome: f.filename, status: f.status, mais: Number(f.additions) || 0, menos: Number(f.deletions) || 0
    }));
    const totais = {
      commits: commits.length,
      arquivos: arquivos.length,
      mais: arquivos.reduce((s, f) => s + f.mais, 0),
      menos: arquivos.reduce((s, f) => s + f.menos, 0)
    };
    return { commits, arquivos, totais, abas: (d && d.abas) || [] };
  }

  function num(n) {
    return Number(n || 0).toLocaleString("pt-BR");
  }

  // ---- Telas do menu: dizem ONDE mudou ----
  let menuCache = null;
  function menuTelas() {
    if (menuCache && menuCache.length) return menuCache;
    const lista = [];
    document.querySelectorAll("li[data-tab]").forEach((li) => {
      const tab = li.getAttribute("data-tab");
      if (!tab || lista.some((x) => x.tab === tab)) return;
      const a = li.querySelector("a");
      const nome = a ? a.textContent.trim().replace(/\s+/g, " ") : tab;
      const partes = [];
      let ul = li.parentElement;
      while (ul && ul.tagName === "UL") {
        const pai = ul.parentElement;
        if (!pai || pai.tagName !== "LI") break;
        const t = pai.querySelector(":scope > a span") || pai.querySelector(":scope > a");
        const txt = t ? t.textContent.trim().replace(/\s+/g, " ") : "";
        if (txt) partes.unshift(txt);
        ul = pai.parentElement;
      }
      lista.push({ tab, nome, caminho: partes.concat(nome).join(" › ") });
    });
    menuCache = lista;
    return lista;
  }

  function telaPorTab(tab) {
    return menuTelas().find((t) => t.tab === tab) || null;
  }

  function semAcento(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // Sugestão automática: telas citadas no código alterado, nome do arquivo e palavras do texto.
  function sugerirTelas(r, descricao) {
    const menu = menuTelas();
    const achadas = new Set();
    ((r && r.abas) || []).forEach((t) => { if (telaPorTab(t)) achadas.add(t); });
    ((r && r.arquivos) || []).forEach((f) => {
      const base = semAcento(String(f.nome || "").split("/").pop().replace(/\.(js|css|html)$/i, ""));
      if (!base || ["app", "index", "style", "data", "firebase-config", "aviso-develop"].indexOf(base) >= 0) return;
      menu.forEach((t) => {
        const tb = semAcento(t.tab).replace(/_/g, "-");
        if (tb === base || base.indexOf(tb + "-") === 0 || tb.indexOf(base) === 0) achadas.add(t.tab);
      });
    });
    const texto = semAcento([descricao || ""].concat(((r && r.commits) || []).map((c) => (c.titulo || "") + " " + (c.corpo || ""))).join(" "));
    menu.forEach((t) => {
      const palavras = semAcento(t.nome).split(/[^a-z0-9%]+/).filter((p) => p.length > 3);
      if (palavras.length < 2 && ["configuracoes", "dashboard", "acompanhamento", "relatorios", "registro"].indexOf(palavras[0]) >= 0) return;
      if (palavras.length && palavras.every((p) => texto.indexOf(p) >= 0)) achadas.add(t.tab);
    });
    return Array.from(achadas).slice(0, 8);
  }

  // Tira o jargão das mensagens de commit ("feat:", "Co-authored-by"...).
  function frase(t) {
    const s = String(t || "").replace(/^\s*(feat|fix|chore|refactor|style|docs|test|perf|build|ci|hotfix)(\([^)]*\))?!?\s*:\s*/i, "").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function corpoSimples(c) {
    return String(c || "").split("\n").map((l) => l.trim())
      .filter((l) => l && !/^(co-authored-by|signed-off-by|reviewed-by)\s*:/i.test(l)).join("\n");
  }

  function tamanhoDe(t) {
    const n = (Number(t && t.mais) || 0) + (Number(t && t.menos) || 0);
    if (n < 80) return ["pequena", "peq"];
    if (n < 400) return ["média", "med"];
    return ["grande", "gde"];
  }

  function htmlTelas(tabs, amb, automatico) {
    if (!tabs || !tabs.length) return `<div class="avsol-semtela">Tela não informada.</div>`;
    return `<div class="avsol-telas">${tabs.map((tab) => {
      const t = telaPorTab(tab);
      const link = amb && amb.url ? `<a href="${esc(amb.url + "?tela=" + encodeURIComponent(tab))}" target="_blank" rel="noopener" title="Abrir esta tela na bolha">ver na bolha ›</a>` : "";
      return `<span class="avsol-tela"><i data-lucide="map-pin" style="width:13px;height:13px;"></i>${esc(t ? t.caminho : tab)}${link}</span>`;
    }).join("")}</div>${automatico ? `<div class="avsol-meta2">Identificado automaticamente pelo que foi alterado.</div>` : ""}`;
  }

  // Resumo em linguagem simples + detalhes técnicos recolhidos.
  function htmlVisual(r, extraTecnico) {
    const t = (r && r.totais) || { commits: 0, arquivos: 0, mais: 0, menos: 0 };
    const tam = tamanhoDe(t);
    const itens = ((r && r.commits) || []).map((c) => {
      const corpo = corpoSimples(c.corpo);
      return `<li>${esc(frase(c.titulo))}${corpo ? `<span class="avsol-det">${esc(corpo)}</span>` : ""}</li>`;
    }).join("");
    const rotulo = { added: ["novo", "novo"], removed: ["removido", "rem"], modified: ["alterado", "alt"], renamed: ["renomeado", "ren"] };
    const maior = Math.max(1, ...((r && r.arquivos) || []).map((f) => f.mais + f.menos));
    const arqs = ((r && r.arquivos) || []).slice().sort((a, b) => (b.mais + b.menos) - (a.mais + a.menos)).map((f) => {
      const rt = rotulo[f.status] || [f.status, "alt"];
      const total = f.mais + f.menos;
      const larg = Math.max(4, Math.round((total / maior) * 100));
      const pv = total ? Math.round((f.mais / total) * 100) : 0;
      return `<div class="avsol-arq">
        <span class="avsol-chip ${rt[1]}">${esc(rt[0])}</span>
        <span class="avsol-nomearq" title="${esc(f.nome)}">${esc(f.nome)}</span>
        <span class="avsol-barra"><span style="width:${larg}%;background:linear-gradient(90deg,#16a34a ${pv}%,#dc2626 ${pv}%);"></span></span>
        <span class="avsol-linhas"><b class="mais">+${num(f.mais)}</b> <b class="menos">−${num(f.menos)}</b></span>
      </div>`;
    }).join("");
    return `
      ${itens ? `<div><div class="avsol-tit">Passo a passo do que foi feito</div><ul class="avsol-lista">${itens}</ul></div>` : ""}
      <div class="avsol-rodape">
        <span class="avsol-tam ${tam[1]}">Mudança ${tam[0]}</span>
        <span class="avsol-meta2">${num(t.commits)} ${t.commits === 1 ? "envio" : "envios"} • ${num(t.arquivos)} ${t.arquivos === 1 ? "arquivo" : "arquivos"} do sistema</span>
      </div>
      <details class="avsol-tecnico"><summary>Ver detalhes técnicos</summary>
        <div class="avsol-cards">
          <div class="avsol-card"><span>${num(t.commits)}</span>${t.commits === 1 ? "alteração" : "alterações"}</div>
          <div class="avsol-card"><span>${num(t.arquivos)}</span>${t.arquivos === 1 ? "arquivo" : "arquivos"}</div>
          <div class="avsol-card mais"><span>+${num(t.mais)}</span>linhas novas</div>
          <div class="avsol-card menos"><span>−${num(t.menos)}</span>linhas removidas</div>
        </div>
        ${arqs ? `<div class="avsol-arqs">${arqs}</div>` : ""}
        ${extraTecnico || ""}
      </details>`;
  }

  function estiloSolic() {
    if (document.getElementById("avsol-style")) return;
    const st = document.createElement("style");
    st.id = "avsol-style";
    st.textContent = [
      ".avsol-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}",
      ".avsol-card{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:.74rem;color:#64748b;display:flex;flex-direction:column;gap:2px;}",
      ".avsol-card span{font-size:1.25rem;font-weight:700;color:#0f172a;line-height:1.1;}",
      ".avsol-card.mais span{color:#15803d;}.avsol-card.menos span{color:#b91c1c;}",
      ".avsol-tit{font-size:.74rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em;margin:2px 0 6px;}",
      ".avsol-commits{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;}",
      ".avsol-commits pre{white-space:pre-wrap;font-family:inherit;margin:2px 0 0;color:#475569;font-size:.8rem;}",
      ".avsol-meta{display:block;font-size:.72rem;color:#94a3b8;}",
      ".avsol-arqs{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;}",
      ".avsol-arq{display:grid;grid-template-columns:76px minmax(0,1fr) 120px 96px;align-items:center;gap:8px;font-size:.78rem;}",
      ".avsol-nomearq{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b;}",
      ".avsol-barra{height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;display:block;}",
      ".avsol-barra span{display:block;height:100%;border-radius:99px;}",
      ".avsol-linhas{text-align:right;white-space:nowrap;}.avsol-linhas .mais{color:#15803d;}.avsol-linhas .menos{color:#b91c1c;}",
      ".avsol-chip{display:inline-block;text-align:center;border-radius:99px;padding:1px 8px;font-size:.7rem;font-weight:700;}",
      ".avsol-chip.novo{background:#dcfce7;color:#166534;}.avsol-chip.alt{background:#dbeafe;color:#1e40af;}",
      ".avsol-chip.rem{background:#fee2e2;color:#991b1b;}.avsol-chip.ren{background:#f1f5f9;color:#475569;}",
      ".avsol-pedido{border:1px solid #e2e8f0;border-left:4px solid currentColor;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}",
      ".avsol-cab{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".avsol-cab h3{margin:0;font-size:1rem;}",
      ".avsol-cab .avsol-quem{font-size:.78rem;color:#64748b;}",
      ".avsol-desc{background:#f8fafc;border-radius:8px;padding:8px 10px;color:#1e293b;white-space:pre-wrap;font-size:.84rem;}",
      ".avsol-aviso{background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;border-radius:8px;padding:6px 10px;font-size:.78rem;}",
      ".avsol-acoes{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}",
      ".avsol-acoes .avdev-btn{padding:6px 12px;font-size:.8rem;color:#105436;}",
      ".avsol-acoes .avdev-btn.ok{background:#105436;border-color:#105436;color:#fff;}",
      ".avsol-acoes .avdev-btn.nao{color:#b91c1c;}",
      ".avsol-recusa{display:none;flex-direction:column;gap:6px;}",
      ".avsol-recusa.on{display:flex;}",
      ".avsol-texto{width:100%;min-height:70px;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:inherit;font-size:.84rem;resize:vertical;box-sizing:border-box;}",
      ".avsol-feito{border-radius:8px;padding:8px 10px;font-size:.84rem;}",
      ".avsol-feito.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;}",
      ".avsol-feito.nao{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;}",
      ".avsol-conteudo{color:#1e293b;display:flex;flex-direction:column;gap:12px;}",
      ".avsol-telas{display:flex;flex-wrap:wrap;gap:6px;}",
      ".avsol-tela{display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:99px;padding:4px 10px;font-size:.8rem;font-weight:600;}",
      ".avsol-tela a{color:#047857;font-weight:700;text-decoration:none;margin-left:4px;font-size:.74rem;}",
      ".avsol-tela a:hover{text-decoration:underline;}",
      ".avsol-semtela{font-size:.8rem;color:#94a3b8;}",
      ".avsol-meta2{font-size:.74rem;color:#94a3b8;margin-top:4px;}",
      ".avsol-desc{font-size:.92rem;line-height:1.45;}",
      ".avsol-desc.teste{background:#eff6ff;}",
      ".avsol-lista{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:.86rem;}",
      ".avsol-det{display:block;font-size:.78rem;color:#64748b;white-space:pre-wrap;}",
      ".avsol-rodape{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
      ".avsol-rodape .avsol-meta2{margin:0;}",
      ".avsol-tam{border-radius:99px;padding:3px 10px;font-size:.74rem;font-weight:700;}",
      ".avsol-tam.peq{background:#dcfce7;color:#166534;}.avsol-tam.med{background:#fef9c3;color:#854d0e;}.avsol-tam.gde{background:#fee2e2;color:#991b1b;}",
      ".avsol-tecnico{border-top:1px dashed #e2e8f0;padding-top:6px;}",
      ".avsol-tecnico summary{cursor:pointer;font-size:.76rem;color:#64748b;font-weight:600;}",
      ".avsol-tecnico[open]{display:flex;flex-direction:column;gap:8px;}",
      ".avsol-escolha{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;}",
      ".avsol-op{display:inline-flex;align-items:center;gap:6px;border:1px solid #cbd5e1;border-radius:99px;padding:4px 10px;font-size:.8rem;cursor:pointer;}",
      ".avsol-op:has(input:checked){background:#ecfdf5;border-color:#34d399;color:#065f46;font-weight:600;}",
      ".avsol-campo{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:7px 9px;font:inherit;font-size:.84rem;}",
      ".avsol-texto.curto{min-height:48px;}",
      ".avsol-pub{border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}",
      ".avsol-pub.ok{background:#f0fdf4;border:1px solid #86efac;}",
      ".avsol-pub.nao{background:#fef2f2;border:1px solid #fecaca;}",
      ".avsol-pub-cab{display:flex;gap:10px;align-items:flex-start;}",
      ".avsol-pub.ok .avsol-pub-cab{color:#14532d;}.avsol-pub.nao .avsol-pub-cab{color:#7f1d1d;}",
      ".avsol-pub-cab strong{display:block;font-size:1rem;}",
      ".avsol-pub-cab span{display:block;font-size:.78rem;opacity:.85;}",
      ".avdev-barra.solic{background:#f0fdf4;border:1px solid #86efac;color:#14532d;}",
      ".avdev-btn.verde{background:#105436;border-color:#105436;color:#fff;}",
      "@media (max-width:640px){.avsol-cards{grid-template-columns:repeat(2,minmax(0,1fr));}.avsol-arq{grid-template-columns:70px minmax(0,1fr) 84px;}.avsol-barra{display:none;}}"
    ].join("");
    document.head.appendChild(st);
  }

  function abrirModal(titulo, corpo) {
    estilo();
    estiloSolic();
    const fundo = document.createElement("div");
    fundo.className = "avdev-fundo";
    fundo.innerHTML = `<div class="avdev-modal" role="dialog" aria-modal="true">
      <header><h2>${esc(titulo)}</h2><button type="button" class="avdev-btn" data-fechar>Fechar</button></header>
      <div class="avdev-corpo">${corpo}</div></div>`;
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo || (e.target && e.target.hasAttribute && e.target.hasAttribute("data-fechar"))) fundo.remove();
    });
    document.body.appendChild(fundo);
    return fundo;
  }

  // ---- Lado do desenvolvedor (ambiente de teste) ----
  async function carregarMinha() {
    const amb = ambienteAtual();
    const f = fb();
    if (!amb || !f) return;
    try {
      const snap = await f.fx.getDocs(f.fx.query(f.fx.collection(f.db, SOLIC), f.fx.where("ambiente", "==", amb.chave)));
      let ultima = null;
      snap.forEach((d) => {
        const v = Object.assign({ id: d.id }, d.data());
        if (!ultima || Number(v.criadoEm) > Number(ultima.criadoEm)) ultima = v;
      });
      minhaSolic = ultima;
    } catch (e) {
      console.warn("[Encaminhar para produção] Não foi possível ler as solicitações:", e);
    }
  }

  function textoMinha() {
    const s = minhaSolic;
    if (!s) return "";
    const quando = fmtData(s.criadoEm);
    if (s.status === "pendente") return `Solicitação de envio feita em ${esc(quando)}: aguardando o administrador.`;
    const dias = (Date.now() - Number(s.decididoEm || 0)) / 86400000;
    if (dias > 7) return "";
    if (s.status === "publicado") return `Sua alteração foi publicada na produção (v${esc(s.versao || "")}) em ${esc(fmtData(s.publicadoEm || s.decididoEm))}.`;
    if (s.status === "aprovado") return `Envio aprovado por ${esc(s.decididoPor || "administrador")} em ${esc(fmtData(s.decididoEm))}. Entra na produção na próxima publicação.`;
    if (s.status === "recusado") return `Envio recusado por ${esc(s.decididoPor || "administrador")} em ${esc(fmtData(s.decididoEm))}${s.motivo ? ": " + esc(s.motivo) : "."}`;
    return "";
  }

  async function abrirEncaminhar() {
    const amb = ambienteAtual();
    if (!amb) return;
    const fundo = abrirModal("Encaminhar para produção: " + amb.nome, "<p>Conferindo o que este ambiente tem de diferente da produção…</p>");
    const corpo = fundo.querySelector(".avdev-corpo");
    let d = null;
    try { d = await compararAmbiente(amb); } catch (e) { d = null; }
    if (!d) {
      corpo.innerHTML = "<p>Não consegui consultar o GitHub agora. Tente de novo em alguns minutos.</p>";
      return;
    }
    const r = resumoDe(d);
    if (!r.totais.commits) {
      corpo.innerHTML = `<p>Este ambiente está igual à produção: não há nada para encaminhar.</p>
        <p style="color:#64748b;">Se você acabou de subir uma alteração, espere 1 minuto e tente de novo.</p>`;
      return;
    }
    const atualizando = minhaSolic && minhaSolic.status === "pendente";
    const anterior = atualizando ? minhaSolic : null;
    const escolhidas = new Set((anterior && Array.isArray(anterior.telas) && anterior.telas.length) ? anterior.telas : sugerirTelas(r, ""));
    const menu = menuTelas();
    corpo.innerHTML = `
      ${atualizando ? `<div class="avsol-aviso">Já existe uma solicitação aguardando o administrador (feita em ${esc(fmtData(minhaSolic.criadoEm))}). Ao enviar, ela é atualizada com o que está abaixo.</div>` : ""}
      <div>
        <div class="avsol-tit">1. Em quais telas mudou?</div>
        <div class="avsol-escolha" id="avsol-telas"></div>
        <input class="avsol-campo" id="avsol-busca-tela" list="avsol-menu" placeholder="Adicionar outra tela (digite o nome)…">
        <datalist id="avsol-menu">${menu.map((t) => `<option value="${esc(t.caminho)}"></option>`).join("")}</datalist>
      </div>
      <div>
        <div class="avsol-tit">2. O que muda para quem usa?</div>
        <textarea class="avsol-texto" id="avsol-desc" placeholder="Em palavras simples. Ex.: agora dá para marcar a data do acordo e anexar o documento do acordo.">${esc(anterior ? anterior.descricao || "" : "")}</textarea>
      </div>
      <div>
        <div class="avsol-tit">3. Como testar (opcional)</div>
        <textarea class="avsol-texto curto" id="avsol-teste" placeholder="Ex.: abrir um cliente com acordo, clicar em Registrar acordo e anexar um PDF.">${esc(anterior ? anterior.comoTestar || "" : "")}</textarea>
      </div>
      ${htmlVisual(r)}
      <div class="avsol-acoes">
        <button type="button" class="avdev-btn ok" id="avsol-enviar">${atualizando ? "Atualizar solicitação" : "Enviar para o administrador"}</button>
        <button type="button" class="avdev-btn" data-fechar>Cancelar</button>
      </div>`;
    const caixaTelas = corpo.querySelector("#avsol-telas");
    const pintarTelas = () => {
      const todas = Array.from(escolhidas).concat(sugerirTelas(r, "").filter((t) => !escolhidas.has(t)));
      caixaTelas.innerHTML = todas.length ? todas.map((tab) => {
        const t = telaPorTab(tab);
        return `<label class="avsol-op"><input type="checkbox" value="${esc(tab)}" ${escolhidas.has(tab) ? "checked" : ""}><span>${esc(t ? t.caminho : tab)}</span></label>`;
      }).join("") : `<div class="avsol-meta2">Nenhuma tela sugerida. Use o campo abaixo para escolher.</div>`;
      caixaTelas.querySelectorAll("input").forEach((cb) => {
        cb.onchange = () => { if (cb.checked) escolhidas.add(cb.value); else escolhidas.delete(cb.value); };
      });
    };
    pintarTelas();
    const busca = corpo.querySelector("#avsol-busca-tela");
    busca.onchange = () => {
      const alvo = menu.find((t) => t.caminho === busca.value);
      if (alvo) { escolhidas.add(alvo.tab); busca.value = ""; pintarTelas(); }
    };
    corpo.querySelector("#avsol-enviar").onclick = async (ev) => {
      const btn = ev.currentTarget;
      const descricao = String(corpo.querySelector("#avsol-desc").value || "").trim();
      const comoTestar = String(corpo.querySelector("#avsol-teste").value || "").trim();
      if (!escolhidas.size) { alert("Marque pelo menos uma tela onde houve mudança."); return; }
      if (descricao.length < 10) { alert("Escreva em poucas palavras o que muda para quem usa."); return; }
      const f = fb();
      if (!f) { alert("O banco do Integra ainda não carregou. Tente de novo."); return; }
      btn.disabled = true;
      btn.textContent = "Enviando…";
      const telas = Array.from(escolhidas).slice(0, 20);
      const pedido = Object.assign({
        ambiente: amb.chave,
        ambienteNome: amb.nome,
        branch: amb.branch,
        sha: d.sha,
        shaMain: d.shaMain,
        versaoBase: d.versaoBase || 0,
        descricao: descricao.slice(0, 4000),
        comoTestar: comoTestar.slice(0, 2000),
        telas,
        telasNomes: telas.map((tab) => { const t = telaPorTab(tab); return t ? t.caminho : tab; }),
        solicitante: usuarioReal(),
        criadoEm: Date.now(),
        status: "pendente",
        avisoVisto: false
      }, r);
      try {
        if (atualizando) await f.fx.updateDoc(f.fx.doc(f.db, SOLIC, minhaSolic.id), pedido);
        else await f.fx.addDoc(f.fx.collection(f.db, SOLIC), pedido);
      } catch (e) {
        console.warn("[Encaminhar para produção] Falha ao gravar:", e);
        alert("Não foi possível enviar a solicitação. Tente de novo; se continuar, avise o administrador.");
        btn.disabled = false;
        btn.textContent = "Enviar para o administrador";
        return;
      }
      corpo.innerHTML = `<div class="avsol-feito ok"><strong>Solicitação enviada.</strong> O administrador vai receber um aviso. Quando ele aprovar, a produção é atualizada sozinha e você recebe um aviso aqui e na produção.</div>
        <div class="avsol-acoes"><button type="button" class="avdev-btn" data-fechar>Fechar</button></div>`;
      await carregarMinha();
      pintar();
    };
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(fundo);
  }

  // ---- Aviso ao desenvolvedor (na bolha E na produção) quando o pedido é decidido ----
  let ouvindoMinhas = false;
  const AVISO_FECHADO = "integra_aviso_dev_fechado";

  function ouvirMinhasDecisoes() {
    const email = emailReal();
    const f = fb();
    if (ouvindoMinhas || !email || !f || typeof f.fx.onSnapshot !== "function") return;
    ouvindoMinhas = true;
    try {
      f.fx.onSnapshot(f.fx.query(f.fx.collection(f.db, SOLIC), f.fx.where("solicitante.email", "==", email)), (snap) => {
        const novas = [];
        let ultima = null;
        snap.forEach((d) => {
          const v = Object.assign({ id: d.id }, d.data());
          if (v.status !== "pendente" && v.avisoVisto === false) novas.push(v);
          const amb = ambienteAtual();
          if (amb && v.ambiente === amb.chave && (!ultima || Number(v.criadoEm) > Number(ultima.criadoEm))) ultima = v;
        });
        if (ultima) { minhaSolic = ultima; pintar(); }
        let fechadas = [];
        try { fechadas = JSON.parse(ler(AVISO_FECHADO, sessionStorage) || "[]"); } catch (e) { fechadas = []; }
        const mostrar = novas.filter((v) => fechadas.indexOf(v.id + ":" + v.status) < 0);
        if (mostrar.length && !document.getElementById("avsol-dev-aviso")) avisarDev(mostrar);
      }, (e) => {
        console.warn("[Encaminhar para produção] Não foi possível acompanhar as respostas:", e);
        ouvindoMinhas = false;
      });
    } catch (e) {
      ouvindoMinhas = false;
    }
  }

  function avisarDev(lista) {
    const blocos = lista.map((s) => {
      const amb = ambientePorChave(s.ambiente);
      const nomes = Array.isArray(s.telasNomes) && s.telasNomes.length ? s.telasNomes : (Array.isArray(s.telas) ? s.telas : []);
      const telas = nomes.length ? `<div class="avsol-telas">${nomes.map((n) => `<span class="avsol-tela"><i data-lucide="map-pin" style="width:13px;height:13px;"></i>${esc(n)}</span>`).join("")}</div>` : "";
      const tela1 = Array.isArray(s.telas) && s.telas[0] ? "?tela=" + encodeURIComponent(s.telas[0]) : "";
      const quem = esc(s.decididoPor || "administrador");
      if (s.status === "publicado") {
        return `<div class="avsol-pub ok">
          <div class="avsol-pub-cab"><i data-lucide="party-popper" style="width:22px;height:22px;"></i><div><strong>Sua alteração está na produção!</strong>
          <span>Versão v${esc(s.versao || "")} • aprovada por ${quem} em ${esc(fmtData(s.publicadoEm || s.decididoEm))}</span></div></div>
          ${telas}
          ${s.descricao ? `<div class="avsol-desc">${esc(s.descricao)}</div>` : ""}
          <div class="avsol-acoes"><a class="avdev-btn ok" href="${esc(URL_PRODUCAO + tela1)}" target="_blank" rel="noopener">Ver na produção</a></div>
        </div>`;
      }
      if (s.status === "recusado") {
        return `<div class="avsol-pub nao">
          <div class="avsol-pub-cab"><i data-lucide="circle-x" style="width:22px;height:22px;"></i><div><strong>Envio para produção recusado</strong>
          <span>${esc(amb.nome)} • por ${quem} em ${esc(fmtData(s.decididoEm))}</span></div></div>
          ${telas}
          ${s.motivo ? `<div class="avsol-desc"><b>Motivo:</b> ${esc(s.motivo)}</div>` : ""}
          <div class="avsol-meta2">Ajuste na sua bolha e clique de novo em "Encaminhar para produção".</div>
        </div>`;
      }
      return `<div class="avsol-pub ok">
        <div class="avsol-pub-cab"><i data-lucide="check-circle-2" style="width:22px;height:22px;"></i><div><strong>Envio aprovado</strong>
        <span>${esc(amb.nome)} • por ${quem} em ${esc(fmtData(s.decididoEm))}. Entra na produção na próxima publicação.</span></div></div>
        ${telas}
      </div>`;
    }).join("");
    const fundo = abrirModal(lista.length === 1 ? "Resposta do seu pedido de envio" : "Respostas dos seus pedidos de envio", blocos
      + `<div class="avsol-acoes"><button type="button" class="avdev-btn ok" id="avsol-entendi">Entendi</button></div>`);
    fundo.id = "avsol-dev-aviso";
    const marcarFechado = () => {
      let fechadas = [];
      try { fechadas = JSON.parse(ler(AVISO_FECHADO, sessionStorage) || "[]"); } catch (e) { fechadas = []; }
      gravar(AVISO_FECHADO, JSON.stringify(fechadas.concat(lista.map((s) => s.id + ":" + s.status)).slice(-100)), sessionStorage);
    };
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo || (e.target && e.target.hasAttribute && e.target.hasAttribute("data-fechar"))) marcarFechado();
    });
    fundo.querySelector("#avsol-entendi").onclick = async () => {
      marcarFechado();
      fundo.remove();
      const f = fb();
      if (!f) return;
      for (const s of lista) {
        try { await f.fx.updateDoc(f.fx.doc(f.db, SOLIC, s.id), { avisoVisto: true, avisoVistoEm: Date.now() }); } catch (e) {}
      }
    };
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(fundo);
    else if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  // Link com ?tela=<aba> abre direto aquela tela (se a pessoa tiver acesso a ela no menu).
  function abrirTelaDaUrl() {
    let tela = "";
    try { tela = new URLSearchParams(location.search).get("tela") || ""; } catch (e) { tela = ""; }
    if (!/^[a-z0-9_-]{2,60}$/i.test(tela)) return;
    let n = 0;
    const tentar = () => {
      n++;
      const li = document.querySelector('li[data-tab="' + tela + '"]');
      const a = li && li.querySelector("a");
      const escondida = !li || li.hidden || li.style.display === "none" || getComputedStyle(li).display === "none";
      if (a && !escondida && typeof window.switchTab === "function") {
        a.click();
        try {
          const u = new URL(location.href);
          u.searchParams.delete("tela");
          history.replaceState(null, "", u.pathname + u.search + u.hash);
        } catch (e) {}
        return;
      }
      if (n < 20) setTimeout(tentar, 1000);
    };
    setTimeout(tentar, 1500);
  }

  // ---- Lado do administrador ----
  function vistas() {
    try { return JSON.parse(ler(VISTAS, sessionStorage) || "[]"); } catch (e) { return []; }
  }

  function ouvirPendentes() {
    if (ouvindoSolic || !adminReal()) return;
    const f = fb();
    if (!f || typeof f.fx.onSnapshot !== "function") return;
    ouvindoSolic = true;
    try {
      f.fx.onSnapshot(f.fx.query(f.fx.collection(f.db, SOLIC), f.fx.where("status", "==", "pendente")), (snap) => {
        const lista = [];
        snap.forEach((d) => lista.push(Object.assign({ id: d.id }, d.data())));
        lista.sort((a, b) => Number(a.criadoEm) - Number(b.criadoEm));
        solicPendentes = lista;
        pintar();
        const vistos = vistas();
        const novas = lista.filter((s) => vistos.indexOf(s.id + ":" + s.criadoEm) < 0);
        if (novas.length && adminReal() && !document.getElementById("avsol-admin")) abrirSolicitacoes();
      }, (e) => {
        console.warn("[Solicitações de envio] Não foi possível acompanhar:", e);
        ouvindoSolic = false;
      });
    } catch (e) {
      ouvindoSolic = false;
    }
  }

  function htmlPedido(s) {
    const amb = ambientePorChave(s.ambiente);
    const d = dados[s.ambiente];
    const mudouDepois = d && d.sha && s.sha && d.sha !== s.sha;
    const quem = (s.solicitante && (s.solicitante.nome || s.solicitante.email)) || "desenvolvedor";
    const informadas = Array.isArray(s.telas) && s.telas.length;
    const telas = informadas ? s.telas : sugerirTelas(s, s.descricao);
    const github = `<p style="margin:8px 0 0;"><a class="avdev-btn" href="https://github.com/${REPO}/compare/main...${encodeURIComponent(s.branch || amb.branch)}" target="_blank" rel="noopener">Ver no GitHub</a></p>`;
    return `<div class="avsol-pedido" style="color:${esc(amb.cor)};" data-id="${esc(s.id)}">
      <div class="avsol-cab">
        <i data-lucide="send" style="width:16px;height:16px;"></i>
        <h3>${esc(s.ambienteNome || amb.nome)}</h3>
        <span class="avsol-quem">pedido por ${esc(quem)} em ${esc(fmtData(s.criadoEm))}</span>
      </div>
      <div class="avsol-conteudo">
        <div><div class="avsol-tit">Onde mudou</div>${htmlTelas(telas, amb, !informadas)}</div>
        ${s.descricao ? `<div><div class="avsol-tit">O que muda para quem usa</div><div class="avsol-desc">${esc(s.descricao)}</div></div>` : ""}
        ${s.comoTestar ? `<div><div class="avsol-tit">Como testar</div><div class="avsol-desc teste">${esc(s.comoTestar)}</div></div>` : ""}
        ${mudouDepois ? `<div class="avsol-aviso">Depois deste pedido, subiram mais alterações nesse ambiente. Só o que foi pedido será publicado.</div>` : ""}
        ${htmlVisual(s, github)}
        <div class="avsol-acoes">
          <button type="button" class="avdev-btn ok" data-sol="aprovar">Aprovar e publicar</button>
          <button type="button" class="avdev-btn nao" data-sol="recusar">Recusar</button>
          <a class="avdev-btn" href="${esc(amb.url + (telas[0] ? "?tela=" + encodeURIComponent(telas[0]) : ""))}" target="_blank" rel="noopener">Testar na bolha</a>
        </div>
        <div class="avsol-recusa">
          <textarea class="avsol-texto" placeholder="Motivo da recusa (o desenvolvedor vai ver)."></textarea>
          <div class="avsol-acoes"><button type="button" class="avdev-btn nao" data-sol="confirmar-recusa">Confirmar recusa</button></div>
        </div>
      </div>
    </div>`;
  }

  async function chamarPublicar(id) {
    let token = "";
    try { if (window.MouraAuth && typeof window.MouraAuth.getIntegraToken === "function") token = await window.MouraAuth.getIntegraToken(); } catch (e) {}
    const res = await fetch("/api/publicar", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, token ? { "X-Integra-Token": token } : {}),
      body: JSON.stringify({ solicitacao: id })
    });
    let j = {};
    try { j = await res.json(); } catch (e) { j = {}; }
    return Object.assign({ httpStatus: res.status }, j);
  }

  async function decidir(caixa, s, status, motivo) {
    const f = fb();
    if (!f) return;
    const quem = usuarioReal();
    const botoes = caixa.querySelectorAll("button");
    botoes.forEach((b) => { b.disabled = true; });
    const branch = s.branch || ambientePorChave(s.ambiente).branch;
    const alvo = caixa.querySelector(".avsol-conteudo");
    const registro = { motivo: motivo || "", decididoPor: quem.nome || quem.email, decididoPorEmail: quem.email, decididoEm: Date.now(), avisoVisto: false };
    if (status === "aprovado") {
      const btn = caixa.querySelector('[data-sol="aprovar"]');
      if (btn) btn.textContent = "Publicando… (até 1 minuto)";
      let resultado = null;
      try { resultado = await chamarPublicar(s.id); } catch (e) { resultado = { error: "Sem resposta do servidor." }; }
      if (resultado && resultado.publicado) {
        status = "publicado";
        Object.assign(registro, { versao: resultado.versao, publicadoEm: Date.now(), testes: resultado.testes || {} });
      } else if (resultado && resultado.naoConfigurado) {
        status = "aprovado"; // publicação automática ainda não configurada: segue o caminho manual
      } else if (resultado && resultado.juntou) {
        status = "aprovado";
        registro.motivo = "Juntado na produção; falta subir a versão (deploy.bat).";
        alert("Juntei na produção, mas faltou um passo: " + (resultado.error || "") );
      } else {
        botoes.forEach((b) => { b.disabled = false; });
        if (btn) btn.textContent = "Aprovar e publicar";
        alert("Não publiquei: " + ((resultado && resultado.error) || "erro desconhecido") + "\n\nA solicitação continua aguardando.");
        return;
      }
    }
    try {
      await f.fx.updateDoc(f.fx.doc(f.db, SOLIC, s.id), Object.assign({ status }, registro));
    } catch (e) {
      console.warn("[Solicitações de envio] Falha ao gravar a decisão:", e);
      if (status !== "publicado") {
        alert("Não foi possível gravar a decisão. Tente de novo.");
        botoes.forEach((b) => { b.disabled = false; });
        return;
      }
    }
    if (status === "publicado") {
      const pend = Object.keys(registro.testes || {}).filter((k) => registro.testes[k] !== "atualizada");
      alvo.innerHTML = `<div class="avsol-feito ok"><strong>Publicado na produção: v${esc(registro.versao)}.</strong> A Vercel termina de publicar em cerca de 1 minuto. O desenvolvedor foi avisado.
        ${pend.length ? `<br><span style="font-size:.8rem;">Bolhas não atualizadas (têm outras alterações em andamento): ${esc(pend.join(", "))}.</span>` : ""}
        <br><span style="font-size:.8rem;">No seu computador, o próximo deploy.bat já traz esta versão sozinho.</span></div>`;
    } else if (status === "aprovado") {
      alvo.innerHTML = `<div class="avsol-feito ok"><strong>Aprovado.</strong> ${registro.motivo ? esc(registro.motivo) + " " : "A publicação automática ainda não está ligada: "}peça ao Claude <b>"juntar ${esc(branch)} na main"</b> e rode o <b>deploy.bat</b>.</div>`;
    } else {
      alvo.innerHTML = `<div class="avsol-feito nao"><strong>Recusado.</strong> O desenvolvedor verá o motivo.</div>`;
    }
  }

  function abrirSolicitacoes() {
    if (!adminReal() || !solicPendentes.length) return;
    const antigo = document.getElementById("avsol-admin");
    if (antigo) antigo.remove();
    const lista = solicPendentes.slice();
    const total = lista.length;
    const fundo = abrirModal(
      total === 1 ? "Nova solicitação de envio para a produção" : total + " solicitações de envio para a produção",
      lista.map(htmlPedido).join("")
    );
    fundo.id = "avsol-admin";
    gravar(VISTAS, JSON.stringify(vistas().concat(lista.map((s) => s.id + ":" + s.criadoEm)).slice(-200)), sessionStorage);
    fundo.querySelectorAll(".avsol-pedido").forEach((caixa) => {
      const s = lista.find((x) => x.id === caixa.getAttribute("data-id"));
      if (!s) return;
      caixa.querySelectorAll("[data-sol]").forEach((b) => {
        b.onclick = () => {
          const acao = b.getAttribute("data-sol");
          if (acao === "aprovar") decidir(caixa, s, "aprovado", "");
          if (acao === "recusar") {
            const area = caixa.querySelector(".avsol-recusa");
            area.classList.toggle("on");
            if (area.classList.contains("on")) area.querySelector("textarea").focus();
          }
          if (acao === "confirmar-recusa") {
            const motivo = String(caixa.querySelector(".avsol-recusa textarea").value || "").trim();
            if (!motivo) { alert("Escreva o motivo da recusa."); return; }
            decidir(caixa, s, "recusado", motivo.slice(0, 2000));
          }
        };
      });
    });
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(fundo);
    else if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  let ultimaConsulta = 0;

  async function ciclo() {
    try {
      if (ehAdmin() && document.visibilityState !== "hidden") {
        ultimaConsulta = Date.now();
        await consultar();
      }
    } catch (e) {}
    try {
      if (ambienteAtual()) await carregarMinha();
      ouvirPendentes();
      ouvirMinhasDecisoes();
    } catch (e) {}
    try { await sincronizarDev(); } catch (e) {}
    pintar();
  }

  function iniciar() {
    if (iniciou) return;
    iniciou = true;
    abrirTelaDaUrl();
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

  window.IntegraAvisoDevelop = { atualizar: () => ciclo(), abrirResumo, abrirEncaminhar, abrirSolicitacoes };
})();
