/* Configurações gerais › Departamentos do orçamento — edição mais fácil (no lugar das listas separadas por ";"):
 * centros de custo e planos em seleção múltipla com busca, "Marcar todos" e "Desmarcar todos" (padrão MlEmpresaFilter do Integra),
 * e usuários como etiquetas com ✕ e um campo para incluir e-mail (sugere os e-mails já usados nos departamentos). */
(function () {
  const A = window.OrionDepartamentosApp;
  if (!A) return;
  const renderOriginal = A.render.bind(A);

  Object.assign(A, {
    ui: { aberto: "", busca: "" },

    opcoesCc() {
      const cad = this.cad();
      const m = Object.assign({}, cad.nomesCc || {});
      ((window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || []).forEach((c) => {
        const id = String(c.id).replace(/\D/g, "");
        if (id && !m[id]) m[id] = c.name || c.nome || "";
      });
      return Object.keys(m).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).map((id) => ({ id, label: `${id} - ${String(m[id] || "").toUpperCase()}` }));
    },
    opcoesPlano() {
      const m = this.cad().nomesPlano || {};
      return Object.keys(m).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).map((id) => ({ id, label: `${id} - ${String(m[id] || "").toUpperCase()}` }));
    },
    emailsConhecidos() {
      const s = new Set();
      this.cad().departamentos.forEach((d) => (d.usuarios || []).forEach((u) => s.add(u)));
      return [...s].sort();
    },

    setLista(campo, lista) {
      const d = this.dep();
      if (!d || !this.podeEditar()) return;
      d[campo] = [...new Set(lista.map(String))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
      this.alterado = true;
      this.aviso = "";
      this.render();
    },

    incluirUsuario() {
      const inp = document.getElementById("od-novo-usuario");
      const v = String((inp && inp.value) || "").trim().toLowerCase();
      if (!v) return;
      const d = this.dep();
      if (!d) return;
      const novos = v.split(/[;,\s]+/).filter((x) => /.+@.+\..+/.test(x));
      if (!novos.length) { this.erros = ["Digite um e-mail válido (ex.: nome@mouraleite.com.br)."]; return this.render(); }
      this.erros = [];
      this.setLista("usuarios", (d.usuarios || []).concat(novos));
      const n = document.getElementById("od-novo-usuario");
      if (n) n.focus();
    },
    removerUsuario(u) { const d = this.dep(); if (d) this.setLista("usuarios", (d.usuarios || []).filter((x) => x !== u)); },

    multi(id, label, items, sel) {
      if (!window.MlEmpresaFilter) return "";
      return window.MlEmpresaFilter.html({ id, label, items, selectedIds: sel, open: this.ui.aberto === id, query: this.ui.aberto === id ? this.ui.busca : "", emptyMeansAll: false, nouns: ["item", "itens"] });
    },

    htmlDetalhe() {
      const d = this.dep();
      if (!d) return `<div style="margin-top:12px;font-size:0.8rem;color:#64748b">Clique num departamento para ver e editar os centros de custo, planos e usuários.</div>`;
      const cad = this.cad();
      const ed = this.podeEditar();
      const dis = ed ? "" : " disabled";
      const nomes = (lista, mapa) => lista.map((c) => `${this.esc(c)} ${this.esc((mapa || {})[c] || "")}`).join("<br>");
      const desconhecidos = (lista, mapa) => lista.filter((c) => !(mapa || {})[c]);
      const dc = desconhecidos(d.ccs, cad.nomesCc), dp = desconhecidos(d.planos, cad.nomesPlano);
      const usuarios = (d.usuarios || []).map((u) => `<span style="display:inline-flex;align-items:center;gap:4px;background:#e7f6ee;color:#105436;border-radius:999px;padding:2px 10px;margin:2px;font-size:0.75rem">${this.esc(u)}${ed ? `<button type="button" title="Tirar do departamento" style="border:none;background:none;color:#b91c1c;cursor:pointer;padding:0" onclick="OrionDepartamentosApp.removerUsuario('${this.esc(u)}')">✕</button>` : ""}</span>`).join("");
      return `<div style="margin-top:14px;padding:12px;border:1px solid #e2e8f0;border-radius:8px">
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
          <div style="flex:1;min-width:240px"><label class="ml-emp-filter-label">Departamento</label><input${dis} class="idx-select" style="width:100%;height:40px;box-sizing:border-box" value="${this.esc(d.nome)}" onchange="OrionDepartamentosApp.setCampo('nome', this.value)"></div>
          <div style="width:240px"><label class="ml-emp-filter-label">Diretoria</label><input${dis} class="idx-select" style="width:100%;height:40px;box-sizing:border-box" value="${this.esc(d.diretoria)}" onchange="OrionDepartamentosApp.setCampo('diretoria', this.value)"></div>
          <label style="display:flex;gap:6px;align-items:center;height:40px"><input type="checkbox"${dis} ${d.ativo ? "checked" : ""} onchange="OrionDepartamentosApp.setCampo('ativo', this.checked)"> Ativo</label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div style="font-weight:800;color:#105436;font-size:0.8rem;margin-bottom:4px">Centros de custo (${d.ccs.length})</div>
            ${ed ? this.multi("od-ccs", "Escolher centros de custo", this.opcoesCc(), d.ccs) : ""}
            ${dc.length ? `<div style="color:#b91c1c;font-size:0.72rem">Sem nome no cadastro: ${this.esc(dc.join(", "))}</div>` : ""}
            <div class="cc-scroll" style="max-height:180px;margin-top:6px;padding:6px;font-size:0.72rem">${nomes(d.ccs, cad.nomesCc) || "— (sem lista: o departamento pode usar todos os centros de custo)"}</div></div>
          <div><div style="font-weight:800;color:#105436;font-size:0.8rem;margin-bottom:4px">Planos financeiros (${d.planos.length})</div>
            ${ed ? this.multi("od-planos", "Escolher planos", this.opcoesPlano(), d.planos) : ""}
            ${dp.length ? `<div style="color:#b91c1c;font-size:0.72rem">Sem nome no cadastro: ${this.esc(dp.join(", "))}</div>` : ""}
            <div class="cc-scroll" style="max-height:180px;margin-top:6px;padding:6px;font-size:0.72rem">${nomes(d.planos, cad.nomesPlano) || "—"}</div></div>
        </div>
        <div style="margin-top:10px"><div style="font-weight:800;color:#105436;font-size:0.8rem">Usuários (${(d.usuarios || []).length})</div>
          <div style="margin:4px 0">${usuarios || '<span style="font-size:0.75rem;color:#64748b">Nenhum usuário.</span>'}</div>
          ${ed ? `<div style="display:flex;gap:8px;align-items:center"><input id="od-novo-usuario" list="od-emails" class="idx-select" style="height:40px;width:320px;box-sizing:border-box" placeholder="e-mail da pessoa" onkeydown="if(event.key==='Enter'){event.preventDefault();OrionDepartamentosApp.incluirUsuario();}"><button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionDepartamentosApp.incluirUsuario()">Incluir usuário</button></div>
          <datalist id="od-emails">${this.emailsConhecidos().filter((u) => (d.usuarios || []).indexOf(u) < 0).map((u) => `<option value="${this.esc(u)}">`).join("")}</datalist>` : ""}</div>
        <div style="margin-top:8px;font-size:0.72rem;color:#64748b">Regra do Órion: o departamento só orça nos planos listados aqui${cad.produtoPlano.length ? " e, além disso, o plano precisa estar liberado para o centro de custo" : ""}. As mudanças só valem depois de Salvar.</div>
      </div>`;
    },

    render() {
      renderOriginal();
      const d = this.dep && this.dep();
      if (!d || !this.podeEditar() || !window.MlEmpresaFilter) return;
      const liga = (id, campo, opcoes) => {
        if (!document.getElementById(id)) return;
        window.MlEmpresaFilter.bind(id, {
          toggleOpen: () => { this.ui.aberto = this.ui.aberto === id ? "" : id; this.ui.busca = ""; this.render(); },
          // fechar ao clicar fora: redesenha depois do clique, para o clique (ex.: ✕ de um usuário) acontecer
          close: () => { this.ui.aberto = ""; this.ui.busca = ""; setTimeout(() => this.render(), 0); },
          setQuery: (q) => { this.ui.busca = q; this.render(); },
          toggleId: (x, on) => { const l = (d[campo] || []).filter((y) => y !== String(x)); if (on) l.push(String(x)); this.setLista(campo, l); },
          selectAll: () => this.setLista(campo, opcoes().map((o) => o.id)),
          selectNone: () => this.setLista(campo, [])
        });
      };
      liga("od-ccs", "ccs", () => this.opcoesCc());
      liga("od-planos", "planos", () => this.opcoesPlano());
    }
  });
})();
