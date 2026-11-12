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
