/* Carga SharePoint: leitura do relatório 2653 do Sienge com a mesma regra do Órion. Dados FICTÍCIOS. */
const test = require("node:test");
const assert = require("node:assert");
const S = require("../../orion-sharepoint-calc.js");

const relatorio = [
  ["Comparativo Orçamento Empresarial X Realizado Agrupado"],
  ["Empresa", null, "1 - EMPRESA TESTE"],
  ["Centro de custo", null, "90100 - CIDADE TESTE - LOTEAMENTO A"],
  [null, null, null, null, null, "jan/2026", null, null, "fev/2026", null, null],
  ["Conta", "Descrição", null, null, "Tipo", "Orçado", "Realizado", "Var", "Orçado", "Realizado", "Var"],
  ["1.01.01.01", "Receita de Venda de Lotes", null, null, "R", 1000.5, 900, 0, 2000, 0, 0],
  ["2.05.01.05", "Despesas Bancárias", null, null, "R", 10, 12, 0, 0, 0, 0],
  ["2.05", "DESPESAS FINANCEIRAS", null, null, "S", 10, 12, 0, 0, 0, 0],
  ["Centro de custo", "90200 - CIDADE TESTE - LOTEAMENTO B - FASE 2"],
  [null, null, null, null, null, "jan/2025", null, null, "jan/2026", null, null],
  [null, null, null, null, null, "Orçado", null, null, "Orçado", null, null],
  ["2.03.02.11", "Despesas Legais", null, null, "R", 99, null, null, "1.234,56", null, null]
];

test("sharepoint: lê o relatório 2653 como o Órion (centro de custo, meses, coluna Orçado, linhas R)", () => {
  const d = S.lerRelatorio(relatorio, "a.xlsx");
  assert.deepStrictEqual(d.map((x) => [x.cc_id_sienge, x.conta_codigo, x.mes, x.ano, x.orcado]), [
    ["90100", "1.01.01.01", 1, 2026, 1000.5], ["90100", "1.01.01.01", 2, 2026, 2000], ["90100", "2.05.01.05", 1, 2026, 10],
    ["90200", "2.03.02.11", 1, 2025, 99], ["90200", "2.03.02.11", 1, 2026, 1234.56]]);
  assert.strictEqual(d[3].cc_nome, "CIDADE TESTE - LOTEAMENTO B - FASE 2");
  assert.throws(() => S.lerRelatorio([["Centro de custo", "1 - X"], ["Conta"]], "b.xlsx"), /tabela padrão/);
  assert.throws(() => S.lerRelatorio([["Centro de custo", "1 - X"], [null, "jan/2026"], [null, "nada"]], "c.xlsx"), /Orçado/);
});

test("sharepoint: pastas Forecast - N+M, de-para e forecast em centavos só do ano", () => {
  const g = S.agruparArquivos([
    { caminho: "2026/Forecast - 8+4/Empresa 1/a.xlsx" }, { caminho: "2026/Forecast - 8+4/~$a.xlsx" },
    { caminho: "2026/Forecast - 3+9/b.xlsx" }, { caminho: "2026/outros/c.xlsx" }]);
  assert.deepStrictEqual(g.pastas.map((p) => [p.descricao, p.mes_corte, p.ano_pasta, p.arquivos.length]), [["Forecast - 3+9", 4, 2026, 1], ["Forecast - 8+4", 9, 2026, 1]]);
  assert.deepStrictEqual(g.fora, ["c.xlsx"]);
  const d = S.lerRelatorio(relatorio, "a.xlsx");
  const ccs = [{ id: 90100, nome: "LOTEAMENTO A" }];
  const planos = [{ id: "1010101", nome: "Receita de Venda de Lotes" }, { id: "2050105", nome: "Despesas Bancárias" }, { id: "2030211", nome: "Despesas Legais/Cartórios" }];
  const m1 = S.mapear(d, ccs, planos, {});
  assert.deepStrictEqual(m1.pendencias.map((p) => [p.tipo, p.origem]), [["CENTRO_CUSTO", "90200"]]);
  const m2 = S.mapear(d, ccs, planos, { cc: { 90200: "90100" } });
  assert.strictEqual(m2.pendencias.length, 0);
  const f = S.montarForecast(m2.linhas, 2026);
  assert.strictEqual(f.foraDoAno, 1);
  assert.deepStrictEqual(f.RECEITAS.map((l) => [l.cc, l.plano, l.m[0], l.m[1], l.total]), [["90100", "1010101", 100050, 200000, 300050]]);
  assert.deepStrictEqual(f.DESPESAS.map((l) => [l.cc, l.plano, l.m[0], l.total]), [["90100", "2030211", 123456, 123456], ["90100", "2050105", 1000, 1000]]);
});
