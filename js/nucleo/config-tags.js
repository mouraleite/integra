// MÓDULO: CONFIGURAÇÕES > TAGS DE ANEXOS

const ConfigTagsApp = {
  currentTags: [],
  _loading: false,

  // As TAGs estão no Supabase (tabela tags), via window.DadosNucleo.
  waitDados(maxMs = 8000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (window.DadosNucleo) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= maxMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  },

  showStatus(html) {
    const root = document.getElementById("config-tags-root");
    if (!root) return;
    root.innerHTML = `<div style="padding: 40px 20px; text-align: center; color: #64748b;">${html}</div>`;
    if (window.lucide) lucide.createIcons();
  },

  async loadTags() {
    if (this._loading) return;
    this._loading = true;
    this.showStatus(`
      <div style="display:inline-flex;align-items:center;gap:10px;">
        <i data-lucide="loader" class="spin" style="width:18px;height:18px;"></i>
        Carregando tags de anexos...
      </div>
    `);

    try {
      const ready = await this.waitDados();
      if (!ready) throw new Error("Banco de dados não inicializado. Recarregue a página (Ctrl+F5).");

      const linhas = await window.DadosNucleo.tabela("tags").listar();
      const tags = [];
      linhas.forEach((docSnap) => {
        const data = Object.assign({}, docSnap);
        delete data.id;
        tags.push({
          id: docSnap.id,
          name: String(data.name || data.nome || data.tag || "").trim(),
          destino: data.destino || "Unidade",
          status: data.status || "Ativa",
          is_default: !!data.is_default,
          ...data
        });
      });
      tags.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
      this.renderTagsList(tags);
    } catch (e) {
      console.error("Erro ao buscar tags:", e);
      this.showStatus(`
        <div style="max-width:480px;margin:0 auto;text-align:left;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 18px;color:#991b1b;">
          <div style="font-weight:700;margin-bottom:6px;">Não foi possível carregar as tags</div>
          <div style="font-size:0.85rem;margin-bottom:14px;">${String(e && e.message ? e.message : e)}</div>
          <button class="btn btn-primary" onclick="ConfigTagsApp.loadTags()" style="margin-right:8px;">Tentar novamente</button>
          <button class="btn btn-outline" onclick="ConfigTagsApp.renderTagsList([])">Abrir tela vazia</button>
        </div>
      `);
    } finally {
      this._loading = false;
    }
  },

  renderTagsList(tags) {
    const root = document.getElementById("config-tags-root");
    if (!root) return;

    this.currentTags = Array.isArray(tags) ? tags : [];
    const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const renderTable = (tagList, title, isOpen = true) => {
      const trs = tagList.map((t) => {
        const idArg = JSON.stringify(String(t.id));
        return `
          <tr>
            <td class="tag-nome" title="${esc(t.name || "")}">${esc(t.name || "(sem nome)")}</td>
            <td>${t.destino === "Cliente" ? "Cliente" : "Unidade"}</td>
            <td>${t.status === "Ativa" ? '<span class="tag-st is-on">Ativa</span>' : '<span class="tag-st is-off">Inativa</span>'}</td>
            <td class="is-right">
              <button type="button" class="tvig-ico" title="Editar" onclick='ConfigTagsApp.showTagModal(${idArg})'>
                <i data-lucide="pencil" style="width:15px;height:15px;"></i>
              </button>
              <button type="button" class="tvig-ico is-danger" title="Excluir" onclick='ConfigTagsApp.deleteTag(${idArg})'>
                <i data-lucide="trash-2" style="width:15px;height:15px;"></i>
              </button>
            </td>
          </tr>
        `;
      }).join("");

      return `
        <details class="tags-details-block" ${isOpen ? "open" : ""}>
          <summary>
            <span>${esc(title)} <small>${tagList.length}</small></span>
            <i data-lucide="chevron-down" class="details-icon"></i>
          </summary>
          <div class="cc-scroll tags-scroll">
            <table class="cc-table">
              <colgroup><col><col class="tag-c-dest"><col class="tag-c-st"><col class="tag-c-acao"></colgroup>
              <thead>
                <tr>
                  <th>Nome da TAG</th>
                  <th>Destino</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${trs.length > 0 ? trs : '<tr><td colspan="4" class="is-center" style="padding: 24px; color: var(--color-text-muted);">Nenhuma TAG encontrada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </details>
      `;
    };

    const tagsCliente = this.currentTags.filter((t) => t.destino === "Cliente");
    const tagsUnidade = this.currentTags.filter((t) => t.destino !== "Cliente");

    root.innerHTML = `
      <style>
        .tags-page .cc-toolbar { justify-content: flex-end; align-items: center; }
        .tags-page .tags-novo { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; }
        .tags-page .tags-novo svg { width: 16px; height: 16px; }
        .tags-details-block { margin-bottom: 12px; }
        .tags-details-block summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 6px 2px; font-size: 0.8rem; font-weight: 700; color: #105436; text-transform: uppercase; letter-spacing: 0.03em; }
        .tags-details-block summary::-webkit-details-marker { display: none; }
        .tags-details-block summary small { margin-left: 6px; padding: 1px 7px; border-radius: 99px; background: #e7f6ee; color: #105436; font-size: 0.7rem; }
        .tags-details-block summary .details-icon { width: 16px; height: 16px; transition: transform 0.2s ease; }
        .tags-details-block[open] summary .details-icon { transform: rotate(180deg); }
        .tags-page .tags-scroll { max-height: 60vh; }
        .tags-page .cc-table col.tag-c-dest { width: 110px; }
        .tags-page .cc-table col.tag-c-st { width: 90px; }
        .tags-page .cc-table col.tag-c-acao { width: 84px; }
        .tags-page .cc-table td.is-right { padding-top: 0; padding-bottom: 0; }
        .tags-page .tag-st { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 0.68rem; font-weight: 700; }
        .tags-page .tag-st.is-on { background: #dcfce7; color: #105436; }
        .tags-page .tag-st.is-off { background: #fee2e2; color: #b91c1c; }
      </style>
      <div class="cc-page tags-page">
        <div class="cc-toolbar">
          <button class="btn btn-primary tags-novo" onclick="ConfigTagsApp.showTagModal()"><i data-lucide="plus"></i> Criar TAG</button>
        </div>

        ${renderTable(tagsCliente, "Tags de Clientes", true)}
        ${renderTable(tagsUnidade, "Tags de Unidades", true)}
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  },

  showTagModal(id = null) {
    const tag = id ? this.currentTags.find((t) => String(t.id) === String(id)) : null;

    const existingModal = document.getElementById("tag-modal-overlay");
    if (existingModal) existingModal.remove();

    const title = tag ? "Editar TAG" : "Nova TAG";
    const nameVal = tag ? (tag.name || "") : "";
    const destinoVal = tag ? (tag.destino || "Unidade") : "Unidade";
    const statusVal = tag ? (tag.status || "Ativa") : "Ativa";
    const idLiteral = tag ? JSON.stringify(String(tag.id)) : "null";

    const modalHTML = `
      <div id="tag-modal-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; backdrop-filter: blur(2px);">
        <div class="card" style="width: 400px; max-width: 90%; background: #ffffff; border: none; border-top: 4px solid var(--color-bg-dark); box-shadow: 0 10px 30px rgba(0,0,0,0.15); border-radius: 8px;">
          <div class="card-body" style="padding: 25px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h3 style="margin: 0; color: var(--color-bg-dark); font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                <i data-lucide="tag" style="color: var(--color-bg-dark); width: 20px;"></i> ${title}
              </h3>
              <button type="button" class="btn btn-fechar" onclick="document.getElementById('tag-modal-overlay').remove()">Fechar</button>
            </div>

            <div style="margin-bottom: 15px;">
              <label style="display: block; margin-bottom: 8px; font-size: 0.8rem; color: #6d8c7c; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Nome da TAG</label>
              <input type="text" id="modal-tag-name" class="form-control" style="width: 100%; padding: 10px 12px; border: 1px solid #e0e5e0; background: #fff; color: var(--color-text); border-radius: 6px; text-transform: uppercase;" value="${String(nameVal).replace(/"/g, "&quot;")}">
            </div>

            <div style="margin-bottom: 15px;">
              <label style="display: block; margin-bottom: 8px; font-size: 0.8rem; color: #6d8c7c; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Destino</label>
              <select id="modal-tag-destino" class="form-control" style="width: 100%; padding: 10px 12px; border: 1px solid #e0e5e0; background: #fff; color: var(--color-text); border-radius: 6px;">
                <option value="Unidade" ${destinoVal === "Unidade" ? "selected" : ""}>Unidade</option>
                <option value="Cliente" ${destinoVal === "Cliente" ? "selected" : ""}>Cliente</option>
              </select>
            </div>

            <div style="margin-bottom: 25px;">
              <label style="display: block; margin-bottom: 8px; font-size: 0.8rem; color: #6d8c7c; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Status</label>
              <select id="modal-tag-status" class="form-control" style="width: 100%; padding: 10px 12px; border: 1px solid #e0e5e0; background: #fff; color: var(--color-text); border-radius: 6px;">
                <option value="Ativa" ${statusVal === "Ativa" ? "selected" : ""}>Ativa</option>
                <option value="Inativa" ${statusVal === "Inativa" ? "selected" : ""}>Inativa</option>
              </select>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              <button class="btn btn-primary" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #1b8253 0%, #115736 100%); border: none; color: #fff; font-weight: 600; font-size: 1rem; border-radius: 6px; display: flex; justify-content: center; align-items: center; gap: 8px;" onclick='ConfigTagsApp.saveTag(${idLiteral})'>
                <i data-lucide="save" style="width: 18px;"></i> Salvar TAG
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
    if (window.lucide) lucide.createIcons();
  },

  async saveTag(id) {
    const nome = document.getElementById("modal-tag-name").value.trim().toUpperCase();
    const destino = document.getElementById("modal-tag-destino").value;
    const status = document.getElementById("modal-tag-status").value;

    if (!nome) {
      alert("O nome da TAG é obrigatório!");
      return;
    }

    const email = (typeof AppState !== "undefined" && AppState.currentUser && AppState.currentUser.email)
      ? AppState.currentUser.email
      : ((typeof window.listCrmAdministrators === "function" && window.listCrmAdministrators()[0] && window.listCrmAdministrators()[0].email)
        || "");

    try {
      const ready = await this.waitDados(3000);
      if (!ready) throw new Error("Banco de dados não inicializado.");

      const tagData = { name: nome, destino, status, created_by: email };

      if (id) {
        // updateDoc: só os campos de tagData mudam (merge sobre a linha atual).
        await window.DadosNucleo.tabela("tags").gravar(String(id), tagData, { merge: true });
      } else {
        await window.DadosNucleo.tabela("tags").criar(tagData);
      }

      const overlay = document.getElementById("tag-modal-overlay");
      if (overlay) overlay.remove();
      this.loadTags();
      if (window.AnexosApp && typeof AnexosApp.loadTagsAtivas === "function") {
        AnexosApp.loadTagsAtivas(true);
      }
    } catch (e) {
      alert("Erro ao salvar TAG: " + e.message);
    }
  },

  async deleteTag(id) {
    if (!confirm("Tem certeza que deseja excluir esta TAG? Esta ação não pode ser desfeita.")) return;
    try {
      const ready = await this.waitDados(3000);
      if (!ready) throw new Error("Banco de dados não inicializado.");
      await window.DadosNucleo.tabela("tags").excluir(String(id));
      this.loadTags();
    } catch (e) {
      alert("Erro ao excluir TAG: " + e.message);
    }
  }
};

window.ConfigTagsApp = ConfigTagsApp;

document.addEventListener("tabChanged", (e) => {
  if (e.detail === "config-tags") ConfigTagsApp.loadTags();
});

// ===== SOLICITAÇÃO DE NOVA TAG (Firestore: tag_solicitacoes) =====

const TAG_STOP = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "A", "O", "AS", "OS", "EM", "NO", "NA", "PARA", "COM", "POR"]);

function tagNorm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tagTokens(s) {
  return tagNorm(s).split(" ")
    .filter((t) => t && !TAG_STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith("S") ? t.slice(0, -1) : t))
    .map((t) => TAG_SINONIMOS[t] || t);
}

// Palavras que significam a mesma coisa nos documentos.
const TAG_SINONIMOS = { ENDERECO: "RESIDENCIA", END: "RESIDENCIA", IDENTIDADE: "RG", HABILITACAO: "CNH" };

function tagCompacto(s) { return tagTokens(s).join(""); }

function tagLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function tagPalavraIgual(a, b) {
  if (a === b) return true;
  const curta = a.length <= b.length ? a : b;
  const longa = curta === a ? b : a;
  if (curta.length >= 3 && longa.startsWith(curta)) return true; // abreviação: COMP x COMPROVANTE
  return curta.length >= 5 && tagLevenshtein(a, b) <= 1;           // erro de digitação
}

/** Compara o nome pedido com as TAGs existentes. Retorna as parecidas, da mais para a menos parecida. */
window.crmTagsSemelhantes = function(nome, tags) {
  const nNorm = tagNorm(nome);
  const nComp = tagCompacto(nome);
  const nTok = tagTokens(nome);
  if (!nNorm) return [];
  const out = [];
  (tags || []).forEach((t) => {
    const nomeTag = String((t && t.name) || "").trim();
    if (!nomeTag) return;
    const tNorm = tagNorm(nomeTag);
    const tComp = tagCompacto(nomeTag);
    const tTok = tagTokens(nomeTag);
    let score = 0;
    let motivo = "";
    const marcar = (s, m) => { if (s > score) { score = s; motivo = m; } };

    if (tNorm === nNorm) marcar(1, "Mesmo nome");
    else if (tComp && tComp === nComp) marcar(0.97, "Mesmo nome com outra escrita");

    const menor = nComp.length <= tComp.length ? nComp : tComp;
    const maior = menor === nComp ? tComp : nComp;
    if (menor.length >= 3 && maior.indexOf(menor) >= 0) marcar(0.85, "Um nome contém o outro");

    if (nTok.length && tTok.length) {
      const comuns = nTok.filter((a) => tTok.some((b) => tagPalavraIgual(a, b)));
      const uniao = nTok.length + tTok.length - comuns.length;
      const jac = uniao ? comuns.length / uniao : 0;
      if (comuns.length && jac >= 0.3) {
        const palavras = Array.from(new Set(tTok.filter((b) => nTok.some((a) => tagPalavraIgual(a, b))))).join(", ");
        marcar(Math.min(0.9, 0.45 + jac * 0.45), "Palavras em comum: " + palavras);
      }
    }

    const maxLen = Math.max(nComp.length, tComp.length);
    if (maxLen >= 4) {
      const ratio = 1 - tagLevenshtein(nComp, tComp) / maxLen;
      if (ratio >= 0.75) marcar(ratio * 0.95, "Escrita parecida");
    }

    if (score >= 0.5) out.push({ tag: t, score, motivo, igual: score >= 0.97 });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
};

window.crmTagSolEsc = function(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

/** HTML da lista de TAGs parecidas (usado no pedido e na aprovação). */
window.crmTagSemelhantesHtml = function(lista, destinoPedido) {
  const esc = window.crmTagSolEsc;
  if (!lista.length) {
    return '<div class="tagsol-ok"><i data-lucide="check-circle" style="width:15px;height:15px;"></i> Nenhuma TAG parecida encontrada.</div>';
  }
  const linhas = lista.map((s) => {
    const mesmoDestino = !destinoPedido || s.tag.destino === destinoPedido;
    return `<tr class="${s.igual && mesmoDestino ? "is-igual" : ""}">
      <td title="${esc(s.tag.name)}">${esc(s.tag.name)}</td>
      <td>${esc(s.tag.destino || "Unidade")}</td>
      <td title="${esc(s.motivo)}">${esc(s.motivo)}</td>
      <td class="is-right">${Math.round(s.score * 100)}%</td>
    </tr>`;
  }).join("");
  return `<div class="tagsol-aviso"><i data-lucide="alert-triangle" style="width:15px;height:15px;"></i> Já existem TAGs parecidas. Veja se alguma serve antes de criar outra.</div>
    <div class="cc-scroll tagsol-scroll"><table class="cc-table">
      <colgroup><col><col style="width:70px"><col><col style="width:52px"></colgroup>
      <thead><tr><th>TAG existente</th><th>Destino</th><th>Por que parece</th><th class="is-right">Grau</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;
};

/** Lista de todas as TAGs com busca e filtro de destino, para consulta rápida. */
window.crmTagListaTodasHtml = function(tags) {
  const esc = window.crmTagSolEsc;
  const lista = tags || [];
  const linhas = lista.map((t) => `<tr data-busca="${esc(tagNorm(t.name))}" data-destino="${esc(t.destino)}">
      <td title="${esc(t.name)}">${esc(t.name)}</td><td>${esc(t.destino)}</td><td>${esc(t.status)}</td></tr>`).join("")
    || '<tr><td colspan="3" style="text-align:center;padding:20px;">Nenhuma TAG cadastrada.</td></tr>';
  return `<div class="tagsol-todas">
    <div class="tagsol-todas-tit">Todas as TAGs cadastradas <small>${lista.length}</small></div>
    <div class="tagsol-todas-filtros">
      <input type="search" placeholder="Buscar TAG..." oninput="crmTagFiltrarTodas(this)">
      <select onchange="crmTagFiltrarTodas(this)">
        <option value="">Unidade e Cliente</option>
        <option value="Unidade">Unidade</option>
        <option value="Cliente">Cliente</option>
      </select>
    </div>
    <div class="cc-scroll tagsol-scroll"><table class="cc-table">
      <colgroup><col><col style="width:80px"><col style="width:72px"></colgroup>
      <thead><tr><th>TAG</th><th>Destino</th><th>Status</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>
  </div>`;
};

window.crmTagFiltrarTodas = function(el) {
  const box = el && el.closest(".tagsol-todas");
  if (!box) return;
  const termo = tagNorm((box.querySelector("input") || {}).value || "");
  const dest = (box.querySelector("select") || {}).value || "";
  box.querySelectorAll("tr[data-busca]").forEach((tr) => {
    const ok = (!termo || tr.getAttribute("data-busca").indexOf(termo) >= 0)
      && (!dest || tr.getAttribute("data-destino") === dest);
    tr.style.display = ok ? "" : "none";
  });
};

/** Todas as TAGs (ativas e inativas), para comparar. */
window.crmTagsTodas = async function() {
  // TAGs no Supabase (tabela tags).
  if (!window.DadosNucleo) return [];
  const linhas = await window.DadosNucleo.tabela("tags").listar();
  const tags = [];
  linhas.forEach((d) => {
    const data = d;
    const name = String(data.name || data.nome || data.tag || "").trim();
    if (!name) return;
    const dest = String(data.destino || data.type || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const st = String(data.status == null || data.status === "" ? "ativa" : data.status).toLowerCase().trim();
    tags.push({
      id: d.id,
      name,
      destino: dest.indexOf("client") >= 0 ? "Cliente" : "Unidade",
      status: (st === "inativa" || st === "inativo" || st === "false" || st === "0") ? "Inativa" : "Ativa"
    });
  });
  tags.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return tags;
};

(function injetarCssTagSol() {
  if (document.getElementById("tagsol-css")) return;
  const st = document.createElement("style");
  st.id = "tagsol-css";
  st.textContent = `
    .tagsol-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9000; backdrop-filter: blur(2px); padding: 16px; }
    .tagsol-box { width: 760px; max-width: 100%; max-height: 92vh; overflow: auto; background: #fff; border-top: 4px solid var(--color-bg-dark, #105436); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); padding: 20px 22px; }
    .tagsol-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
    .tagsol-head h3 { margin: 0; color: #105436; font-size: 1.1rem; display: flex; align-items: center; gap: 8px; }
    .tagsol-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .tagsol-meta { font-size: 0.78rem; color: #64748b; margin-bottom: 8px; }
    .tagsol-motivo { font-size: 0.85rem; color: #1c2e24; background: #f7faf8; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; white-space: pre-wrap; }
    .tagsol-campos { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .tagsol-campos label { display: flex; flex-direction: column; gap: 4px; font-size: 0.7rem; font-weight: 700; color: #6d8c7c; text-transform: uppercase; }
    .tagsol-campos .tagsol-nome { flex: 1 1 260px; }
    .tagsol-campos input, .tagsol-campos select { height: 36px; padding: 0 10px; border: 1px solid #e0e5e0; border-radius: 6px; font-size: 0.85rem; text-transform: uppercase; }
    .tagsol-ok { display: flex; align-items: center; gap: 6px; color: #105436; background: #e7f6ee; border-radius: 6px; padding: 7px 10px; font-size: 0.8rem; margin-bottom: 10px; }
    .tagsol-aviso { display: flex; align-items: center; gap: 6px; color: #92400e; background: #fef3c7; border-radius: 6px; padding: 7px 10px; font-size: 0.8rem; margin-bottom: 6px; }
    .tagsol-scroll { max-height: 190px; margin-bottom: 10px; }
    .tagsol-scroll tr.is-igual td { background: #fee2e2; color: #991b1b; font-weight: 700; }
    .tagsol-todas { border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 4px; }
    .tagsol-todas-tit { font-size: 0.8rem; font-weight: 700; color: #105436; text-transform: uppercase; margin-bottom: 8px; }
    .tagsol-todas-tit small { margin-left: 6px; padding: 1px 7px; border-radius: 99px; background: #e7f6ee; font-size: 0.7rem; }
    .tagsol-todas-filtros { display: flex; gap: 8px; margin-bottom: 6px; }
    .tagsol-todas-filtros input, .tagsol-todas-filtros select { height: 34px; padding: 0 10px; border: 1px solid #e0e5e0; border-radius: 6px; font-size: 0.8rem; background: #fff; }
    .tagsol-todas-filtros input { flex: 1 1 auto; min-width: 0; }
    .tagsol-todas-filtros select { flex: 0 0 150px; }
    .tagsol-todas .tagsol-scroll { max-height: 220px; }
    .tagsol-recusa { margin-top: 4px; }
    .tagsol-recusa label { display: block; font-size: 0.7rem; font-weight: 700; color: #6d8c7c; text-transform: uppercase; margin-bottom: 4px; }
    .tagsol-recusa textarea { width: 100%; box-sizing: border-box; border: 1px solid #e0e5e0; border-radius: 6px; padding: 8px 10px; font-size: 0.85rem; resize: vertical; margin-bottom: 8px; font-family: inherit; }
    .tagsol-acoes[hidden], .tagsol-recusa[hidden] { display: none; }
    .tagsol-acoes { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .tagsol-acoes .btn { height: 36px; display: inline-flex; align-items: center; gap: 6px; }
    #req-tag-similares { margin-top: 8px; }
    #req-tag-similares .tagsol-scroll { max-height: 150px; }
  `;
  document.head.appendChild(st);
})();

const CrmTagSolicitacoes = {
  COL: "tag_solicitacoes",
  _unsub: null,
  _avisadas: new Set(), // solicitações já avisadas nesta sessão (o aviso_visto chega ao banco um pouco depois)

  // Solicitações no Supabase (tabela tag_solicitacoes, via window.DadosEngenharia).
  tab() {
    return window.DadosEngenharia ? window.DadosEngenharia.tabela(this.COL) : null;
  },
  _timer: null,
  _pendentes: [],
  _adiadas: new Set(),
  _tags: [],

  podeAprovar() {
    try {
      return !!((typeof window.crmAdministradorReal === "function" && window.crmAdministradorReal())
        || (typeof window.crmBackOfficeReal === "function" && window.crmBackOfficeReal()));
    } catch (e) { return false; }
  },

  usuario() {
    const u = (window.AppState && AppState.currentUser) || {};
    const nome = typeof window.crmNomeReal === "function" ? window.crmNomeReal() : (u.name || "");
    return { email: String(u.email || "").trim().toLowerCase(), nome: String(nome || "").trim() };
  },

  iniciar() {
    if (this._timer) return;
    this._timer = setInterval(() => this.verificar(), 4000);
    this.verificar();
  },

  verificar() {
    if (!this.tab()) return;
    if (!(window.AppState && AppState.currentUser)) return;
    this.ouvirMinhas();
    if (this._unsub || !this.podeAprovar()) return;
    this._unsub = this.tab().ouvir(({ docs }) => {
      const lista = docs.slice();
      lista.sort((a, b) => String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
      this._pendentes = lista;
      this.abrir(false);
    }, { filtros: [["status", "eq", "Pendente"]], aoErro: (err) => console.warn("[Tags] solicitações", err) });
  },

  /** Avisa quem pediu quando a TAG for aprovada ou recusada. */
  ouvirMinhas() {
    if (this._unsubMinhas) return;
    const { email } = this.usuario();
    if (!email) return;
    const tab = this.tab();
    this._unsubMinhas = tab.ouvir(({ docs }) => {
      docs.forEach((s) => {
        if (s.status === "Pendente" || s.aviso_visto || this._avisadas.has(s.id)) return;
        this._avisadas.add(s.id);
        tab.gravar(s.id, { aviso_visto: true }, { merge: true }).catch(() => {});
        const msg = s.status === "Aprovada"
          ? `Sua solicitação de TAG foi aprovada. A TAG "${s.tag_criada || s.tag_name}" já está disponível.`
          : `Sua solicitação da TAG "${s.tag_name}" não foi aprovada.` + (s.motivo_decisao ? `\nMotivo: ${s.motivo_decisao}` : "");
        setTimeout(() => alert(msg), 300);
      });
    }, { filtros: [["solicitado_por_email", "eq", email]], aoErro: (err) => console.warn("[Tags] minhas solicitações", err) });
  },

  async abrir(forcar) {
    if (!this.podeAprovar()) return;
    if (forcar) this._adiadas.clear();
    const visiveis = this._pendentes.filter((p) => !this._adiadas.has(p.id));
    const overlay = document.getElementById("tagsol-overlay");
    if (!visiveis.length) { if (overlay) overlay.remove(); return; }
    // Não redesenha enquanto a pessoa está digitando no pop-up.
    if (overlay && overlay.contains(document.activeElement) && !forcar) {
      const ids = Array.from(overlay.querySelectorAll("[data-sol-id]")).map((el) => el.getAttribute("data-sol-id")).join("|");
      if (ids === visiveis.map((p) => p.id).join("|")) return;
    }
    try { this._tags = await window.crmTagsTodas(); } catch (e) { console.warn("[Tags] lista", e); }
    this.render(visiveis);
  },

  render(visiveis) {
    const esc = window.crmTagSolEsc;
    const tags = this._tags || [];
    const cards = visiveis.map((p) => {
      const dest = p.type === "Cliente" ? "Cliente" : "Unidade";
      const semelhantes = window.crmTagsSemelhantes(p.tag_name, tags);
      const quando = p.criado_em ? new Date(p.criado_em).toLocaleString("pt-BR") : "";
      const idJs = esc(JSON.stringify(p.id));
      return `<div class="tagsol-card" data-sol-id="${esc(p.id)}">
        <div class="tagsol-meta">Pedido por <b>${esc(p.solicitado_por_nome || p.solicitado_por_email || "—")}</b>${quando ? " em " + esc(quando) : ""}</div>
        <div class="tagsol-campos">
          <label class="tagsol-nome">Nome da TAG<input type="text" id="tagsol-nome-${esc(p.id)}" value="${esc(p.tag_name)}"></label>
          <label>Destino<select id="tagsol-dest-${esc(p.id)}">
            <option value="Unidade" ${dest === "Unidade" ? "selected" : ""}>Unidade</option>
            <option value="Cliente" ${dest === "Cliente" ? "selected" : ""}>Cliente</option>
          </select></label>
        </div>
        <div class="tagsol-motivo"><b>Motivo:</b> ${esc(p.reason || "—")}</div>
        ${window.crmTagSemelhantesHtml(semelhantes, dest)}
        <div class="tagsol-acoes" id="tagsol-acoes-${esc(p.id)}">
          <button type="button" class="btn btn-cancel" onclick='CrmTagSolicitacoes.mostrarRecusa(${idJs}, true)'><i data-lucide="x" style="width:15px;"></i> Recusar</button>
          <button type="button" class="btn btn-primary" onclick='CrmTagSolicitacoes.aprovar(${idJs})'><i data-lucide="check" style="width:15px;"></i> Aprovar e criar TAG</button>
        </div>
        <div class="tagsol-recusa" id="tagsol-recusa-${esc(p.id)}" hidden>
          <label for="tagsol-motivo-${esc(p.id)}">Motivo da recusa</label>
          <textarea id="tagsol-motivo-${esc(p.id)}" rows="2" placeholder="Ex.: use a TAG já existente COMPROVANTE DE RESIDÊNCIA"></textarea>
          <div class="tagsol-acoes">
            <button type="button" class="btn btn-outline" onclick='CrmTagSolicitacoes.mostrarRecusa(${idJs}, false)'>Voltar</button>
            <button type="button" class="btn btn-cancel" onclick='CrmTagSolicitacoes.recusar(${idJs})'><i data-lucide="x" style="width:15px;"></i> Confirmar recusa</button>
          </div>
        </div>
      </div>`;
    }).join("");
    const todasHtml = window.crmTagListaTodasHtml(tags);

    const titulo = visiveis.length === 1 ? "Solicitação de nova TAG" : `${visiveis.length} solicitações de nova TAG`;
    const html = `<div class="tagsol-overlay" id="tagsol-overlay">
      <div class="tagsol-box">
        <div class="tagsol-head">
          <h3><i data-lucide="tag" style="width:20px;"></i> ${titulo}</h3>
          <button type="button" class="btn btn-fechar" onclick="CrmTagSolicitacoes.adiar()">Ver depois</button>
        </div>
        ${cards}
        ${todasHtml}
      </div>
    </div>`;
    const antigo = document.getElementById("tagsol-overlay");
    if (antigo) antigo.remove();
    document.body.insertAdjacentHTML("beforeend", html);
    if (window.lucide) lucide.createIcons();
  },

  mostrarRecusa(id, mostrar) {
    const box = document.getElementById("tagsol-recusa-" + id);
    const acoes = document.getElementById("tagsol-acoes-" + id);
    if (!box) return;
    box.hidden = !mostrar;
    if (acoes) acoes.hidden = !!mostrar;
    if (mostrar) {
      const txt = document.getElementById("tagsol-motivo-" + id);
      if (txt) txt.focus();
    }
  },

  adiar() {
    this._pendentes.forEach((p) => this._adiadas.add(p.id));
    const overlay = document.getElementById("tagsol-overlay");
    if (overlay) overlay.remove();
  },

  async aprovar(id) {
    const p = this._pendentes.find((x) => x.id === id);
    if (!p) return;
    const nomeEl = document.getElementById("tagsol-nome-" + id);
    const destEl = document.getElementById("tagsol-dest-" + id);
    const nome = String(nomeEl ? nomeEl.value : p.tag_name).trim().toUpperCase();
    const destino = destEl && destEl.value === "Cliente" ? "Cliente" : "Unidade";
    if (!nome) { alert("Informe o nome da TAG."); return; }
    try {
      const tags = await window.crmTagsTodas();
      const igual = tags.find((t) => t.destino === destino && tagNorm(t.name) === tagNorm(nome));
      if (igual) {
        alert(`Já existe a TAG "${igual.name}" para ${destino}` + (igual.status === "Inativa" ? " (inativa: reative em Configurações > Tags de anexos)." : ".") + "\nSe ela atende o pedido, use Recusar e informe essa TAG no motivo.");
        return;
      }
      const parecidas = window.crmTagsSemelhantes(nome, tags.filter((t) => t.destino === destino));
      if (parecidas.length && !confirm(`Existem ${parecidas.length} TAG(s) parecida(s), por exemplo "${parecidas[0].tag.name}".\nCriar "${nome}" mesmo assim?`)) return;

      const { email, nome: quem } = this.usuario();
      // A TAG (tags) e a solicitação (tag_solicitacoes) estão no Supabase.
      await window.DadosNucleo.tabela("tags").criar({
        name: nome, destino, status: "Ativa", created_by: email, solicitacao_id: id
      });
      await this.tab().gravar(id, {
        status: "Aprovada", tag_criada: nome, destino_final: destino,
        decidido_por_email: email, decidido_por_nome: quem, decidido_em: new Date().toISOString()
      }, { merge: true });
      if (window.AnexosApp && typeof AnexosApp.loadTagsAtivas === "function") AnexosApp.loadTagsAtivas(true);
      const telaTags = document.getElementById("tab-config-tags");
      if (telaTags && telaTags.classList.contains("active") && window.ConfigTagsApp) ConfigTagsApp.loadTags();
      alert(`TAG "${nome}" criada.`);
    } catch (e) {
      alert("Não foi possível aprovar: " + (e && e.message ? e.message : e));
    }
  },

  async recusar(id) {
    const p = this._pendentes.find((x) => x.id === id);
    if (!p) return;
    const txt = document.getElementById("tagsol-motivo-" + id);
    const motivo = String(txt ? txt.value : "").trim();
    if (!motivo) {
      alert("Informe o motivo da recusa.");
      if (txt) txt.focus();
      return;
    }
    try {
      const { email, nome: quem } = this.usuario();
      await this.tab().gravar(id, {
        status: "Recusada", motivo_decisao: String(motivo).trim(),
        decidido_por_email: email, decidido_por_nome: quem, decidido_em: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      alert("Não foi possível recusar: " + (e && e.message ? e.message : e));
    }
  }
};

window.CrmTagSolicitacoes = CrmTagSolicitacoes;

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => CrmTagSolicitacoes.iniciar(), 3000);
});
