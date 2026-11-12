/* Orçamentos/forecasts do Órion -> Integra (centavos, mapeamento, blocos). Rodar: node --test tests/orion/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const O = require(path.join(__dirname, "..", "..", "orion-orcamento-calc.js"));

test("centavos exatos", () => {
  assert.strictEqual(O.centavos(0.1 + 0.2), 30);
  assert.strictEqual(O.centavos("1234.56"), 123456);
  assert.strictEqual(O.centavos("1.234,56"), 123456);
  assert.strictEqual(O.centavos("-10.005"), -1001);
  assert.strictEqual(O.centavos("10.005"), 1001);
  assert.strictEqual(O.centavos(null), 0);
  assert.strictEqual(O.centavos(19999999.99), 1999999999);
});

const base = [
  { tabela: "cost_centers", linhas: [{ id: 1, id_sienge: "10100", nome: "CERQUEIRA CÉSAR" }, { id: 2, id_sienge: "99999", nome: "ADM" }] },
  { tabela: "planos_financeiros", linhas: [{ id: 10, db_id: "2010101", name: "SALÁRIOS", tp_conta: "T", fl_redutora: "N" }, { id: 11, db_id: "1010101", name: "VENDAS", tp_conta: "R", fl_redutora: "N" }] },
  { tabela: "departamentos", linhas: [{ id: 3, nome: "Financeiro" }] },
  { tabela: "users", linhas: [{ id: 5, email: "marcelo@x" }] },
  { tabela: "orcamentos", linhas: [
    { id: 100, descricao: "Orçamento Despesas 2027", ano: 2027, tipo: "DESPESAS", status: "Aprovado", versao_numero: 2, versao_base_id: 99, departamento_id: 3, usuario_criador_id: 5 },
    { id: 99, descricao: "Orçamento Despesas 2027", ano: 2027, tipo: "DESPESAS", status: "Substituído", versao_numero: 1, departamento_id: 3 }
  ] },
  { tabela: "orcamento_itens", linhas: [
    { id: 1, orcamento_id: 100, produto_id: 1, plano_financeiro_id: 10, jan: 1000.1, fev: 0.2, mar: 0, abr: 0, mai: 0, jun: 0, jul: 0, ago: 0, set: 0, out: 0, nov: 0, dez: 99.7, total_anual: 1100 },
    { id: 2, orcamento_id: 100, produto_id: 2, plano_financeiro_id: 10, jan: 50, total_anual: 50 },
    { id: 3, orcamento_id: 99, produto_id: 1, plano_financeiro_id: 10, jan: 900, total_anual: 900 }
  ] },
  { tabela: "orcamento_historico", linhas: [{ id: 1, orcamento_id: 100, usuario_id: 5, status_anterior: "Em aprovação", status_novo: "Aprovado", data_hora: "2026-10-01T10:00:00" }] }
];

test("orçamento: cabeçalho, linhas em centavos e conferência com o total do Órion", () => {
  const r = O.prepararDocumentos(base, "orcamentos");
  assert.strictEqual(r.cabecalhos.length, 2);
  const c = r.cabecalhos.find((x) => x._id === "100");
  assert.strictEqual(c.departamento.nome, "Financeiro");
  assert.strictEqual(c.versao_base, "99");
  assert.strictEqual(c.criado_por, "marcelo@x");
  assert.strictEqual(c.historico[0].para, "Aprovado");
  assert.strictEqual(c.totais.total, 115000);
  assert.strictEqual(c.total_orion, 115000);
  const bl = r.blocos.find((b) => b._id === "100_0");
  assert.deepStrictEqual(bl.itens[0].m.slice(0, 2), [100010, 20]);
  assert.strictEqual(bl.itens[0].cc, "10100");
  assert.strictEqual(bl.itens[0].plano, "2010101");
  assert.deepStrictEqual(r.semMapa, []);
});

test("diferença entre versões e agrupamento", () => {
  const r = O.prepararDocumentos(base, "orcamentos");
  const at = O.juntarBlocos(r.blocos.filter((b) => b.orcamento === "100")).itens;
  const bs = O.juntarBlocos(r.blocos.filter((b) => b.orcamento === "99")).itens;
  const d = O.diferencaVersoes(at, bs);
  assert.deepStrictEqual(d.map((x) => [x.cc, x.dif]), [["10100", 20000], ["99999", 5000]]);
  const g = O.agrupar(at, "cc", "cc_nome");
  assert.deepStrictEqual(g.map((x) => [x.chave, x.total]), [["10100", 110000], ["99999", 5000]]);
});

test("muitas linhas são divididas em blocos de até 400", () => {
  const itens = [];
  for (let i = 0; i < 950; i++) itens.push({ id: i, orcamento_id: 100, produto_id: 1, plano_financeiro_id: 10, jan: 1 });
  const arq = base.map((a) => (a.tabela === "orcamento_itens" ? { tabela: a.tabela, linhas: itens } : a));
  const r = O.prepararDocumentos(arq, "orcamentos");
  const bl = r.blocos.filter((b) => b.orcamento === "100");
  assert.deepStrictEqual(bl.map((b) => b.itens.length), [400, 400, 150]);
  assert.strictEqual(r.cabecalhos.find((x) => x._id === "100").blocos, 3);
  assert.strictEqual(O.juntarBlocos(bl).itens.length, 950);
});

test("plano ou centro de custo sem correspondência aparece na conferência", () => {
  const arq = base.map((a) => (a.tabela === "orcamento_itens" ? { tabela: a.tabela, linhas: [{ id: 9, orcamento_id: 100, produto_id: 77, plano_financeiro_id: 10, jan: 1 }] } : a));
  const r = O.prepararDocumentos(arq, "orcamentos");
  assert.strictEqual(r.semMapa.length, 1);
});

test("departamentos: matriz de centros de custo, planos e usuários", () => {
  const arq = base.filter((a) => a.tabela !== "departamentos").concat([
    { tabela: "diretorias", linhas: [{ id: 1, nome: "Diretoria Financeira" }] },
    { tabela: "departamentos", linhas: [{ id: 3, nome: "Financeiro", diretoria_id: 1 }, { id: 4, nome: "Obras", ativo: false }] },
    { tabela: "departamento_cost_centers", linhas: [{ departamento_id: 3, cost_center_id: 2, permitido: true }, { departamento_id: 3, cost_center_id: 1, permitido: false }] },
    { tabela: "departamento_planos", linhas: [{ departamento_id: 3, plano_financeiro_id: 10, permitido: true }] },
    { tabela: "user_departamentos", linhas: [{ user_id: 5, departamento_id: 3 }] },
    { tabela: "depara_autorizacao_departamento", linhas: [{ nome_sienge: "FINANCEIRO", sienge_department_id: 12, departamento_id: 3, definido_manual: true }] }
  ]);
  const cad = O.prepararDepartamentos(arq);
  const fin = cad.departamentos.find((d) => d.id === 3);
  assert.deepStrictEqual(fin.ccs, ["99999"]);
  assert.deepStrictEqual(fin.planos, ["2010101"]);
  assert.deepStrictEqual(fin.usuarios, ["marcelo@x"]);
  assert.strictEqual(fin.diretoria, "Diretoria Financeira");
  assert.strictEqual(cad.departamentos.find((d) => d.id === 4).ativo, false);
  assert.strictEqual(cad.depara[0].departamento, 3);
  assert.strictEqual(O.lancamentoPermitido(cad, 3, "10100", "2010101"), true);
  assert.strictEqual(O.lancamentoPermitido(cad, 3, "10100", "1010101"), false);
  cad.produtoPlano = ["99999|2010101"];
  assert.strictEqual(O.lancamentoPermitido(cad, 3, "10100", "2010101"), false);
  assert.strictEqual(O.lancamentoPermitido(cad, 3, "99999", "2010101"), true);
});

test("fluxo de aprovação igual ao do Órion", () => {
  assert.deepStrictEqual(O.resolverTransicao("Rascunho", "Em aprovação"), { destino: "Em aprovação", acao: "enviar" });
  assert.deepStrictEqual(O.resolverTransicao("Em aprovação", "Aprovado"), { destino: "Fechado", acao: "aprovar" });
  assert.deepStrictEqual(O.resolverTransicao("Fechado", "Solicitação Reabertura").acao, "solicitar_reabertura");
  assert.deepStrictEqual(O.resolverTransicao("Solicitação Reabertura", "Reaberto").acao, "aprovar_reabertura");
  assert.throws(() => O.resolverTransicao("Rascunho", "Fechado"), /Não é permitido ir de Rascunho para Fechado/);
  assert.strictEqual(O.editavel("Rascunho"), true);
  assert.strictEqual(O.editavel("Reaberto"), true);
  assert.strictEqual(O.editavel("Em aprovação"), false);
  assert.strictEqual(O.editavel("Substituído"), false);
  O.acoesDoStatus("Em aprovação").forEach((a) => assert.strictEqual(O.resolverTransicao("Em aprovação", a.para).acao, a.acao));
});

test("mês fechado não pode mudar nem ser removido", () => {
  const velha = { cc: "10100", plano: "2010101", m: [100, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const nova = { cc: "10100", plano: "2010101", m: [100, 999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5] };
  assert.strictEqual(O.mesFechadoAlterado(nova, velha, [1, 2]), 2);
  assert.strictEqual(O.mesFechadoAlterado(nova, velha, [1]), 0);
  assert.match(O.validarLinhas([], [velha], { fechados: [2] })[0], /não pode ser removida/);
  assert.deepStrictEqual(O.validarLinhas([nova], [velha], { fechados: [1, 3] }), []);
  assert.match(O.validarLinhas([nova, nova], [], {})[0], /já está no orçamento/);
  const cad = { departamentos: [{ id: 3, planos: ["2010101"] }], produtoPlano: [] };
  assert.deepStrictEqual(O.validarLinhas([nova], [], { cadDepartamentos: cad, departamentoId: 3 }), []);
  assert.match(O.validarLinhas([{ cc: "1", plano: "9", m: [] }], [], { cadDepartamentos: cad, departamentoId: 3 })[0], /Permissão negada/);
});

test("orçado x realizado: despesa sai negativa no caixa e vira positiva; corte por mês", () => {
  const rea = O.agregarRealizado([
    { cc: "10100", plano: "2010101", mes: 1, valor: -500.1 },
    { cc: "10100", plano: "2010101", mes: 2, valor: -100 },
    { cc: "10100", plano: "2010101", mes: 3, valor: -999 },
    { cc: "10100", plano: "2010101", mes: 2, valor: 20 },
    { cc: "77777", plano: "2010101", mes: 1, valor: -10 },
    { cc: "10100", plano: "2010101", mes: 0, valor: -1 }
  ], -1);
  assert.deepStrictEqual(rea.get("10100|2010101").m.slice(0, 3), [50010, 8000, 99900]);
  const linhas = [{ cc: "10100", plano: "2010101", m: [60000, 10000, 10000, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 80000 }];
  const r = O.orcadoRealizado(linhas, rea, 2);
  assert.strictEqual(r.linhas[0].orcado, 70000);
  assert.strictEqual(r.linhas[0].realizado, 58010);
  assert.strictEqual(r.linhas[0].dif, -11990);
  assert.deepStrictEqual(r.foraDoOrcamento, [{ cc: "77777", plano: "2010101", realizado: 1000 }]);
});

test("vendas: grade, VGV = ticket × unidades, distrato separado e mês fechado", () => {
  const planas = [
    { cc: "10100", cc_nome: "E1", plano_venda: "Neutro", mes: 1, vendas: 4, ticket: 25000000, vgv: 100000000 },
    { cc: "10100", cc_nome: "E1", plano_venda: "Neutro", mes: 5, vendas: -1, ticket: 25000000, vgv: -25000000, obs: "Distrato" },
    { cc: "10100", cc_nome: "E1", plano_venda: "Neutro", mes: 2, vendas: 3, ticket: 26000000, vgv: 78000000 }
  ];
  const g = O.vendasParaGrade(planas);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].distrato, false);
  assert.strictEqual(g[1].distrato, true);
  assert.deepStrictEqual(g[0].meses.slice(0, 2), [{ vendas: 4, ticket: 25000000 }, { vendas: 3, ticket: 26000000 }]);
  g[0].meses[2] = { vendas: 2, ticket: 12345 };
  const v = O.gradeParaVendas(g, 2027);
  assert.deepStrictEqual(v.filter((x) => !/Distrato/.test(x.obs)).map((x) => [x.mes, x.vgv]), [[1, 100000000], [2, 78000000], [3, 24690]]);
  assert.strictEqual(v.find((x) => /Distrato/.test(x.obs) && x.mes === 5).vgv, -25000000); /* como no Órion, linha com observação guarda os 12 meses */
  const ant = O.vendasParaGrade(planas);
  assert.match(O.validarVendas(g, ant, [3])[0], /mar está fechado/);
  assert.deepStrictEqual(O.validarVendas(g, ant, [1]), []);
  assert.match(O.validarVendas([g[0], g[0]], [], [])[0], /já está no orçamento/);
  const vazio = O.gradeParaVendas([{ cc: "9", meses: Array.from({ length: 12 }, () => ({ vendas: 0, ticket: 0 })) }], 2027);
  assert.deepStrictEqual(vazio.map((x) => x.mes), [1]);
});

test("semáforo igual ao do Órion", () => {
  assert.strictEqual(O.semaforo(100, 0, "DESPESAS").titulo, "Novo");
  assert.strictEqual(O.semaforo(10000000 + 499999, 10000000, "DESPESAS").titulo, "Imaterial");
  assert.strictEqual(O.semaforo(9000000, 10000000, "DESPESAS").titulo, "Favorável");
  assert.strictEqual(O.semaforo(104000000, 100000000, "DESPESAS").titulo, "Dentro da tolerância");
  assert.strictEqual(O.semaforo(108000000, 100000000, "DESPESAS").titulo, "Atenção");
  assert.strictEqual(O.semaforo(12000000, 10000000, "DESPESAS").titulo, "Acima do limite");
  assert.strictEqual(O.semaforo(12000000, 10000000, "RECEITAS").titulo, "Favorável");
  assert.strictEqual(O.semaforo(-12000000, -10000000, "RESULTADO").titulo, "Acima do limite");
});

test("DFC gerencial: totais por grupo-pai, AV, AH e geração de caixa", () => {
  const grupos = [
    { id: "g_01", name: "01 RECEITAS", type: "total_n1" }, { id: "g_01_01", name: "01.01 VENDA", type: "resultado", parentId: "g_01" },
    { id: "g_03", name: "03 CUSTOS E DESPESAS", type: "formula" },
    { id: "g_05", name: "05 DESPESAS", type: "total_n1" }, { id: "g_05_03", name: "05.03 ADM", type: "resultado", parentId: "g_05" }, { id: "g_05_04", name: "05.04 PESSOAL", type: "resultado", parentId: "g_05" }
  ];
  const r = O.dfcGerencial(grupos, { g_01_01: 1000000, g_05_03: -300000, g_05_04: -200000 }, { g_01_01: 800000, g_05_03: -400000 }, { g_01_01: 400000 });
  const por = Object.fromEntries(r.linhas.map((l) => [l.id, l]));
  assert.ok(!por.g_03);
  assert.strictEqual(por.g_05.orcado, -500000);
  assert.strictEqual(por.g_05.realizado, -400000);
  assert.strictEqual(por.g_01.ah, 1);
  assert.strictEqual(por.g_05_03.av, -0.5);
  assert.deepStrictEqual([r.geracao.orcado, r.geracao.realizado], [500000, 400000]);
  const og = O.orcadoPorGrupo([{ plano: "2010101", m: [100, 200, 300] }, { plano: "9", m: [5] }], (p) => (p === "2010101" ? "g_05_03" : null), -1, 2);
  assert.deepStrictEqual(og, { g_05_03: -300 });
});

test("resumo geral: KPIs, mensal, ranking e realizado só dos CCs e planos do orçamento", () => {
  const C = require("../../orion-orcamento-calc.js");
  const m = (v) => new Array(12).fill(v);
  const desp = [{ cc: "100", cc_nome: "Obra A", plano: "2001", plano_nome: "Material", m: m(100000) }];
  const rec = [{ cc: "100", cc_nome: "Obra A", plano: "1001", plano_nome: "Venda", m: m(300000) }];
  const aloc = [
    { cc: "100", plano: "2001", mes: 1, valor: -1500 },      // despesa (saída) de R$ 1.500
    { cc: "100", plano: "1001", mes: 1, valor: 2500 },       // receita de R$ 2.500
    { cc: "100", plano: "2999", mes: 1, valor: -99999 },     // plano fora do orçamento: não entra
    { cc: "200", plano: "2001", mes: 1, valor: -99999 },     // CC fora do orçamento: não entra
    { cc: "100", plano: "2001", mes: 2, valor: -700 }
  ];
  const r = C.resumoGeral(desp, rec, aloc, [1]);
  assert.strictEqual(r.kpis.despesas.orcado, 100000);
  assert.strictEqual(r.kpis.despesas.realizado, 150000);
  assert.strictEqual(r.kpis.receitas.realizado, 250000);
  assert.strictEqual(r.kpis.resultado.orcado, 200000);
  assert.strictEqual(r.kpis.resultado.realizado, 100000);
  assert.strictEqual(r.mensal[1].desp_realizado, 70000);
  assert.strictEqual(r.mensal[1].usado, false);
  assert.strictEqual(Math.abs(r.ranking[0].dif), 50000);
  assert.strictEqual(r.ranking.length, 2);
  assert.strictEqual(r.grupos[0].tipo, "RECEITAS");
  assert.strictEqual(r.kpis.despesas.semaforo.cor, "cinza"); // R$ 500 de desvio: abaixo dos R$ 5.000 do Órion
  const todos = C.resumoGeral(desp, rec, aloc);
  assert.strictEqual(todos.kpis.despesas.orcado, 1200000);
  assert.strictEqual(todos.kpis.despesas.realizado, 220000);
});

test("analítico de gastos: visão por CC × plano e por plano", () => {
  const C = require("../../orion-orcamento-calc.js");
  const m = (v) => new Array(12).fill(v);
  const desp = [
    { cc: "100", cc_nome: "Obra A", plano: "2001", plano_nome: "Material", m: m(100000) },
    { cc: "200", cc_nome: "Obra B", plano: "2001", plano_nome: "Material", m: m(50000) },
    { cc: "100", cc_nome: "Obra A", plano: "2002", plano_nome: "Serviços", m: m(20000) }
  ];
  const aloc = [{ cc: "100", plano: "2001", mes: 1, valor: -1200 }, { cc: "200", plano: "2001", mes: 2, valor: -300 }];
  const a = C.analiticoGastos(desp, aloc, [1, 2], "cc");
  assert.strictEqual(a.linhas.length, 3);
  assert.strictEqual(a.total.orcado, 340000);
  assert.strictEqual(a.total.realizado, 150000);
  assert.strictEqual(a.total.saldo, 190000);
  const p = C.analiticoGastos(desp, aloc, [1, 2], "plano");
  assert.strictEqual(p.linhas.length, 2);
  const mat = p.linhas.find((x) => x.plano === "2001");
  assert.strictEqual(mat.filhos.length, 2);
  assert.strictEqual(mat.orcado, 300000);
  assert.strictEqual(mat.realizado, 150000);
  assert.strictEqual(mat.r[0], 120000);
});

test("forecast: usa só uma versão (a mais recente ou a escolhida)", () => {
  const C = require("../../orion-orcamento-calc.js");
  const cab = (id, tipo, descricao, corte, versao) => ({ _id: id, ano: 2026, tipo, descricao, mes_corte: corte, versao: versao || 1, status: "Importado Sienge", departamento: { id: 18 } });
  const cabs = [cab("a", "DESPESAS", "Forecast - 2+10", 3), cab("b", "RECEITAS", "Forecast - 2+10", 3), cab("c", "DESPESAS", "Forecast - 8+4", 9), cab("d", "RECEITAS", "Forecast - 8+4", 9), cab("e", "DESPESAS", "Forecast - 8+4", 9, 2), cab("v", "VENDAS", "Forecast - 9+3", 10)];
  assert.deepStrictEqual(C.versoesForecast(cabs, 2026).map((v) => v.descricao), ["Forecast - 8+4", "Forecast - 2+10"]);
  const r = C.documentosVigentes(cabs, { ano: 2026, base: "forecast" });
  assert.strictEqual(r.versao, "Forecast - 8+4");
  assert.deepStrictEqual(r.docs.map((d) => d._id).sort(), ["d", "e"]);
  assert.deepStrictEqual(C.documentosVigentes(cabs, { ano: 2026, base: "forecast", versao: "Forecast - 2+10", tipos: ["DESPESAS"] }).docs.map((d) => d._id), ["a"]);
  assert.strictEqual(C.documentosVigentes(cabs, { ano: 2026, base: "orcamento", dept: "99" }).docs.length, 0);
});

test("novo forecast: nome pela regra do fechamento e inclusão no documento do departamento", () => {
  const C = require("../../orion-orcamento-calc.js");
  const fech = [1, 2, 3, 5].map((mes) => ({ ano: 2026, mes }));
  assert.strictEqual(C.corteForecast(fech, 2026), 3);               // jan, fev e mar fechados em sequência; mai não conta
  assert.strictEqual(C.descricaoForecast(3), "Forecast - 3+9");
  assert.strictEqual(C.corteForecast([], 2026, new Date(2026, 10, 12)), 10);
  assert.strictEqual(C.corteForecast([], 2025, new Date(2026, 10, 12)), 12);
  const cabs = [{ _id: "1", ano: 2026, tipo: "DESPESAS", descricao: "Forecast - 3+9", status: "Rascunho", departamento: { id: 18 } },
    { _id: "2", ano: 2026, tipo: "DESPESAS", descricao: "Forecast - 2+10", status: "Aprovado", departamento: { id: 18 } }];
  assert.strictEqual(C.planejarInclusao(cabs, { ano: 2026, tipo: "despesas", descricao: "Forecast - 3+9", departamentoId: 18 }).destino._id, "1");
  assert.ok(C.planejarInclusao(cabs, { ano: 2026, tipo: "DESPESAS", descricao: "Forecast - 2+10", departamentoId: 18 }).erro);
  assert.strictEqual(C.planejarInclusao(cabs, { ano: 2026, tipo: "DESPESAS", descricao: "Forecast - 4+8", departamentoId: 18 }).destino, null);
  const base = { itens: [{ cc: "100", plano: "1", m: [1, 2] }, { cc: "200", plano: "1", m: [3] }], vendas: [{ cc: "100", ano: 2025, mes: 1, vendas: 2 }] };
  const c = C.copiarEmpreendimento(base, "100", 2026);
  assert.strictEqual(c.itens.length, 1);
  assert.strictEqual(c.vendas[0].ano, 2026);
  c.itens[0].m[0] = 99;
  assert.strictEqual(base.itens[0].m[0], 1);
  assert.deepStrictEqual([...C.empreendimentosDoDoc(base)].sort(), ["100", "200"]);
});

test("analítico: receitas e recortes de investimentos e receita de lotes", () => {
  const C = require("../../orion-orcamento-calc.js");
  const m = (v) => new Array(12).fill(v);
  const rec = [{ cc: "100", plano: "1001", plano_nome: "Receita de venda de lote", m: m(100000) }, { cc: "100", plano: "1002", plano_nome: "Aluguel", m: m(5000) }];
  const lotes = C.filtrarRecorte(rec, "lotes");
  assert.strictEqual(lotes.length, 1);
  const a = C.analiticoGastos(lotes, [{ cc: "100", plano: "1001", mes: 1, valor: 1500 }, { cc: "100", plano: "1002", mes: 1, valor: 999 }], [1], "cc", "RECEITAS");
  assert.strictEqual(a.total.realizado, 150000);
  assert.strictEqual(a.total.saldo, 50000);
  assert.strictEqual(a.linhas[0].semaforo.titulo, "Imaterial");
  assert.strictEqual(C.filtrarRecorte([{ plano_nome: "Aporte de capital" }, { plano_nome: "Material" }], "investimentos").length, 1);
});

test("centavos: valores colados do Excel em português", () => {
  const C = require("../../orion-orcamento-calc.js");
  assert.strictEqual(C.centavosDigitado("1.234,56"), 123456);
  assert.strictEqual(C.centavosDigitado("1.234.567"), 123456700);
  assert.strictEqual(C.centavosDigitado("1.234"), 123400);
  assert.strictEqual(C.centavosDigitado("1234.5"), 123450);
  assert.strictEqual(C.centavosDigitado("-2.500,00"), -250000);
});

test("recebimento por grupo (regra do nome do plano do Órion)", () => {
  const C = require("../../orion-orcamento-calc.js");
  assert.strictEqual(C.grupoRecebimento("Recebimento à vista"), "À vista");
  assert.strictEqual(C.grupoRecebimento("Sinal de venda"), "Sinal / antecipação");
  assert.strictEqual(C.grupoRecebimento("Parcelas de financiamento"), "Parcelado / financiamento");
  assert.strictEqual(C.grupoRecebimento("Taxa mensal"), "Recorrente");
  assert.strictEqual(C.grupoRecebimento("Aluguel"), "Outros");
  const m = (v) => new Array(12).fill(v);
  const rec = [{ cc: "1", plano: "11", plano_nome: "Venda à vista", m: m(100) }, { cc: "2", plano: "12", plano_nome: "Parcelas", m: m(50) }, { cc: "3", plano: "11", plano_nome: "Venda à vista", m: m(10) }];
  const a = C.analiticoGastos(rec, [], [1], "grupo", "RECEITAS");
  assert.deepStrictEqual(a.linhas.map((x) => [x.grupo, x.orcado, x.filhos.length]), [["À vista", 110, 2], ["Parcelado / financiamento", 50, 1]]);
});

test("análise de orçamento: realizado até o corte + forecast depois, por empresa › grupo › centro › plano", () => {
  const C = require("../../orion-orcamento-calc.js");
  const m = (v) => new Array(12).fill(v);
  const r = C.analiseOrcamento({
    orc: [{ cc: "100", cc_nome: "Obra A", plano: "2001", plano_nome: "Material", m: m(1000) }, { cc: "100", plano: "9999", m: m(5) }],
    fc: [{ cc: "100", plano: "2001", m: m(800) }],
    alocacoes: [{ cc: "100", plano: "2001", mes: 1, valor: -9 }, { cc: "100", plano: "2001", mes: 5, valor: -100 }, { cc: "999", plano: "2001", mes: 1, valor: -50 }],
    corte: 3,
    grupoDe: (p) => (p === "2001" ? { id: "g_02", nome: "Custos" } : null),
    empresaDe: () => ({ id: "1", nome: "Empresa 1" })
  });
  assert.strictEqual(r.semGrupo, 1);
  assert.strictEqual(r.empresas.length, 1);
  const pl = r.empresas[0].filhos[0].filhos[0].filhos[0];
  assert.strictEqual(pl.ytd.n, 900);               // jan 900 (R$ 9,00), fev e mar 0
  assert.strictEqual(pl.ytg.n, 9 * 800);           // abr..dez = forecast; o realizado de maio não entra (depois do corte)
  assert.strictEqual(pl.ano.orcado, 12000);
  assert.strictEqual(pl.ano.forecast, 9600);
  assert.strictEqual(r.total.ano.n, 900 + 7200);
});

test("orçamento vigente: um por departamento e tipo, como no Órion", () => {
  const C = require("../../orion-orcamento-calc.js");
  const cab = (id, status, criado, extra) => Object.assign({ _id: id, orion_id: Number(id) || 0, ano: 2026, tipo: "DESPESAS", descricao: "x" + id, status, criado_em: criado, departamento: { id: 18 } }, extra || {});
  const pega = (l) => C.documentosVigentes(l, { ano: 2026, base: "orcamento", tipos: ["DESPESAS"] }).docs.map((d) => d._id);
  assert.deepStrictEqual(pega([cab("1", "Fechado", "2025-12-01"), cab("2", "Aprovado", "2026-01-10"), cab("3", "Rascunho", "2026-03-01")]), ["2"]);
  assert.deepStrictEqual(pega([cab("1", "Reaberto", "2026-01-01"), cab("1_fechado_9", "Substituído", "2026-01-01", { versao_base: "1" })]), ["1_fechado_9"]);
  assert.deepStrictEqual(pega([cab("4", "Rascunho", "2026-01-01"), cab("5", "Em aprovação", "2026-02-01")]), ["5"]);
  assert.deepStrictEqual(pega([cab("6", "Aprovado", "2026-01-01"), cab("7", "Aprovado", "2026-01-01", { departamento: { id: 19 } })]).sort(), ["6", "7"]);
});

test("análise de orçamento (Órion atual): real até o corte + forecast, contra o ano seguinte, cheio e MLDU", () => {
  const C = require("../../orion-orcamento-calc.js");
  const m = (v) => new Array(12).fill(v);
  const r = C.analiseOrcamentoAnual({
    n_fc: [{ cc: "100", cc_nome: "Obra A", plano: "2001", plano_nome: "Material", m: m(1000) }],
    ref: [{ cc: "100", plano: "2001", m: m(1500) }],
    n_real: [{ cc: "100", plano: "2001", mes: 1, valor: -7 }, { cc: "100", plano: "2001", mes: 11, valor: -999 }],
    corte: 9,
    grupoDe: () => ({ id: "g_05", codigo: "05.03", nome: "ADMINISTRATIVAS" }),
    empresaDe: () => ({ id: "6", nome: "ARAÇARI SPE", fator: 0.4 })
  });
  const pl = r.empresas[0].filhos[0].filhos[0].filhos[0];
  assert.strictEqual(pl.n[0], 700);          // jan: realizado
  assert.strictEqual(pl.n[1], 0);            // fev: sem realizado (antes do corte vale o realizado)
  assert.strictEqual(pl.n[10], 1000);        // nov: forecast (depois do corte)
  assert.strictEqual(pl.per.ytg.n, 3000);
  assert.strictEqual(pl.per.fy.ref, 18000);
  assert.strictEqual(pl.n_mldu[0], 280);
  assert.strictEqual(r.total.per.ytd.n, 700);
  assert.strictEqual(r.empresas[0].filhos[0].codigo, "05.03");
});

test("DFC gerencial mensal: séries real, N-1 e referência, cheio e MLDU, por empresa › grupo › plano", () => {
  const C = require("../../orion-orcamento-calc.js");
  const m = (v) => new Array(12).fill(v);
  const r = C.dfcGerencialMensal({
    real: [{ gid: "g_02", cc: "100", plano: "2001", mes: 1, valor: -100, empresa: "6" }, { gid: "g_01", cc: "100", plano: "1001", mes: 1, valor: 400, empresa: "6" }],
    n1: [{ gid: "g_02", cc: "100", plano: "2001", mes: 1, valor: -50, empresa: "6" }],
    ref: [{ cc: "100", plano: "2001", plano_nome: "Material", m: m(8000), sinal: -1 }],
    grupoDe: (p) => (String(p).startsWith("2") ? "g_02" : "g_01"),
    grupos: [{ id: "g_01", code: "01", name: "Entradas" }, { id: "g_02", code: "05.03", name: "Administrativas" }],
    empresaDe: () => ({ id: "6", nome: "ARAÇARI SPE", fator: 0.5 }), agrupar: "visao"
  });
  const e = r.empresas[0];
  assert.strictEqual(e.filhos.length, 2);
  const g = e.filhos.find((x) => x.codigo === "05.03");
  assert.strictEqual(g.real[0], -10000);
  assert.strictEqual(g.real_mldu[0], -5000);
  assert.strictEqual(g.total.ref, -96000);
  assert.strictEqual(g.ah, -1);               // saída de 100 contra 50 no ano anterior: AH = (−100 − (−50)) / 50 = −100%
});

test("orçado × realizado: leitura executiva, pontos de atenção e maiores causas", () => {
  const C = require("../../orion-orcamento-calc.js");
  const r = C.insightsBloco([
    { produto: "100", produto_nome: "Obra A", plano: "1", plano_nome: "Material", ref: 1000000, real: 1500000 },
    { produto: "100", produto_nome: "Obra A", plano: "2", plano_nome: "Serviços", ref: 500000, real: 400000 },
    { produto: "200", produto_nome: "Obra B", plano: "1", plano_nome: "Material", ref: 300000, real: 300000 }
  ], "DESPESAS", "Despesas");
  assert.strictEqual(r.var, 400000);
  assert.strictEqual(r.favoravel, false);
  assert.deepStrictEqual(r.alertas.map((a) => a.titulo), ["Desvio material", "Concentração de desvio"]);
  assert.strictEqual(r.linhas.length, 2);
  assert.strictEqual(r.porProduto[0].chave, "100");
  assert.ok(Math.abs(r.linhas[0].peso - 5 / 6) < 1e-9);
});

test("analítico: leitura executiva e destaque das linhas com a regra do Órion", () => {
  const C = require("../../orion-orcamento-calc.js");
  const l = C.leituraExecutiva([{ orcado: 100000, realizado: 150000 }, { orcado: 200000, realizado: 200000 }, { orcado: 0, realizado: 5000 }], "DESPESAS", "orçado");
  assert.strictEqual(l.varRs, 55000);
  assert.strictEqual(l.favoravel, false);
  assert.strictEqual(l.comDesvioCount, 2);
  assert.strictEqual(l.materialCount, 2);
  assert.strictEqual(l.narrativa, "R$ 550 acima da referência (18,3%). 2 linha(s) com desvio material requer atenção.");
  assert.strictEqual(C.leituraExecutiva([{ orcado: 100, realizado: 100 }], "DESPESAS").narrativa, "Sem desvios relevantes vs orçado.");
  assert.strictEqual(C.leituraExecutiva([{ orcado: 10000000, realizado: 9000000 }], "DESPESAS").narrativa, "R$ 10K abaixo da referência (-10,0%). 1 linha(s) com movimento.");
  assert.strictEqual(C.destaqueLinha(100, 90, "DESPESAS"), "favoravel");
  assert.strictEqual(C.destaqueLinha(100, 104, "DESPESAS"), "desfavoravel");
  assert.strictEqual(C.destaqueLinha(100, 120, "DESPESAS"), "material");
  assert.strictEqual(C.destaqueLinha(100, 100, "DESPESAS"), "");
});
