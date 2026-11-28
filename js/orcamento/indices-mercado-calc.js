/* Índices de mercado — cálculos (sem tela). Mesmo racional do ML Órion (apoio > Índices de Mercado):
 * acumulado do ano = produto de (1 + variação/100) dos meses do mesmo ano até o mês;
 * acumulado 12 meses = produto dos 12 últimos meses (só quando há 12 meses na série).
 * Arredondamento final em 4 casas, como o Órion. Roda no navegador (window.IndicesMercadoCalc) e no node (testes). */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.IndicesMercadoCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  /* INCC: série 7456 (INCC-M, FGV), a mesma do cadastro de Indexadores do Integra. O Órion usava a 192 (INCC-DI). */
  const SERIES = {
    IPCA: { codigo: 433, rotulo: "IPCA", fonte: "IBGE", focus: "IPCA" },
    INCC: { codigo: 7456, rotulo: "INCC", fonte: "FGV — INCC-M", focus: null },
    "IGP-M": { codigo: 189, rotulo: "IGP-M", fonte: "FGV", focus: "IGP-M" }
  };

  function arredondar(v, casas) {
    if (v == null || !Number.isFinite(v)) return null;
    const f = Math.pow(10, casas == null ? 4 : casas);
    const x = v * f;
    const r = Math.round(x + (x >= 0 ? 1e-9 : -1e-9));
    return r / f;
  }

  function numero(v) {
    const t = String(v == null ? "" : v).replace(",", ".").replace("%", "").trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /** "01/05/2026" -> { ano: 2026, mes: 5, chave: "2026-05" } */
  function mesDa(data) {
    const p = String(data || "").split("/");
    if (p.length !== 3) return null;
    const ano = Number(p[2]);
    const mes = Number(p[1]);
    if (!ano || !mes) return null;
    return { ano, mes, chave: ano + "-" + String(mes).padStart(2, "0") };
  }

  /** Série do Banco Central ([{data, valor}]) em ordem de data, sem meses repetidos nem valores vazios. */
  function normalizar(serieBcb) {
    const porMes = new Map();
    (serieBcb || []).forEach((r) => {
      const m = mesDa(r && r.data);
      const v = numero(r && r.valor);
      if (!m || v == null) return;
      porMes.set(m.chave, { data: r.data, ano: m.ano, mes: m.mes, chave: m.chave, valor: v });
    });
    return [...porMes.values()].sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
  }

  /** Acrescenta acumulado_ano e acumulado_12m (em %) a cada mês. */
  function acumulados(serieBcb) {
    const s = normalizar(serieBcb);
    return s.map((item, i) => {
      let ano = 1;
      for (let j = i; j >= 0 && s[j].ano === item.ano; j--) ano *= 1 + s[j].valor / 100;
      let doze = null;
      if (i >= 11) {
        doze = 1;
        for (let j = i - 11; j <= i; j++) doze *= 1 + s[j].valor / 100;
        doze = arredondar((doze - 1) * 100, 4);
      }
      return Object.assign({}, item, {
        acumulado_ano: arredondar((ano - 1) * 100, 4),
        acumulado_12m: doze
      });
    });
  }

  /** Projeção do Boletim Focus para o ano pedido: a publicação mais recente com DataReferencia = ano. */
  function focusDoAno(lista, ano) {
    const alvo = String(ano);
    const doAno = (lista || []).filter((r) => r && String(r.DataReferencia) === alvo && Number.isFinite(Number(r.Mediana)));
    if (!doAno.length) return null;
    doAno.sort((a, b) => (String(a.Data) < String(b.Data) ? 1 : String(a.Data) > String(b.Data) ? -1 : 0));
    const r = doAno[0];
    return { ano: alvo, mediana: Number(r.Mediana), media: Number(r.Media), publicadoEm: String(r.Data || "") };
  }

  /** Resumo do último mês da série com acumulados. */
  function ultimoMes(serieComAcum) {
    const u = (serieComAcum || [])[serieComAcum.length - 1];
    if (!u) return null;
    return { data: u.data, chave: u.chave, mensal: u.valor, acumulado_ano: u.acumulado_ano, acumulado_12m: u.acumulado_12m };
  }

  /** "01/05/2026" -> "mai/2026" */
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function rotuloMes(data) {
    const m = mesDa(data);
    return m ? MESES[m.mes - 1] + "/" + m.ano : String(data || "");
  }

  function fmtPerc(v, casas) {
    if (v == null || !Number.isFinite(v)) return "—";
    const c = casas == null ? 2 : casas;
    return arredondar(v, c).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }) + "%";
  }

  return { SERIES, arredondar, normalizar, acumulados, focusDoAno, ultimoMes, rotuloMes, fmtPerc, mesDa };
});
