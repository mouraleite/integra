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
