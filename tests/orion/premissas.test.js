/* Regras das premissas da viabilidade (Apoio do ML Órion). Rodar: node --test tests/orion/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const P = require(path.join(__dirname, "..", "..", "orion-premissas-calc.js"));

test("número em formato brasileiro e americano", () => {
  assert.strictEqual(P.num("3,8"), 3.8);
  assert.strictEqual(P.num("1.234,56"), 1234.56);
  assert.strictEqual(P.num("3.8"), 3.8);
  assert.strictEqual(P.num(" 12 % "), 12);
  assert.strictEqual(P.num(""), null);
});

test("soma sem erro de ponto flutuante", () => {
  assert.strictEqual(P.soma([33.33, 33.33, 33.34]), 100);
  assert.strictEqual(P.soma(["0,1", "0,2"]), 0.3);
});

test("plano de pagamento: soma das condições = 100%", () => {
  const conds = P.listaDeCondicoes("A VISTA = 3,8; 24 = 6,6; 36 = 12,8; 48 = 18,0; 60 = 2,4; 120 = 7,9; 180 = 48,6");
  assert.strictEqual(conds.length, 7);
  assert.deepStrictEqual(conds[0], { nome: "A VISTA", perc: 3.8 });
  /* O plano-padrão do Órion soma 100,1% (3,8+6,6+12,8+18+2,4+7,9+48,6): a regra do próprio Órion também o recusa. */
  assert.match(P.validarPlanos([{ nome: "Neutro (65/20/15) - ABERTO", condicoes: conds }])[0], /100,10%/);
  const ok = P.listaDeCondicoes("A VISTA = 3,8; 24 = 6,6; 36 = 12,8; 48 = 18,0; 60 = 2,4; 120 = 7,9; 180 = 48,5");
  assert.deepStrictEqual(P.validarPlanos([{ nome: "Ajustado", condicoes: ok }]), []);
  const ruim = P.validarPlanos([{ nome: "X", condicoes: [{ nome: "Sinal", perc: 90 }] }]);
  assert.match(ruim[0], /90,00%/);
});

test("curva padrão precisa somar 100%", () => {
  assert.deepStrictEqual(P.validarCurvas([{ nome: "Obra 4m", tipo: "obras", classificacao: "Custo", meses: P.listaDeNumeros("10; 20; 30; 40") }]), []);
  const e = P.validarCurvas([{ nome: "Obra", tipo: "obras", classificacao: "Custo", meses: [10, 20] }]);
  assert.match(e[0], /30,00%/);
  assert.ok(P.validarCurvas([{ nome: "", tipo: "x", classificacao: "y", meses: [] }]).length >= 3);
});

test("nomes repetidos são recusados", () => {
  const e = P.validarCenarios([
    { nome: "Base", vgv_multiplier: 1, construction_cost_multiplier: 1, sales_speed_multiplier: 1 },
    { nome: "base", vgv_multiplier: 1, construction_cost_multiplier: 1, sales_speed_multiplier: 1 }
  ]);
  assert.match(e[0], /mais de uma vez/);
});

test("cenário com multiplicador zero é recusado", () => {
  const e = P.validarCenarios([{ nome: "Pessimista", vgv_multiplier: 0.9, construction_cost_multiplier: 0, sales_speed_multiplier: 1 }]);
  assert.strictEqual(e.length, 1);
});

test("regime tributário: total e limites", () => {
  const lp = { nome: "Lucro Presumido", pis: 0.65, cofins: 3, irpj: 1.2, csll: 1.08, outros: 0 };
  assert.strictEqual(P.totalRegime(lp), 5.93);
  assert.deepStrictEqual(P.validarRegimes([lp]), []);
  assert.strictEqual(P.validarRegimes([{ ...lp, pis: 120 }]).length, 1);
});

test("índices projetados: tipo, unidade e conversão anual/mensal", () => {
  assert.deepStrictEqual(P.validarIndicesProjetados([{ nome: "Padrão", index_type: "IPCA", valor: 4.5, tipo_unidade: "% a.a." }]), []);
  assert.ok(P.validarIndicesProjetados([{ nome: "X", index_type: "SELIC", valor: 1, tipo_unidade: "% a.d." }]).length >= 2);
  const am = P.anualParaMensal(12);
  assert.ok(Math.abs(am - 0.948879) < 1e-6);
  assert.ok(Math.abs(P.mensalParaAnual(am) - 12) < 1e-9);
});

test("fechamento de meses: fecha e reabre", () => {
  let l = P.alternarMes([], 2027, 3, "a@b", "2026-11-12T10:00:00Z");
  l = P.alternarMes(l, 2027, 1, "a@b", "2026-11-12T10:00:00Z");
  assert.deepStrictEqual(l.map((r) => r.mes), [1, 3]);
  assert.ok(P.mapaFechados(l)["2027-03"]);
  l = P.alternarMes(l, 2027, 3, "a@b");
  assert.deepStrictEqual(l.map((r) => r.mes), [1]);
});
