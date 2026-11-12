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
