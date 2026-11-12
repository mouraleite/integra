/* Motor da viabilidade: o Integra tem de dar o mesmo resultado que o Órion.
 * gabarito-orion.json foi gerado rodando o math_engine.py do Órion (sem alteração) sobre entrada.json,
 * que tem só dados FICTÍCIOS cobrindo à vista, Price, SAC, entrada, correção, INCC, permutas, CRI, banco, extras e parceiros. */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const V = require("../../orion-viabilidade-calc.js");
const entrada = require("./viabilidade-ficticia/entrada.json");
const gabarito = require("./viabilidade-ficticia/gabarito-orion.json");

const fases = Object.fromEntries(V.montarFases(entrada).map((f) => [f.id, f]));
const cenarios = Object.fromEntries(entrada.scenarios.map((c) => [c.id, c]));
const taxas = entrada.system_settings.find((s) => s.key === "funding_rates").value;

function confere(obtido, esperado, onde) {
  for (const k of Object.keys(esperado)) {
    const a = obtido[k], b = esperado[k];
    if (b === null || a === null || typeof b !== "number") { assert.deepStrictEqual(a, b, `${onde}.${k}`); continue; }
    const tol = Math.max(0.005, Math.abs(b) * 1e-9);
    assert.ok(Math.abs(a - b) <= tol, `${onde}.${k}: Integra ${a} x Órion ${b}`);
  }
}

test("viabilidade: indicadores, fluxo e visões por parceiro iguais ao Órion", () => {
  assert.ok(gabarito.length >= 15);
  for (const g of gabarito) {
    const onde = `fase ${g.phase_id} cenário ${g.scenario_id || "base"}`;
    const r = V.calcular(fases[g.phase_id], g.scenario_id ? cenarios[g.scenario_id] : null, taxas);
    confere(r.indicators, g.indicators, onde + " global");
    confere(r.indicators_empreendedor, g.indicators_empreendedor, onde + " empreendedor");
    assert.deepStrictEqual(Object.keys(r.indicators_parceiros).sort(), Object.keys(g.indicators_parceiros).sort(), onde + " parceiros");
    for (const p of Object.keys(g.indicators_parceiros)) confere(r.indicators_parceiros[p], g.indicators_parceiros[p], `${onde} ${p}`);
    assert.strictEqual(r.monthly_cashflow.length, g.fluxo.length, onde + " meses");
    r.monthly_cashflow.forEach((m, i) => assert.ok(Math.abs(m.Fluxo_de_Caixa - g.fluxo[i]) <= 0.005, `${onde} mês ${i + 1}`));
    r.monthly_cashflow_empreendedor.forEach((m, i) => assert.ok(Math.abs(m.Fluxo_de_Caixa - g.fluxo_emp[i]) <= 0.005, `${onde} emp mês ${i + 1}`));
    assert.strictEqual(r.aviso_parceiros, g.aviso_parceiros, onde + " aviso");
  }
});

test("viabilidade: arredondamento e TIR com a mesma regra do Python", () => {
  assert.strictEqual(V.pyRound(2.5), 2);
  assert.strictEqual(V.pyRound(3.5), 4);
  assert.strictEqual(V.irr([1, 2, 3]), null);
  assert.ok(Math.abs(V.irr([-100, 60, 60]) - 0.130662386) < 1e-6);
  assert.ok(path.basename(__filename).endsWith(".test.js"));
});

test("viabilidade: DRE, carga e consolidação das fases", () => {
  const arquivos = Object.entries(entrada).map(([tabela, linhas]) => ({ tabela, linhas }));
  const c = V.prepararViabilidades(arquivos);
  assert.strictEqual(c.docs.length, entrada.viabilities.length);
  assert.deepStrictEqual(c.semFase, []);
  for (const d of c.docs) {
    const fase = V.faseDoDoc(d, 0);
    const g = gabarito.find((x) => x.phase_id === d.fases[0].orion_id && !x.scenario_id);
    const r = V.calcular(fase, null, taxas);
    assert.ok(Math.abs(r.indicators.lucro_liquido - g.indicators.lucro_liquido) < 0.005, d.project_name);
    const ll = V.dre(r.monthly_cashflow).find((l) => l.nome === "Lucro líquido");
    assert.ok(Math.abs(ll.valor - r.indicators.lucro_liquido) < 0.005, "DRE " + d.project_name);
    const k = V.consolidar([r], d.taxa_desconto_vpl / 100);
    assert.ok(Math.abs(k.vpl - r.indicators.vpl) < 0.005);
    assert.strictEqual(k.payback, r.indicators.payback);
    assert.ok(Math.abs(k.exposicao_maxima - r.indicators.exposicao_maxima) < 0.005);
  }
});

test("acompanhamento: previsto da viabilidade × realizado do caixa, por mês e por ano", () => {
  const fluxo = [
    { Receitas: 0, Obras: 100, Despesas: 10, Impostos: 0, Terreno: 50, Funding: 0, Fluxo: -160 },
    { Receitas: 300, Obras: 100, Despesas: 10, Impostos: 12, Terreno: 0, Funding: 0, Fluxo: 178 },
    { Receitas: 300, Obras: 0, Despesas: 10, Impostos: 12, Terreno: 0, Funding: 0, Fluxo: 278 }
  ];
  const a = V.acompanhamento({ fluxo, inicio: "2025-12", ate: "2026-01", realizado: [{ ano: 2025, mes: 12, valor: -200 }, { ano: 2026, mes: 1, valor: 250 }, { ano: 2026, mes: 1, valor: -90 }, { ano: 2026, mes: 2, valor: 999 }] });
  assert.strictEqual(a.meses.length, 3);
  assert.deepStrictEqual(a.meses.map((m) => [m.ano, m.mes, m.passado]), [[2025, 12, true], [2026, 1, true], [2026, 2, false]]);
  assert.deepStrictEqual(a.ate.real, { ent: 250, sai: 290, fluxo: -40 });
  assert.strictEqual(a.ate.prev.fluxo, 18);
  assert.strictEqual(a.projecao.resultado, -40 + 278);     // realizado até jan + previsto de fev (o realizado de fev ainda não conta)
  assert.deepStrictEqual(a.anos.map((y) => [y.ano, y.prev.fluxo, y.real.fluxo]), [[2025, -160, -200], [2026, 456, 160]]);
});
