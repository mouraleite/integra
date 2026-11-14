/*
 * App de vistorias (instalável no celular).
 * - Entra com a conta Microsoft da Moura Leite (o mesmo aplicativo do Azure usado pelo Integra).
 * - Só libera quem está no cadastro de usuários do Integra, ativo e marcado como de construção.
 * - Mostra as vistorias atribuídas a essa pessoa em "Vistoria (app)" no Integra (campo app.responsavelEmail).
 * - "Fazer vistoria" abre a mesma página de fotos do link (vistoria.html?id=...&app=1): o Integra valida igual.
 */
(function () {
  "use strict";

  const AZURE = {
    clientId: "643259b4-6f72-4f25-8a2d-ac131a34f169",
    tenantId: "34bf99e3-12de-4814-ab19-0d0f90fab15b"
  };
  const URL_APP = window.location.origin + "/vistoria-app/";
  const raiz = document.getElementById("raiz");
  const estado = { aba: "novas", conta: null, usuario: null, vistorias: [] };
  let msalApp = null;

  const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const primeiroNome = (n) => {
    const p = String(n || "").trim().split(/\s+/)[0] || "";
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
  };
  const dataDe = (v) => {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d) ? null : d;
  };
  const dataBr = (v) => {
    const d = dataDe(v);
    return d ? d.toLocaleDateString("pt-BR") : "";
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/vistoria-app/sw.js", { scope: "/vistoria-app/" }).catch(() => {});
  }

  async function esperarFirebase() {
    for (let i = 0; i < 60 && !window.firebaseDb; i++) await new Promise((r) => setTimeout(r, 100));
    if (!window.firebaseDb) throw new Error("Não consegui conectar ao servidor. Verifique a internet e abra o app de novo.");
  }

  function telaEntrar(erro) {
    raiz.innerHTML = `<div class="entrar">
      <img src="/vistoria-app/icone-192.png" alt="">
      <h1>Vistorias</h1>
      <p>Entre com a sua conta Microsoft da Moura Leite para ver as vistorias atribuídas a você.</p>
      <button type="button" class="btn grande" id="entrar">Entrar com Microsoft</button>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ""}
    </div>`;
    document.getElementById("entrar").onclick = entrar;
  }

  function telaAviso(titulo, texto) {
    raiz.innerHTML = `<header>
        <img src="/vistoria-app/icone-192.png" alt="">
        <div class="tit"><b>Vistorias</b><span>${esc(estado.conta ? estado.conta.username : "")}</span></div>
        <button type="button" id="sair">Sair</button>
      </header>
      <main><div class="aviso"><b>${esc(titulo)}</b>${esc(texto)}</div></main>`;
    document.getElementById("sair").onclick = sair;
  }

  async function entrar() {
    try {
      await msalApp.loginRedirect({ scopes: ["User.Read"], prompt: "select_account" });
    } catch (e) {
      telaEntrar("Não foi possível abrir o login: " + ((e && e.message) || e));
    }
  }

  async function sair() {
    try {
      await msalApp.logoutRedirect({ account: estado.conta, postLogoutRedirectUri: URL_APP });
    } catch (e) {
      telaEntrar();
    }
  }

  /** Cadastro de usuários do Integra (config/crm_users). */
  async function lerUsuario(email) {
    const { doc, getDoc } = window.firebaseCollections;
    const snap = await getDoc(doc(window.firebaseDb, "config", "crm_users"));
    const dados = snap.exists() ? (snap.data() || {}) : {};
    let lista = [];
    try { lista = JSON.parse(dados.list || "[]") || []; } catch (e) { lista = []; }
    return lista.find((u) => String((u && u.email) || "").trim().toLowerCase() === email) || null;
  }

  async function carregarVistorias() {
    const { collection, getDocs, query, where } = window.firebaseCollections;
    const q = query(collection(window.firebaseDb, "vistorias"), where("app.responsavelEmail", "==", estado.usuario.email));
    const snap = await getDocs(q);
    const lista = [];
    snap.forEach((d) => lista.push(Object.assign({ id: d.id }, d.data())));
    estado.vistorias = lista;
  }

  function rotuloLote(v) {
    const unidade = String(v.unidade || "").replace(/^unidade\s+/i, "").trim();
    return unidade && !/^n\/d$/i.test(unidade) ? unidade : "Unidade não informada";
  }

  function pintar() {
    const novas = estado.vistorias.filter((v) => v.status === "aguardando_fotos")
      .sort((a, b) => String(a.cidade || "").localeCompare(String(b.cidade || ""), "pt")
        || String(a.empreendimento || "").localeCompare(String(b.empreendimento || ""), "pt")
        || String(a.unidade || "").localeCompare(String(b.unidade || ""), "pt", { numeric: true }));
    const feitas = estado.vistorias.filter((v) => v.status === "aguardando_validacao" || v.status === "concluida")
      .sort((a, b) => (dataDe(b.enviadoEm) || 0) - (dataDe(a.enviadoEm) || 0));
    const lista = estado.aba === "novas" ? novas : feitas;

    let corpo = "";
    if (!lista.length) {
      corpo = `<div class="vazio">${estado.aba === "novas" ? "Nenhuma vistoria nova para você agora." : "Você ainda não enviou vistorias pelo app."}</div>`;
    } else if (estado.aba === "novas") {
      let grupo = "";
      lista.forEach((v) => {
        const g = [v.cidade, v.empreendimento].filter(Boolean).join(" · ");
        if (g !== grupo) { grupo = g; corpo += `<div class="grupo">${esc(g || "Sem empreendimento")}</div>`; }
        const quando = v.app && v.app.atribuidoEm ? "Recebida em " + dataBr(v.app.atribuidoEm) : "";
        corpo += `<div class="card">
          <div class="lote">${esc(rotuloLote(v))}</div>
          <div class="emp">${esc([v.costCenterId, v.empreendimento].filter(Boolean).join(" - "))}</div>
          <div class="info">
            <span class="quando">${esc(quando)}</span>
            <a class="btn" href="/vistoria.html?id=${encodeURIComponent(v.id)}&app=1">Fazer vistoria</a>
          </div>
        </div>`;
      });
    } else {
      lista.forEach((v) => {
        const ok = v.status === "concluida";
        corpo += `<div class="card">
          <div class="lote">${esc(rotuloLote(v))}</div>
          <div class="emp">${esc([v.cidade, v.empreendimento].filter(Boolean).join(" · "))}</div>
          <div class="info">
            <span class="quando">${esc(v.enviadoEm ? "Enviada em " + dataBr(v.enviadoEm) : "")}</span>
            <span class="selo ${ok ? "ok" : "validacao"}">${ok ? "Validada" : "Em validação"}</span>
          </div>
        </div>`;
      });
    }

    raiz.innerHTML = `<header>
        <img src="/vistoria-app/icone-192.png" alt="">
        <div class="tit"><b>Olá, ${esc(primeiroNome(estado.usuario.nome))}</b><span>Minhas vistorias</span></div>
        <button type="button" id="sair">Sair</button>
      </header>
      <main>
        <div class="abas">
          <button type="button" data-aba="novas" class="${estado.aba === "novas" ? "on" : ""}">Novas<span class="qtd">${novas.length}</span></button>
          <button type="button" data-aba="feitas" class="${estado.aba === "feitas" ? "on" : ""}">Realizadas<span class="qtd">${feitas.length}</span></button>
        </div>
        <div class="barra"><span>Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><button type="button" id="atualizar">Atualizar</button></div>
        ${corpo}
      </main>`;
    document.getElementById("sair").onclick = sair;
    document.getElementById("atualizar").onclick = recarregar;
    raiz.querySelectorAll("[data-aba]").forEach((b) => { b.onclick = () => { estado.aba = b.getAttribute("data-aba"); pintar(); }; });
  }

  async function recarregar() {
    const b = document.getElementById("atualizar");
    if (b) { b.disabled = true; b.textContent = "Atualizando…"; }
    try {
      await carregarVistorias();
      pintar();
    } catch (e) {
      telaAviso("Não foi possível carregar as vistorias", (e && e.message) || String(e));
    }
  }

  async function iniciar() {
    if (!window.msal) {
      telaEntrar("O login da Microsoft não carregou. Verifique a internet e abra o app de novo.");
      return;
    }
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: AZURE.clientId,
        authority: "https://login.microsoftonline.com/" + AZURE.tenantId,
        redirectUri: URL_APP
      },
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true }
    });
    try {
      if (typeof msalApp.initialize === "function") await msalApp.initialize();
      const resp = await msalApp.handleRedirectPromise();
      estado.conta = (resp && resp.account) || msalApp.getAllAccounts()[0] || null;
    } catch (e) {
      const msg = String((e && (e.errorMessage || e.message)) || e);
      telaEntrar(/AADSTS50011/.test(msg)
        ? "O endereço do app ainda não foi liberado no Azure. Avise o administrador do Integra."
        : "Não foi possível entrar: " + msg);
      return;
    }
    if (!estado.conta) { telaEntrar(); return; }
    const email = String(estado.conta.username || "").trim().toLowerCase();
    try {
      await esperarFirebase();
      const u = await lerUsuario(email);
      const ativo = u && (!u.status || String(u.status).toUpperCase() !== "INATIVO");
      if (!u || !ativo || !u.check_construction) {
        telaAviso("Acesso não liberado", "Seu usuário não está liberado como vistoriador no Integra. Peça ao administrador para marcar o seu cadastro como de construção.");
        return;
      }
      estado.usuario = { email, nome: u.name || estado.conta.name || email };
      await carregarVistorias();
      pintar();
    } catch (e) {
      telaAviso("Não foi possível carregar as vistorias", (e && e.message) || String(e));
    }
  }

  // Volta para o app (por exemplo, depois de enviar uma vistoria): atualiza a lista.
  window.addEventListener("pageshow", (ev) => { if (ev.persisted && estado.usuario) recarregar(); });

  iniciar();
})();
