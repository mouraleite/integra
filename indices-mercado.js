/* Configurações gerais › Índices de mercado — vindo do ML Órion (Apoio › Índices de Mercado).
 * IPCA (433), INCC (7456, a mesma série dos Indexadores) e IGP-M (189) do Banco Central, com acumulado no ano,
 * acumulado 12 meses e a projeção do Boletim Focus para o ano corrente (IPCA e IGP-M).
 * Só leitura: não grava nada no banco nem no Sienge. Os cálculos ficam em indices-mercado-calc.js. */
const IndicesMercadoApp = {
  aba: "IPCA",
  dados: {},
  focus: {},
  carregando: false,
  erro: "",
  atualizadoEm: null,
  MESES_NA_TELA: 24,

  calc() {
    return window.IndicesMercadoCalc;
  },

  esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  root() {
    return document.getElementById("indices-mercado-root");
  },

  init() {
    this.estilos();
    this.render();
    if (!Object.keys(this.dados).length && !this.carregando) this.carregar();
  },

  /** Estilo só das abas desta tela (o resto usa as classes já existentes: cc-table, ppcc-kpi, idx-*). */
  estilos() {
    if (document.getElementById("im-estilos")) return;
    const st = document.createElement("style");
    st.id = "im-estilos";
    st.textContent = `
      .im-barra { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
      .im-abas { display:flex; gap:6px; flex-wrap:wrap; }
      .im-barra .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:40px; box-sizing:border-box; padding:0 16px; margin:0; line-height:1; white-space:nowrap; }
      .im-barra .btn svg { width:16px; height:16px; flex-shrink:0; }
      .im-aba { background:#fff; color:#1c2e24; border:1px solid #cfe0d6; border-radius:8px; font-weight:700; cursor:pointer; }
      .im-aba.is-ativa { background:#1b8253; color:#fff; border-color:#1b8253; }
      .im-fonte { margin-top:8px; font-size:0.72rem; color:#64748b; }
      .im-erro { padding:12px 14px; border:1px solid #fecaca; background:#fef2f2; color:#991b1b; border-radius:8px; margin-bottom:12px; }
    `;
    document.head.appendChild(st);
  },

  async buscarJson(urls) {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        if (Array.isArray(json) && json.length) return json;
      } catch (e) {
        console.warn("[Índices de mercado]", url, e);
      }
    }
    return null;
  },

  async carregar(forcar) {
    const C = this.calc();
    if (!C) return;
    if (forcar) { this.dados = {}; this.focus = {}; }
    this.carregando = true;
    this.erro = "";
    this.render();

    /* 3 anos antes do ano atual: o acumulado 12 meses dos 24 meses da tela sai sempre com 12 meses completos. */
    const dataInicial = "01/01/" + (new Date().getFullYear() - 3);
    const faltando = [];
    await Promise.all(Object.keys(C.SERIES).map(async (nome) => {
      const s = C.SERIES[nome];
      const q = `code=${s.codigo}&dataInicial=${encodeURIComponent(dataInicial)}`;
      const json = await this.buscarJson([
        `/api/bcb-sgs?${q}`,
        `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${s.codigo}/dados?formato=json&dataInicial=${encodeURIComponent(dataInicial)}`
      ]);
      if (json) this.dados[nome] = C.acumulados(json);
      else faltando.push(s.rotulo);
      if (s.focus) {
        const f = await this.buscarJson([`/api/bcb-sgs?focus=${encodeURIComponent(s.focus)}`]);
        this.focus[nome] = f ? C.focusDoAno(f, new Date().getFullYear()) : null;
      }
    }));

    if (faltando.length) this.erro = "Não foi possível buscar no Banco Central: " + faltando.join(", ") + ". Tente Atualizar em alguns minutos.";
    this.atualizadoEm = new Date();
    this.carregando = false;
    this.render();
  },

  setAba(nome) {
    this.aba = nome;
    this.render();
  },

  kpi(rotulo, valor, sufixo) {
    const C = this.calc();
    const cls = valor != null && valor < 0 ? "is-neg" : "is-pos";
    return `
      <div class="ppcc-kpi">
        <span class="ppcc-kpi-rot">${this.esc(rotulo)}</span>
        <span class="ppcc-kpi-val ${cls}">${C.fmtPerc(valor, 2)}${sufixo ? ` <small>${this.esc(sufixo)}</small>` : ""}</span>
      </div>`;
  },

  linhas(lista) {
    const C = this.calc();
    const sinal = (v) => (v != null && v < 0 ? "is-neg" : "");
    return lista.map((r) => `
      <tr>
        <td class="idx-mes">${this.esc(C.rotuloMes(r.data))}</td>
        <td class="is-right idx-taxa ${sinal(r.valor)}">${C.fmtPerc(r.valor, 2)}</td>
        <td class="is-right ${sinal(r.acumulado_ano)}">${C.fmtPerc(r.acumulado_ano, 2)}</td>
        <td class="is-right ${sinal(r.acumulado_12m)}">${C.fmtPerc(r.acumulado_12m, 2)}</td>
      </tr>`).join("");
  },

  render() {
    const root = this.root();
    if (!root) return;
    const C = this.calc();
    if (!C) {
      root.innerHTML = `<div class="im-erro">Arquivo de cálculo dos índices não carregou. Recarregue a página.</div>`;
      return;
    }
    const s = C.SERIES[this.aba];
    const serie = this.dados[this.aba] || [];
    const ultimo = C.ultimoMes(serie);
    const focus = this.focus[this.aba];
    const tela = serie.slice(-this.MESES_NA_TELA).reverse();

    const abas = Object.keys(C.SERIES).map((nome) => `
      <button type="button" class="btn im-aba ${nome === this.aba ? "is-ativa" : ""}" onclick="IndicesMercadoApp.setAba('${nome}')">${this.esc(C.SERIES[nome].rotulo)}</button>`).join("");

    let corpo;
    if (this.carregando && !serie.length) {
      corpo = `
        <div style="text-align:center;padding:40px;color:#64748b;">
          <div class="spinner" style="margin:0 auto 15px;"></div>
          <p>Buscando os índices no Banco Central...</p>
        </div>`;
    } else if (!serie.length) {
      corpo = `<div class="cc-scroll"><table class="cc-table"><tbody><tr><td colspan="4" style="text-align:center;padding:30px;">Nenhum dado de ${this.esc(s.rotulo)} para exibir.</td></tr></tbody></table></div>`;
    } else {
      const ano = new Date().getFullYear();
      corpo = `
        <div class="ppcc-head idx-head">
          <div>
            <div class="ppcc-titulo">${this.esc(s.rotulo)}</div>
            <div class="ppcc-sub">Série ${s.codigo} do Banco Central (${this.esc(s.fonte)}) · últimos ${tela.length} meses até ${this.esc(C.rotuloMes(ultimo.data))}</div>
          </div>
          <div class="ppcc-kpis">
            ${this.kpi("Variação de " + C.rotuloMes(ultimo.data), ultimo.mensal)}
            ${this.kpi("Acumulado em " + C.mesDa(ultimo.data).ano, ultimo.acumulado_ano)}
            ${this.kpi("Acumulado 12 meses", ultimo.acumulado_12m)}
            ${s.focus
              ? (focus ? this.kpi("Focus " + focus.ano + " (mediana)", focus.mediana) : `<div class="ppcc-kpi"><span class="ppcc-kpi-rot">Focus ${ano}</span><span class="ppcc-kpi-val">—</span></div>`)
              : `<div class="ppcc-kpi"><span class="ppcc-kpi-rot">Focus</span><span class="ppcc-kpi-val"><small>sem projeção para o INCC</small></span></div>`}
          </div>
        </div>
        <div class="cc-scroll idx-scroll">
          <table class="cc-table idx-table">
            <colgroup><col class="idx-c-mes"><col><col><col></colgroup>
            <thead>
              <tr>
                <th>Mês/ano</th>
                <th class="is-right">Variação do mês</th>
                <th class="is-right">Acumulado no ano</th>
                <th class="is-right">Acumulado 12 meses</th>
              </tr>
            </thead>
            <tbody>${this.linhas(tela)}</tbody>
          </table>
        </div>
        <div class="im-fonte">Fonte: Banco Central do Brasil (SGS)${focus ? ` · Boletim Focus de ${this.esc(focus.publicadoEm.split("-").reverse().join("/"))}` : ""}${this.atualizadoEm ? ` · consultado às ${this.atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>`;
    }

    root.innerHTML = `
      <div class="im-barra">
        <div class="im-abas">${abas}</div>
        <button type="button" class="btn btn-primary cc-atualizar" onclick="IndicesMercadoApp.carregar(true)" ${this.carregando ? "disabled" : ""}>
          <i data-lucide="refresh-cw"></i> Atualizar
        </button>
      </div>
      ${this.erro ? `<div class="im-erro">${this.esc(this.erro)}</div>` : ""}
      ${corpo}`;
    if (window.lucide) window.lucide.createIcons();
  }
};

window.IndicesMercadoApp = IndicesMercadoApp;
