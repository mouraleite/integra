// Módulo de Autenticação Microsoft Azure AD (MSAL.js)
// Moura Leite Loteamentos - CRM de Cobrança

const AZURE_CONFIG_KEY = "crm_moura_azure_config";
const USER_SESSION_KEY = "crm_moura_user_session";

const DEFAULT_AZURE_CONFIG = {
  clientId: "643259b4-6f72-4f25-8a2d-ac131a34f169",
  tenantId: "34bf99e3-12de-4814-ab19-0d0f90fab15b",
  redirectUri: window.location.origin + window.location.pathname,
  enabled: true
};

let g_authConfig = DEFAULT_AZURE_CONFIG;
let msalInstance = null;
let msalReady = null;
let loginInFlight = false;
let sessionChannel = null;

function readSessionFromStore(store) {
  if (!store) return null;
  try {
    const raw = store.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (user && user.email && user.isAuthenticated !== false) return user;
  } catch (e) {}
  return null;
}

function persistSession(user, fromBroadcast) {
  if (!user || !user.email) return user;
  const payload = JSON.stringify({
    name: user.name || "",
    email: String(user.email || "").toLowerCase(),
    isAuthenticated: true,
    method: user.method || "Azure AD"
  });
  try { localStorage.setItem(USER_SESSION_KEY, payload); } catch (e) {
    console.warn("Nao foi possivel gravar a sessao no localStorage:", e);
  }
  try { sessionStorage.setItem(USER_SESSION_KEY, payload); } catch (e) {}
  if (!fromBroadcast && sessionChannel) {
    try { sessionChannel.postMessage({ type: "session", user: JSON.parse(payload) }); } catch (e) {}
  }
  return user;
}

function clearPersistedSession(fromBroadcast) {
  try { localStorage.removeItem(USER_SESSION_KEY); } catch (e) {}
  try { sessionStorage.removeItem(USER_SESSION_KEY); } catch (e) {}
  if (!fromBroadcast && sessionChannel) {
    try { sessionChannel.postMessage({ type: "logout" }); } catch (e) {}
  }
}

function initSessionChannel() {
  if (sessionChannel || typeof BroadcastChannel === "undefined") return;
  try {
    sessionChannel = new BroadcastChannel("crm_moura_auth");
    sessionChannel.onmessage = (ev) => {
      const msg = ev && ev.data;
      if (!msg) return;
      if (msg.type === "session" && msg.user) persistSession(msg.user, true);
      if (msg.type === "logout") clearPersistedSession(true);
    };
  } catch (e) {}
}

function saveAuthConfig(config) {
  g_authConfig = { ...g_authConfig, ...config };
  try {
    localStorage.setItem(AZURE_CONFIG_KEY, JSON.stringify(g_authConfig));
  } catch (e) {}
  initializeMsal();
}

function previewDaVercel() {
  const host = String(window.location.hostname || "").toLowerCase();
  return host.endsWith(".vercel.app") && host !== "crm-gestao.vercel.app";
}

function clearMsalInteractionLock() {
  const wipe = (store) => {
    if (!store) return;
    const keys = [];
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k) continue;
        const kl = k.toLowerCase();
        if (kl.includes("msal") && (kl.includes("interaction") || kl.includes("request.origin"))) {
          keys.push(k);
        }
      }
      keys.forEach((k) => store.removeItem(k));
    } catch (e) {}
  };
  wipe(window.sessionStorage);
  wipe(window.localStorage);
}

function resetMsalClient() {
  clearMsalInteractionLock();
  msalInstance = null;
  msalReady = null;
  initializeMsal();
}

function usuarioDaResposta(loginResponse) {
  const account = loginResponse && loginResponse.account;
  const email = account && account.username;
  if (!email) throw new Error("A Microsoft não devolveu a conta.");
  if (!validateDomain(email)) {
    throw new Error("Acesso negado. Apenas e-mails do domínio @mouraleite.com.br são permitidos.");
  }
  return {
    name: account.name || email.split("@")[0].toUpperCase(),
    email: email,
    isAuthenticated: true,
    method: "Azure AD"
  };
}

function mensagemLoginMicrosoft(error) {
  const msg = String((error && (error.errorMessage || error.message)) || error || "");
  if (/AADSTS50011|redirect_uri/i.test(msg)) {
    return new Error("Este endereço de teste não está autorizado no aplicativo Microsoft do Integra. Cadastre " + window.location.origin + "/ nas URIs de redirecionamento SPA.");
  }
  return error;
}

function initializeMsal() {
  if (msalInstance) return;
  if (g_authConfig.enabled && g_authConfig.clientId && g_authConfig.tenantId && window.msal) {
    const msalConfig = {
      auth: {
        clientId: g_authConfig.clientId,
        authority: `https://login.microsoftonline.com/${g_authConfig.tenantId}`,
        redirectUri: g_authConfig.redirectUri
      },
      cache: {
        cacheLocation: "localStorage",
        storeAuthStateInCookie: true
      }
    };
    try {
      msalInstance = new msal.PublicClientApplication(msalConfig);
      msalReady = (typeof msalInstance.initialize === "function")
        ? msalInstance.initialize().catch((e) => {
            console.warn("MSAL initialize:", e);
          })
        : Promise.resolve();
    } catch (e) {
      console.error("Erro ao inicializar o MSAL.js:", e);
      msalInstance = null;
      msalReady = Promise.resolve();
    }
  } else {
    msalInstance = null;
    msalReady = Promise.resolve();
  }
}

function getCurrentUser() {
  const fromLocal = readSessionFromStore(window.localStorage);
  if (fromLocal) {
    try { sessionStorage.setItem(USER_SESSION_KEY, JSON.stringify(fromLocal)); } catch (e) {}
    return fromLocal;
  }
  return readSessionFromStore(window.sessionStorage);
}

function userFromMsalAccount(account) {
  if (!account || !account.username) return null;
  const email = String(account.username || "").toLowerCase();
  if (!validateDomain(email)) return null;
  return {
    name: account.name || email.split("@")[0].toUpperCase(),
    email: email,
    isAuthenticated: true,
    method: "Azure AD"
  };
}

async function consumirRetornoMicrosoft() {
  if (!msalInstance || typeof msalInstance.handleRedirectPromise !== "function") return null;
  if (msalReady) {
    try { await msalReady; } catch (e) {}
  }
  let resposta;
  try {
    resposta = await msalInstance.handleRedirectPromise();
  } catch (error) {
    if (isInteractionInProgress(error)) {
      resetMsalClient();
      return null;
    }
    window._crmErroLoginMicrosoft = mensagemLoginMicrosoft(error);
    return null;
  }
  if (!resposta || !resposta.account) return null;
  return persistSession(usuarioDaResposta(resposta));
}

async function restoreSession() {
  initSessionChannel();
  if (msalReady) {
    try { await msalReady; } catch (e) {}
  }
  const vindoDaMicrosoft = await consumirRetornoMicrosoft();
  if (vindoDaMicrosoft) return vindoDaMicrosoft;
  const existing = getCurrentUser();
  if (existing) return existing;

  if (msalInstance && typeof msalInstance.getAllAccounts === "function") {
    const accounts = msalInstance.getAllAccounts() || [];
    const user = userFromMsalAccount(accounts[0]);
    if (user) return persistSession(user);
  }
  return null;
}

function validateDomain(email) {
  if (!email) return false;
  const domain = email.split("@")[1];
  return domain && (domain.toLowerCase() === "mouraleite.com" || domain.toLowerCase() === "mouraleite.com.br");
}

function isInteractionInProgress(error) {
  const code = String((error && error.errorCode) || "");
  const msg = String((error && error.message) || error || "");
  return code === "interaction_in_progress" || /interaction_in_progress|interaction is currently in progress/i.test(msg);
}

async function login() {
  if (loginInFlight) {
    throw new Error("Login já em andamento. Feche o popup da Microsoft ou atualize a página.");
  }
  loginInFlight = true;
  try {
    if (g_authConfig.enabled && msalInstance) {
      if (msalReady) await msalReady;
      const loginRequest = {
        scopes: ["user.read"],
        prompt: "select_account"
      };
      const pedir = async () => {
        if (previewDaVercel()) return msalInstance.loginRedirect(loginRequest);
        return msalInstance.loginPopup(loginRequest);
      };
      let loginResponse;
      try {
        loginResponse = await pedir();
      } catch (error) {
        if (!isInteractionInProgress(error)) throw error;
        resetMsalClient();
        if (msalReady) await msalReady;
        loginResponse = await pedir();
      }

      if (previewDaVercel()) return new Promise(function () {});

      persistSession(usuarioDaResposta(loginResponse));
      return getCurrentUser();
    }

    if (g_authConfig.enabled) {
      throw new Error("Login Microsoft indisponível. Atualize a página (Ctrl+F5) e tente de novo.");
    }

    return new Promise((resolve, reject) => {
      window.showMockLoginModal(resolve, reject);
    });
  } catch (error) {
    console.error("Falha no login Azure AD:", error);
    if (isInteractionInProgress(error)) {
      resetMsalClient();
    }
    throw mensagemLoginMicrosoft(error);
  } finally {
    loginInFlight = false;
  }
}

async function logout(opts) {
  // Acesso compartilhado: esta aba sai, as outras pessoas no mesmo login continuam.
  if (opts && opts.manterOutrasAbas) {
    try { sessionStorage.removeItem(USER_SESSION_KEY); } catch (e) {}
    try { sessionStorage.setItem("crm_aba_encerrada", "1"); } catch (e) {}
    window.location.reload();
    return;
  }
  try { sessionStorage.removeItem("crm_aba_encerrada"); } catch (e) {}
  clearPersistedSession(!!(opts && opts.silent));
  window.location.reload();
}

// Token do login Microsoft que o navegador manda para a API do Integra (cabeçalho X-Integra-Token).
// Nunca trava a tela: se não conseguir, devolve "" e a chamada segue sem ele.
let tokenIntegra = { valor: "", exp: 0 };
let tokenIntegraBuscando = null;

function expiracaoDoToken(token) {
  try {
    const parte = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const dados = JSON.parse(atob(parte + "===".slice((parte.length + 3) % 4)));
    return Number(dados.exp || 0) * 1000;
  } catch (e) {
    return 0;
  }
}

function contaMicrosoftAtual() {
  if (!msalInstance || typeof msalInstance.getAllAccounts !== "function") return null;
  const contas = msalInstance.getAllAccounts() || [];
  if (!contas.length) return null;
  const sessao = getCurrentUser();
  const email = String((sessao && sessao.email) || "").toLowerCase();
  return contas.find((c) => String(c.username || "").toLowerCase() === email) || contas[0];
}

function getIntegraTokenSync() {
  return tokenIntegra.valor && tokenIntegra.exp - Date.now() > 60 * 1000 ? tokenIntegra.valor : "";
}

async function buscarTokenIntegra() {
  if (msalReady) {
    try { await msalReady; } catch (e) {}
  }
  const conta = contaMicrosoftAtual();
  if (!conta || typeof msalInstance.acquireTokenSilent !== "function") return "";
  const pedir = async (renovar) => {
    const r = await msalInstance.acquireTokenSilent({ scopes: ["user.read"], account: conta, forceRefresh: !!renovar });
    return (r && r.idToken) || "";
  };
  let token = await pedir(false);
  if (!token || expiracaoDoToken(token) - Date.now() < 5 * 60 * 1000) token = await pedir(true);
  if (token) tokenIntegra = { valor: token, exp: expiracaoDoToken(token) };
  return token || "";
}

async function getIntegraToken() {
  const pronto = getIntegraTokenSync();
  if (pronto && tokenIntegra.exp - Date.now() > 5 * 60 * 1000) return pronto;
  if (!tokenIntegraBuscando) {
    tokenIntegraBuscando = buscarTokenIntegra()
      .catch(() => "")
      .finally(() => { tokenIntegraBuscando = null; });
  }
  const limite = new Promise((resolve) => setTimeout(() => resolve(""), 3000));
  const novo = await Promise.race([tokenIntegraBuscando, limite]);
  return novo || pronto || "";
}

// Para ações sensíveis (ex.: publicar na produção): se não houver token pronto, abre a janela da
// Microsoft na hora. Deve ser chamada direto no clique (sem esperar nada antes), senão o navegador
// bloqueia a janela.
function getIntegraTokenInterativo() {
  const pronto = getIntegraTokenSync();
  if (pronto) return Promise.resolve(pronto);
  if (!msalInstance || typeof msalInstance.acquireTokenPopup !== "function") return Promise.resolve("");
  const sessao = getCurrentUser();
  const pedido = { scopes: ["user.read"] };
  const conta = contaMicrosoftAtual();
  if (conta) pedido.account = conta;
  else if (sessao && sessao.email) pedido.loginHint = sessao.email;
  const guardar = (r) => {
    const token = (r && r.idToken) || "";
    if (token) tokenIntegra = { valor: token, exp: expiracaoDoToken(token) };
    return token;
  };
  return msalInstance.acquireTokenPopup(pedido).then(guardar).catch((e) => {
    console.warn("[Integra] Não foi possível confirmar o login Microsoft:", (e && (e.errorCode || e.message)) || e);
    return "";
  });
}

initSessionChannel();
initializeMsal();

window.MouraAuth = {
  login,
  logout,
  getCurrentUser,
  restoreSession,
  persistSession,
  getAuthConfig: () => g_authConfig,
  saveAuthConfig,
  validateDomain,
  clearMsalInteractionLock,
  getIntegraToken,
  getIntegraTokenSync,
  getIntegraTokenInterativo
};
