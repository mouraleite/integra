(function () {
  let clicks = 0;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hasAccess() {
    if (typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin()) return true;
    return typeof window.hasCrmPerm === "function" && window.hasCrmPerm("mod_teste");
  }

  function currentUserInfo() {
    const u = (typeof window.crmUsuarioEfetivo === "function" && window.crmUsuarioEfetivo())
      || (typeof window.crmUsuarioAcesso === "function" && window.crmUsuarioAcesso())
      || (window.AppState && window.AppState.currentUser)
      || null;
    if (!u) return { nome: "Não identificado", email: "-", perfil: "-" };
    return {
      nome: u.name || u.displayName || "Usuário",
      email: u.email || "-",
      perfil: u.profile_name || u.profile || "-"
    };
  }

  function refreshIcons(root) {
    if (typeof window.crmCriarIcones === "function") {
      window.crmCriarIcones(root);
    } else if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function render() {
    const root = document.getElementById("teste-root");
    if (!root) return;

    if (!hasAccess()) {
      root.innerHTML = `
        <div class="crm-card">
          <div class="crm-header">
            <h2><i data-lucide="lock" style="width:20px;vertical-align:middle;margin-right:8px;"></i>Acesso restrito</h2>
          </div>
          <p style="margin:0;color:#64748b;">Sem permissão para acessar o módulo Teste.</p>
        </div>
      `;
      refreshIcons(root);
      return;
    }

    const user = currentUserInfo();
    root.innerHTML = `
      <div class="crm-card">
        <div class="crm-header">
          <h2 style="margin:0;display:flex;align-items:center;gap:8px;">
            <i data-lucide="flask-conical" style="width:20px;"></i>
            Módulo Teste
          </h2>
          <button type="button" class="btn btn-primary" id="teste-ping-btn" style="display:inline-flex;align-items:center;gap:6px;">
            <i data-lucide="play" style="width:15px;"></i>
            Executar teste
          </button>
        </div>
        <p style="margin:0 0 16px;color:#475569;font-size:0.92rem;">
          Módulo base criado para validar a estrutura de telas e permissões do IntegrA.
        </p>
        <div class="customer-detail-grid" style="margin-bottom:16px;">
          <div class="detail-item">
            <span class="label" style="font-size:0.75rem;color:#64748b;font-weight:600;text-transform:uppercase;">Módulo</span>
            <span class="val">mod_teste (ativo)</span>
          </div>
          <div class="detail-item">
            <span class="label" style="font-size:0.75rem;color:#64748b;font-weight:600;text-transform:uppercase;">Usuário</span>
            <span class="val">${esc(user.nome)}</span>
          </div>
          <div class="detail-item">
            <span class="label" style="font-size:0.75rem;color:#64748b;font-weight:600;text-transform:uppercase;">E-mail</span>
            <span class="val">${esc(user.email)}</span>
          </div>
          <div class="detail-item">
            <span class="label" style="font-size:0.75rem;color:#64748b;font-weight:600;text-transform:uppercase;">Perfil</span>
            <span class="val">${esc(user.perfil)}</span>
          </div>
        </div>
        <div id="teste-status-box" style="padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:0.86rem;color:#334155;">
          ${clicks === 0
            ? "Aguardando interação. Clique em <strong>Executar teste</strong> para validar o componente."
            : `Teste executado <strong>${clicks}</strong> vez(es) nesta sessão.`}
        </div>
      </div>
    `;

    const btn = document.getElementById("teste-ping-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        clicks += 1;
        const box = document.getElementById("teste-status-box");
        if (box) {
          box.innerHTML = `Teste executado <strong>${clicks}</strong> vez(es) nesta sessão (${esc(new Date().toLocaleTimeString("pt-BR"))}).`;
        }
      });
    }

    refreshIcons(root);
  }

  function init() {
    render();
  }

  window.TesteApp = { init, render };
})();

