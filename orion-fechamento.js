/* Configurações gerais › Fechamento de meses — vindo do ML Órion (Apoio › Fechamento).
 * Mês fechado = realizado oficial daquele mês, usado pelo orçamento/forecast (regra do Órion).
 * Grava em orion_config/fechamento_meses: itens = [{ ano, mes, por, em }].
 * Fechar e reabrir exige sub_cfg_apoio_fechamento_meses_editar (administrador sempre pode). */
const OrionFechamentoApp = {
  ano: new Date().getFullYear(),
  dados: null,
  carregando: false,
  salvando: false,
  erro: "",
  MESES: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],

  P() { return window.OrionPremissasCalc; },
  root() { return document.getElementById("orion-fechamento-root"); },

  esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  podeEditar() {
    if (typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin()) return true;
    if (typeof window.hasCrmPerm !== "function") return false;
    return window.hasCrmPerm("sub_cfg_apoio_fechamento_meses_editar");
  },

  init() {
    this.render();
    if (!this.dados) this.carregar();
  },

  async carregar() {
    this.carregando = true;
    this.erro = "";
    this.render();
    try {
      this.dados = await window.OrionStore.ler("fechamento_meses", []);
    } catch (e) {
      this.erro = e.message || String(e);
    }
    this.carregando = false;
    this.render();
  },

  setAno(v) {
    this.ano = Number(v) || this.ano;
    this.render();
  },

  async alternar(mes) {
    if (!this.podeEditar() || !this.dados || this.salvando) return;
    const P = this.P();
    const fechado = !!P.mapaFechados(this.dados.itens)[this.ano + "-" + String(mes).padStart(2, "0")];
    const acao = fechado ? "reabrir" : "fechar";
    if (!window.confirm(`Deseja ${acao} ${this.MESES[mes - 1]}/${this.ano}?`)) return;
    const novos = P.alternarMes(this.dados.itens, this.ano, mes, window.OrionStore.usuario(), new Date().toISOString());
    this.salvando = true;
    this.erro = "";
    this.render();
    try {
      this.dados.versao = await window.OrionStore.gravar("fechamento_meses", novos, this.dados.versao);
      this.dados.itens = novos;
    } catch (e) {
      this.erro = e.message || String(e);
      if (e.conflito) this.dados = null;
    }
    this.salvando = false;
    if (!this.dados) return this.carregar();
    this.render();
  },

  /** Fecha de uma vez todos os meses abertos de janeiro até o mês escolhido (uma gravação só). */
  async fecharAte(mes) {
    mes = Number(mes);
    if (!this.podeEditar() || !this.dados || this.salvando || !(mes >= 1 && mes <= 12)) return;
    const P = this.P();
    const mapa = P.mapaFechados(this.dados.itens);
    const abrir = [];
    for (let m = 1; m <= mes; m++) if (!mapa[this.ano + "-" + String(m).padStart(2, "0")]) abrir.push(m);
    if (!abrir.length) { this.erro = `Jan a ${this.MESES[mes - 1]}/${this.ano} já estão fechados.`; return this.render(); }
    if (!window.confirm(`Fechar ${abrir.map((m) => this.MESES[m - 1]).join(", ")}/${this.ano}? Esses meses ficam travados nos orçamentos e forecasts.`)) return;
    let novos = this.dados.itens;
    const quem = window.OrionStore.usuario(), agora = new Date().toISOString();
    abrir.forEach((m) => { novos = P.alternarMes(novos, this.ano, m, quem, agora); });
    this.salvando = true;
    this.erro = "";
    this.render();
    try {
      this.dados.versao = await window.OrionStore.gravar("fechamento_meses", novos, this.dados.versao);
      this.dados.itens = novos;
    } catch (e) {
      this.erro = e.message || String(e);
      if (e.conflito) this.dados = null;
    }
    this.salvando = false;
    if (!this.dados) return this.carregar();
    this.render();
  },

  render() {
    const root = this.root();
    if (!root) return;
    const P = this.P();
    if (!P || !window.OrionStore) {
      root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivos da tela não carregaram. Recarregue a página.</div>`;
      return;
    }
    const ed = this.podeEditar();
    const atual = new Date().getFullYear();
    const anos = [];
    for (let a = atual - 3; a <= atual + 2; a++) anos.push(a);
    const mapa = this.dados ? P.mapaFechados(this.dados.itens) : {};

    const linhas = this.MESES.map((nome, i) => {
      const r = mapa[this.ano + "-" + String(i + 1).padStart(2, "0")];
      const quando = r && r.em ? new Date(r.em).toLocaleString("pt-BR") : "";
      return `<tr>
        <td>${nome}/${this.ano}</td>
        <td class="${r ? "" : ""}" style="font-weight:700;color:${r ? "#105436" : "#64748b"}">${r ? "Fechado" : "Aberto"}</td>
        <td>${r ? this.esc(r.por || "") : ""}</td>
        <td>${this.esc(quando)}</td>
        <td class="is-center">${ed ? `<button type="button" class="btn ${r ? "btn-secondary" : "btn-primary"}" style="height:28px;padding:0 12px" ${this.salvando || !this.dados ? "disabled" : ""} onclick="OrionFechamentoApp.alternar(${i + 1})">${r ? "Reabrir" : "Fechar"}</button>` : ""}</td>
      </tr>`;
    }).join("");

    root.innerHTML = `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <label class="ml-emp-filter-label" for="ofech-ano">Ano</label>
          <select id="ofech-ano" class="idx-select" style="height:40px" onchange="OrionFechamentoApp.setAno(this.value)">
            ${anos.map((a) => `<option ${a === this.ano ? "selected" : ""}>${a}</option>`).join("")}
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;margin-left:auto">
          ${ed && this.dados ? `<div><label class="ml-emp-filter-label">Fechar de uma vez</label><select id="ofech-ate" class="idx-select" style="height:40px">${this.MESES.map((m, i) => `<option value="${i + 1}">jan a ${m}</option>`).join("")}</select></div>
          <button type="button" class="btn btn-secondary" style="height:40px" ${this.salvando ? "disabled" : ""} onclick="OrionFechamentoApp.fecharAte(document.getElementById('ofech-ate').value)">Fechar meses</button>` : ""}
          <button type="button" class="btn btn-primary cc-atualizar" style="height:40px" ${this.carregando ? "disabled" : ""} onclick="OrionFechamentoApp.carregar()"><i data-lucide="refresh-cw"></i> Atualizar</button>
        </div>
      </div>
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px;">${this.esc(this.erro)}</div>` : ""}
      ${!this.dados ? `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>` : `
      <div class="cc-scroll">
        <table class="cc-table">
          <colgroup><col style="width:110px"><col style="width:90px"><col style="width:240px"><col style="width:160px"><col style="width:100px"></colgroup>
          <thead><tr><th>Mês</th><th>Situação</th><th>Fechado por</th><th>Em</th><th class="is-center">${ed ? "Ação" : ""}</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <div style="margin-top:8px;font-size:0.72rem;color:#64748b;">Mês fechado = realizado oficial do mês para o orçamento e o forecast.${ed ? "" : " Para fechar ou reabrir, peça a permissão de edição."}</div>`}`;
    if (window.lucide) window.lucide.createIcons();
  }
};

window.OrionFechamentoApp = OrionFechamentoApp;
