/* Acompanhamento de empreendimentos: o Integra tem de dar o mesmo resultado que o Órion.
 * acompanhamento-ficticio/casos.json foi gerado rodando o tracking.py do Órion (_calc_actuals_for_cc e
 * _calculate_financial_indicators, sem alteração) sobre dados FICTÍCIOS: vendas, distratos, realizado, a realizar,
 * estoque com projeção e tributos do Lucro Presumido, regras de parceria (empreendedor e parceiro). */
const test = require("node:test");
const assert = require("node:assert");
const A = require("../../orion-acompanhamento-calc.js");
const casos = require("./acompanhamento-ficticio/casos.json");

const perto = (a, b, onde) => {
  if (b === null || b === undefined) return assert.ok(a === null || a === undefined, `${onde}: Integra ${a} x Órion ${b}`);
  if (typeof b === "string") return assert.strictEqual(a, b, onde);
  const tol = Math.max(0.01, Math.abs(b) * 1e-7);
  assert.ok(Math.abs(a - b) <= tol, `${onde}: Integra ${a} x Órion ${b}`);
};

test("acompanhamento: DRE, fluxo por ano, indicadores, velocidade e planos iguais ao Órion", () => {
  assert.ok(casos.length >= 3);
  casos.forEach((c, n) => {
    const g = c.gabarito;
    const r = A.calcularCentro(c.entrada);
    ["vgv_vendido", "distratos", "recebimentos", "saidas_totais", "vgv_estoque", "estoque_area", "estoque_unidades", "preco_medio", "lucro_operacional", "lucro_liq_operacional", "receita_bruta",
      "tir_anual", "tir_mensal", "mtir_anual", "mtir_mensal", "payback", "periodo_exposicao", "vida", "exposicao_maxima", "rent_inv", "total_units", "total_sold", "total_returned", "total_balance"].forEach((k) => perto(r[k], g[k], `caso ${n} ${k}`));
    assert.deepStrictEqual(r.dre.map((x) => x.item), g.dre.map((x) => x.item));
    g.dre.forEach((x, i) => perto(r.dre[i].valor, x.valor, `caso ${n} DRE ${x.item}`));
    assert.deepStrictEqual(r.fluxo_caixa.map((x) => [x.Ano, x.is_forecast]), g.fluxo_caixa.map((x) => [x.Ano, x.is_forecast]));
    g.fluxo_caixa.forEach((x, i) => Object.keys(x).filter((k) => typeof x[k] === "number").forEach((k) => perto(r.fluxo_caixa[i][k], x[k], `caso ${n} fluxo ${x.Ano} ${k}`)));
    assert.deepStrictEqual(Object.keys(r.final_cf_dict).sort(), Object.keys(g.final_cf_dict).sort());
    Object.keys(g.final_cf_dict).forEach((k) => perto(r.final_cf_dict[k], g.final_cf_dict[k], `caso ${n} mês ${k}`));
    assert.deepStrictEqual(r.velocidade_vendas, g.velocidade_vendas, `caso ${n} velocidade`);
    assert.deepStrictEqual(r.planos_vendas.curto_longo.map((x) => [x.name, x.value]), g.planos.curto_longo.map((x) => [x.name, x.value]));
    assert.deepStrictEqual(r.planos_vendas.distribuicao, g.planos.distribuicao);
    const li = A.indicadores(r.final_cf_dict, 0.15, "newton");
    ["tir_anual", "mtir_anual", "payback", "exposicao_maxima", "periodo_exposicao", "vida"].forEach((k) => perto(li[k], g.indicadores_lista[k], `caso ${n} lista ${k}`));
  });
});

test("acompanhamento: nome da obra, mesma obra e faixas de parcelas como no Órion", () => {
  assert.deepStrictEqual(A.nomeProjeto("BOTUCATU - LIVIA - PARCERIA ALEXANDRE"), { cidade: "BOTUCATU", produto: "LIVIA ALEXANDRE" }); // igual ao Órion: tira " - PARCERIA" do meio do nome
  assert.deepStrictEqual(A.nomeProjeto("TATUÍ - RESERVA DOS RAMOS - MLDU"), { cidade: "TATUÍ", produto: "RESERVA DOS RAMOS" });
  assert.ok(A.mesmaObra("LIVIA", "LIVIA - OBRAS"));
  assert.ok(!A.mesmaObra("LIVIA I", "LIVIA II"));
  assert.deepStrictEqual([1, 6, 7, 48, 49, 180, 240].map(A.faixaParcelas), ["Até 6X", "Até 6X", "Até 12x", "Até 48x", "Até 60x", "Até 180x", "Até 180x"]);
});

test("DFC de empreendimentos: grupos da visão, pais, fórmulas do Órion e conferência com o Acompanhamento", () => {
  const grupos = [["g_01", "01 RECEITAS"], ["g_01_01", "01.01 VENDA DE IMOVEIS"], ["g_01_04", "01.04 CANCELAMENTOS DE VENDAS"], ["g_02", "02 IMPOSTOS"], ["g_02_01", "02.01 IMPOSTOS SOBRE VENDAS"],
    ["g_03", "03 CUSTOS E DESPESAS"], ["g_04", "04 CUSTOS"], ["g_04_01", "04.01 REPASSES TERRENISTAS"], ["g_04_03", "04.03 OBRAS"], ["g_05", "05 DESPESAS"], ["g_05_03", "05.03 ADMINISTRATIVAS"],
    ["g_06", "06 GCO - GERACAO DE CAIXA OPERACIONAL"]].map(([id, name]) => ({ id, name }));
  const entrada = { real: [{ tipo: "INCOME", categoria: "Venda", gid: "g_01_01", mes: "2025-01", valor: 1000 }, { tipo: "OUTCOME", categoria: "Obras", gid: "g_04_03", mes: "2025-01", valor: 300 },
    { tipo: "OUTCOME", categoria: "Devolução distrato", gid: "g_01_04", mes: "2025-02", valor: 50 }, { tipo: "OUTCOME", categoria: "Sem grupo", gid: null, grupo: "", mes: "2025-02", valor: 20 },
    { tipo: "INCOME", categoria: "AFAC", gid: "g_01_01", mes: "2025-02", valor: 999 }],
    previsto: [{ tipo: "OUTCOME", categoria: "PIS", gid: "g_02_01", mes: "2027-03", valor: 10 }] };
  const A = require("../../orion-acompanhamento-calc.js");
  const calc = A.calcularCentro(Object.assign({}, entrada, { hoje: "2026-11", terrenoManual: { valor: 100 }, aliquotas: {} }));
  const r = A.dfcVida({ centros: [{ entrada, calc, opts: {} }], grupos, hoje: "2026-11", lucroAcomp: calc.lucro_liq_operacional });
  const L = (c) => r.linhas.find((l) => l.codigo === c);
  assert.strictEqual(L("01").total, 950); // AFAC fica fora, como no Acompanhamento
  assert.strictEqual(L("04").total, -500); // obras 300 + terreno informado 100 (realizado) + 100 (curva), como o Acompanhamento soma
  assert.strictEqual(L("05.03").total, -20);
  assert.strictEqual(L("03").total, -520);
  assert.strictEqual(L("06").total, 950 - 10 - 520);
  assert.strictEqual(r.conferencia.lucro_dfc, 1000 - 300 - 20 - 10 - 200);
  assert.strictEqual(r.conferencia.lucro_dfc, calc.lucro_liq_operacional);
  assert.ok(r.conferencia.ok);
});

test("DFC de empreendimentos: projeção do estoque e visão de parceria batem com o Acompanhamento", () => {
  const grupos = [["g_01", "01 RECEITAS"], ["g_01_01", "01.01 VENDA DE IMOVEIS"], ["g_02", "02 IMPOSTOS"], ["g_02_01", "02.01 IMPOSTOS SOBRE VENDAS"], ["g_04", "04 CUSTOS"], ["g_04_03", "04.03 OBRAS"], ["g_05", "05 DESPESAS"], ["g_05_03", "05.03 ADMINISTRATIVAS"]].map(([id, name]) => ({ id, name }));
  const entrada = { real: [{ tipo: "INCOME", categoria: "Venda", gid: "g_01_01", mes: "2026-06", valor: 5000 }, { tipo: "OUTCOME", categoria: "Obras", grupo: "OBRAS", gid: "g_04_03", mes: "2026-07", valor: 1200 }],
    previsto: [], vendas: [{ categoria: "VGV Vendido", mes: "2026-06", valor: 5000, area: 100, parcelas: 10 }, { categoria: "VGV Vendido", mes: "2026-08", valor: 6000, area: 100, parcelas: 1 }],
    unidades: { total: 5, estoque: [{ area: 100 }, { area: 120 }, { area: 80 }] } };
  const A = require("../../orion-acompanhamento-calc.js");
  [{}, { regras: {}, multApportioned: 0.4, multDefault: 0 }].forEach((opts) => {
    const calc = A.calcularCentro(Object.assign({}, entrada, opts, { hoje: "2026-11", aliquotas: { pis: 0.65, cofins: 3 } }));
    const r = A.dfcVida({ centros: [{ entrada, calc, opts }], grupos, hoje: "2026-11", lucroAcomp: calc.lucro_liq_operacional });
    assert.ok(Math.abs(r.conferencia.lucro_dfc - calc.lucro_liq_operacional) < 0.01, JSON.stringify([r.conferencia, calc.lucro_liq_operacional]));
    if (!opts.regras) assert.ok(r.conferencia.projecao > 0);
  });
});
