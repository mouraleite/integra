/* Testes do cálculo dos Índices de mercado contra o ML Órion.
 * Rodar na pasta do projeto:  node --test tests/orion/*.test.js
 * - indices-bcb-2023-2026.json: séries do Banco Central (jan/2023 a out/2026), baixadas em 12/11/2026.
 * - indices-orion-gabarito.json: saída da função do Órion (_calcular_acumulado) para os mesmos dados,
 *   nos meses em que o Órion já tem 12 meses de janela. */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const calc = require(path.join(__dirname, "..", "..", "indices-mercado-calc.js"));
const bcb = require("./indices-bcb-2023-2026.json");
const gabarito = require("./indices-orion-gabarito.json");

function serie(codigo) {
  let ano = Number(bcb.inicio.slice(0, 4));
  let mes = Number(bcb.inicio.slice(5, 7));
  return bcb[codigo].map((v) => {
    const r = { data: "01/" + String(mes).padStart(2, "0") + "/" + ano, valor: String(v) };
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    return r;
  });
}

for (const codigo of ["433", "7456", "189"]) {
  test("série " + codigo + ": acumulados iguais aos do Órion", () => {
    const porData = new Map(calc.acumulados(serie(codigo)).map((r) => [r.data, r]));
    for (const g of gabarito[codigo]) {
      const r = porData.get(g.data);
      assert.ok(r, "mês " + g.data + " presente");
      assert.strictEqual(r.acumulado_ano, g.acumulado_ano, codigo + " " + g.data + " acumulado no ano");
      assert.strictEqual(r.acumulado_12m, g.acumulado_12m, codigo + " " + g.data + " acumulado 12 meses");
    }
  });
}

test("acumulado 12 meses fica vazio enquanto não há 12 meses", () => {
  const r = calc.acumulados(serie("433").slice(0, 12));
  assert.strictEqual(r[10].acumulado_12m, null);
  assert.notStrictEqual(r[11].acumulado_12m, null);
});

test("acumulado do ano reinicia em janeiro", () => {
  const r = calc.acumulados(serie("433"));
  const jan = r.find((x) => x.data === "01/01/2026");
  assert.strictEqual(jan.acumulado_ano, jan.valor);
});

test("Focus: pega a publicação mais recente do ano pedido", () => {
  const lista = [
    { Data: "2026-11-06", DataReferencia: "2027", Mediana: 4.9005, Media: 4.8664 },
    { Data: "2026-10-30", DataReferencia: "2026", Mediana: 5.3, Media: 5.2 },
    { Data: "2026-11-06", DataReferencia: "2026", Mediana: 5.2195, Media: 5.2131 }
  ];
  const f = calc.focusDoAno(lista, 2026);
  assert.strictEqual(f.mediana, 5.2195);
  assert.strictEqual(f.publicadoEm, "2026-11-06");
  assert.strictEqual(calc.focusDoAno(lista, 2031), null);
});

test("normalizar ignora vazios e meses repetidos", () => {
  const r = calc.normalizar([
    { data: "01/02/2026", valor: "0,70" }, { data: "01/01/2026", valor: "0.33" },
    { data: "01/02/2026", valor: "0.70" }, { data: "x", valor: "1" }, { data: "01/03/2026", valor: "" }
  ]);
  assert.deepStrictEqual(r.map((x) => x.chave), ["2026-01", "2026-02"]);
});
