// Seleção única padrão do Integra (empresa, empreendimento, centro de custo...).
// Mesmo visual do campo "Centro de Custo (Empreendimento)" do Assistente de Anexos:
// campo de busca + botão de seta + lista com o ID em destaque e o nome completo, sem quebrar linha.
//
// Uso:
//   html:  MlSelectUnico.html({ id: "x-emp", label: "Empresa", items: [{ id: "4", label: "TERRAS DE ITU ..." }],
//                               selectedId: "4", todos: { id: "TODAS", label: "Todas as empresas" }, largura: "380px" })
//   depois de pôr o html na tela:  MlSelectUnico.bind("x-emp", { onSelect: (id) => { ... } })
window.MlSelectUnico = {
  _cfg: {},

  esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  norm(v) {
    return String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  },

  estilo() {
    if (document.getElementById("ml-sel-style")) return;
    const st = document.createElement("style");
    st.id = "ml-sel-style";
    st.textContent = [
      ".ml-sel{display:flex;flex-direction:column;gap:6px;min-width:0;}",
      ".ml-sel>label{font-size:.72rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.02em;margin:0;}",
      ".ml-sel-combo{display:flex;gap:8px;position:relative;align-items:stretch;}",
      ".ml-sel-combo input{flex:1;min-width:0;height:40px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:0 12px;font-size:.88rem;color:#0f172a;background:#fff;text-overflow:ellipsis;}",
      ".ml-sel-combo input:focus{outline:none;border-color:#105436;box-shadow:0 0 0 3px rgba(16,84,54,.12);}",
      ".ml-sel-seta{width:40px;height:40px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#105436;cursor:pointer;padding:0;}",
      ".ml-sel-seta:hover{background:#f1f5f9;}",
      ".ml-sel-lista{position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:min(720px,calc(100vw - 32px));background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 10px 24px rgba(15,23,42,.12);z-index:1200;max-height:300px;overflow-y:auto;overflow-x:hidden;}",
      ".ml-sel-item{padding:10px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;white-space:nowrap;}",
      ".ml-sel-item:last-child{border-bottom:0;}",
      ".ml-sel-item:hover,.ml-sel-item.ativo{background:#f3f4f6;}",
      ".ml-sel-item.sel{background:#eef8f2;}",
      ".ml-sel-id{background:#eef8f2;color:#105436;padding:4px 8px;border-radius:4px;font-weight:700;font-size:.8rem;flex-shrink:0;}",
      ".ml-sel-nome{font-weight:500;font-size:.9rem;color:#0f172a;white-space:nowrap;}",
      ".ml-sel-todos .ml-sel-nome{font-weight:700;color:#105436;}",
      ".ml-sel-vazio{padding:12px;color:#64748b;font-size:.85rem;white-space:nowrap;}"
    ].join("");
    document.head.appendChild(st);
  },

  texto(cfg, id) {
    if (cfg.todos && String(id) === String(cfg.todos.id)) return cfg.todos.label;
    const it = (cfg.items || []).find((i) => String(i.id) === String(id));
    if (!it) return "";
    return cfg.semId ? it.label : it.id + " - " + it.label;
  },

  html(cfg) {
    this.estilo();
    this._cfg[cfg.id] = cfg;
    const valor = this.texto(cfg, cfg.selectedId);
    return `<div class="ml-sel" id="${this.esc(cfg.id)}" style="${cfg.largura ? "width:" + this.esc(cfg.largura) + ";" : ""}">
      ${cfg.label ? `<label for="${this.esc(cfg.id)}-input">${this.esc(cfg.label)}</label>` : ""}
      <div class="ml-sel-combo">
        <input type="text" id="${this.esc(cfg.id)}-input" autocomplete="off" title="${this.esc(valor)}"
          placeholder="${this.esc(cfg.placeholder || "Digite ID, nome ou escolha na lista...")}" value="${this.esc(valor)}">
        <button type="button" class="ml-sel-seta" title="Abrir lista" aria-label="Abrir lista"><i data-lucide="chevron-down" style="width:16px;height:16px;"></i></button>
        <div class="ml-sel-lista" hidden></div>
      </div>
    </div>`;
  },

  bind(id, handlers) {
    const cfg = this._cfg[id];
    const root = document.getElementById(id);
    if (!cfg || !root) return;
    const input = root.querySelector("input");
    const seta = root.querySelector(".ml-sel-seta");
    const lista = root.querySelector(".ml-sel-lista");
    let ativo = -1;
    let visiveis = [];
    let digitou = false;

    const montar = (termo) => {
      const t = this.norm(termo);
      const itens = (cfg.items || []).filter((i) => !t || this.norm(i.id + " " + i.label).indexOf(t) >= 0 || this.norm(i.id + " - " + i.label).indexOf(t) >= 0);
      visiveis = (cfg.todos && !t ? [Object.assign({ todos: true }, cfg.todos)] : []).concat(itens);
      if (!visiveis.length) {
        lista.innerHTML = `<div class="ml-sel-vazio">Nada encontrado</div>`;
      } else {
        lista.innerHTML = visiveis.map((i, idx) => `<div class="ml-sel-item${i.todos ? " ml-sel-todos" : ""}${String(i.id) === String(cfg.selectedId) ? " sel" : ""}${idx === ativo ? " ativo" : ""}" data-idx="${idx}">
          ${i.todos || cfg.semId ? "" : `<span class="ml-sel-id">${this.esc(i.id)}</span>`}
          <span class="ml-sel-nome">${this.esc(i.label)}</span>
        </div>`).join("");
      }
      lista.hidden = false;
    };
    const fechar = () => {
      lista.hidden = true;
      ativo = -1;
      if (digitou) { input.value = this.texto(cfg, cfg.selectedId); digitou = false; }
    };
    const escolher = (idx) => {
      const it = visiveis[idx];
      if (!it) return;
      cfg.selectedId = String(it.id);
      input.value = this.texto(cfg, cfg.selectedId);
      input.title = input.value;
      digitou = false;
      lista.hidden = true;
      if (handlers && typeof handlers.onSelect === "function") handlers.onSelect(String(it.id));
    };

    input.addEventListener("focus", () => { input.select(); montar(""); });
    input.addEventListener("input", () => { digitou = true; ativo = 0; montar(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (lista.hidden) montar(""); ativo = Math.min(visiveis.length - 1, ativo + 1); montar(digitou ? input.value : ""); }
      else if (e.key === "ArrowUp") { e.preventDefault(); ativo = Math.max(0, ativo - 1); montar(digitou ? input.value : ""); }
      else if (e.key === "Enter") { e.preventDefault(); escolher(ativo >= 0 ? ativo : 0); }
      else if (e.key === "Escape") { fechar(); input.blur(); }
    });
    input.addEventListener("blur", () => setTimeout(fechar, 150));
    seta.addEventListener("mousedown", (e) => e.preventDefault());
    seta.addEventListener("click", () => {
      if (lista.hidden) { input.focus(); montar(""); } else fechar();
    });
    lista.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const item = e.target.closest(".ml-sel-item");
      if (item) escolher(Number(item.getAttribute("data-idx")));
    });
  }
};
