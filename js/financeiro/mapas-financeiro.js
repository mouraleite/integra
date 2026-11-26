/* Mapas campo do Integra -> coluna do Supabase, área financeiro / tesouraria / pagadoria / fiscal / contábil / marketing
   (ver docs/mapa-tabelas/financeiro-fiscal-marketing.md e supabase/migrations/202611191330_financeiro_fiscal_marketing.sql).
   Usados pelo front (js/financeiro/dados-financeiro.js) e pelo importador da Fase 4
   (ferramentas/migracao/importar-financeiro.js). Formato e tipos em js/nucleo/dados-base.js.
   Nomes de campo = os que o app grava no Firestore. "ms" onde o app grava epoch (Date.now()); "iso" onde grava
   new Date().toISOString(). Conferido com a amostra (integra-export/inventario-amostra) e com information_schema.
   Ids que no Firestore eram número (ou misturados) usam "idTexto": gravam texto, voltam número se forem só dígitos.
   Tipos desta área (acrescentados ao dados-base sem mudar os outros): "simNao" (flag 'S'/'N' do Sienge <-> boolean)
   e "jsonTexto" (texto com JSON no Firestore <-> jsonb).

   Campos de auditoria viram as colunas padrão: createdAt/criadoEm -> criado_em; updatedAt/atualizadoEm -> atualizado_em;
   updatedBy -> atualizado_por. Atenção: o gatilho <tabela>_atualizado_em troca atualizado_em por now() em todo UPDATE
   (só o insert guarda o valor enviado). Quem compara datas (cc_conta_parceria.updatedAt, rydoo_meta.updatedAt...)
   passa a receber o horário do servidor.

   Tabelas com forma especial (um doc do Firestore virou cabeçalho + linhas; não usar só o CRUD genérico):
   - caixa_diario_config (doc saldo_inicial com mapas contas/tipos/empreendimentosExcluidos) -> _contas + _cc_excluidos;
   - caixa_movimentos (+ _itens), cfin_pagos (+ _bills): o objeto do Sienge fica inteiro em "dados";
   - caixa_posicao (rows[] dos chunks <dia>_<n>) -> uma linha por unidade por dia;
   - caixa_valor_receber (+ _itens; "itens" era texto JSON) e _estado (só servidor);
   - antecipacoes_mes (+ _eventos; o texto das partes __pN era a lista de eventos);
   - pagamento_lotes (+ _itens), participacoes_periods (+ _expenses), mutuo_execucoes (+ _centros);
   - dfc_orcamento (+ _linhas), dfc_realizado (+ _itens; linha compacta [gid, code, cc, i, v, ccn, cn]);
   - resultado_caixa ("payload"/partes viraram colunas jsonb), marketing_budget_titulos (partes -> bills),
     marketing_budget_vendas (cc_id/ym saem do id). As funções montar* / desmontar* (sem rede) fazem a conversão;
     dados-financeiro.js e o importador usam as mesmas. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("../nucleo/dados-base.js"));
  else raiz.MapasFinanceiro = fabrica(raiz.DadosBase);
})(typeof self !== "undefined" ? self : this, function (B) {
  "use strict";

  const ts = (col) => [col, "iso"];
  const ms = (col) => [col, "ms"];

  // ---- Colunas not null com default (null/ausente vira o default) e not null sem default (linha não entra) ----
  const PADROES = {
    caixa_diario_config_cc_excluidos: { empreendimentos: [] },
    caixa_movimentos_itens: { centros_custo: [] },
    caixa_posicao: { parc: [] },
    caixa_valor_receber: { falhas: 0 },
    caixa_valor_receber_estado: { empresas: [], ei: 0, fi: 0, done: false, itens: [], falhas: 0 },
    caixa_radar: { receber: [], incerto: [], pagar: [] },
    cfin_pagos: { fechado: false },
    antecipacoes_mes: { eventos: 0 },
    antecipacoes_mes_eventos: { parcelas: [] },
    pagamento_lotes: { cancelado: false, transferencias: [], sienge_historico: [] },
    sienge_creditors: { phones: [], contacts: [], other_contact_methods: [], links: [] },
    dfc_orcamento_linhas: { m: [] },
    resultado_caixa: { arquivos: [], entradas: {}, contas: {}, contas_por_cc: {}, planos_json: {}, nomes: {}, por_arquivo: {} },
    rydoo_arquivos: { chaves: [] },
    rydoo_meta: { items: [] },
    rydoo_titulos: { bank_sent: false, email_sent: false },
    fiscal_notas_envio: { status: "pendente", anexos: [], historico: [], motivos_cancelamento: [] },
    fiscal_notas_aprendizado: { motivos: [], carta_linhas: [] },
    marketing_budgets: { expenses: [] },
    marketing_budget_titulos: { bills: [] },
    marketing_budget_vendas: { vendas: [], distratos: [] },
    mutuo_meta: { ultima: 0 },
    titulos_incompletos_batimento: { rows: [], primeiros: {}, done: false },
  };
  const OBRIGATORIAS = {
    caixa_diario_config_contas: ["company_id", "conta"],
    caixa_movimentos: ["company_id"],
    caixa_movimentos_itens: ["caixa_movimentos_id", "company_id", "ym", "ordem", "dados"],
    caixa_posicao: ["d"],
    caixa_valor_receber: ["company_id"],
    caixa_valor_receber_itens: ["caixa_valor_receber_id", "ordem"],
    caixa_radar: ["company_id", "ym"],
    cfin_pagos_bills: ["cfin_pagos_id", "company_id", "ym", "ordem", "dados"],
    antecipacoes_mes_eventos: ["antecipacoes_mes_id", "tit", "data"],
    pagamento_lotes_itens: ["pagamento_lotes_id", "ordem", "titulo"],
    cc_conta_parceria: ["cc_id"],
    sienge_creditors: ["name"],
    participacoes_credores: ["credor_key"],
    participacoes_painel: ["credor_key"],
    participacoes_periods: ["company_id", "closing"],
    participacoes_periods_expenses: ["participacoes_periods_id", "ordem"],
    dfc_orcamento_linhas: ["dfc_orcamento_id", "ordem"],
    dfc_realizado: ["empresa"],
    dfc_realizado_itens: ["dfc_realizado_id", "ordem"],
    marketing_budget_vendas: ["cc_id", "ym"],
    mutuo_execucoes: ["operacao", "competencia"],
    mutuo_execucoes_centros: ["mutuo_execucoes_id", "chave"],
  };
  function aplicarPadroes(tabela, linha) {
    const pad = PADROES[tabela] || {};
    Object.keys(pad).forEach((c) => { if (linha[c] === null || linha[c] === undefined) linha[c] = JSON.parse(JSON.stringify(pad[c])); });
    return linha;
  }
  function faltando(tabela, linha) {
    return (OBRIGATORIAS[tabela] || []).filter((c) => linha[c] === null || linha[c] === undefined || (c !== "conta" && linha[c] === ""));
  }

  // Campos que eram só contorno do limite de 1 MB do Firestore (nunca viram coluna nem extra).
  const PEDACOS = ["parte", "partes", "chunk", "i", "texto", "payload", "pai", "_p2", "__p0"];
  function sem(obj, chaves) {
    const o = Object.assign({}, obj || {});
    (chaves || []).forEach((k) => { delete o[k]; });
    return o;
  }
  const dataSP = (v) => B.paraBanco(v, "data");
  const vazio = (v) => v === undefined || v === null || v === "";

  const mapas = {
    // ================================ CAIXA DIÁRIO ================================
    // Uma linha por chave "<empresa>|<conta>" dos mapas contas (incluida) e tipos (tipo) do doc saldo_inicial.
    caixa_diario_config_contas: {
      tabela: "caixa_diario_config_contas",
      campos: {
        companyId: ["company_id", "texto"], conta: ["conta", "texto"], incluida: ["incluida", "bool"], tipo: "tipo",
        updatedBy: "atualizado_por", updatedAt: ts("atualizado_em"),
      },
    },
    // empreendimentosExcluidos["<empresa>"]: id = empresa.
    caixa_diario_config_cc_excluidos: {
      tabela: "caixa_diario_config_cc_excluidos",
      campos: { empreendimentos: ["empreendimentos", "textos"], updatedBy: "atualizado_por", updatedAt: ts("atualizado_em") },
    },
    // Cabeçalho "<empresa>_<AAAA-MM>" e marcador "<empresa>_base" ({ companyId, ate, em }). movimentos -> _itens.
    caixa_movimentos: {
      tabela: "caixa_movimentos",
      campos: { companyId: ["company_id", "texto"], ym: "ym", n: ["n", "int"], em: ts("em"), ate: "ate" },
    },
    // Item: o movimento do Sienge inteiro em "dados" (data/centros_custo são derivados; ver linhaMovimentoCaixa).
    caixa_movimentos_itens: {
      tabela: "caixa_movimentos_itens", chaveNumerica: true,
      campos: {
        caixaMovimentosId: ["caixa_movimentos_id", "texto"], companyId: ["company_id", "texto"], ym: "ym",
        ordem: ["ordem", "int"], data: ["data", "data"], centrosCusto: ["centros_custo", "textos"], dados: ["dados", "json"],
      },
    },
    // Uma linha por unidade por dia (rows[] dos chunks). Nomes curtos = chaves das linhas no Firestore.
    caixa_posicao: {
      tabela: "caixa_posicao", chaveNumerica: true,
      campos: {
        d: ["d", "data"], uid: ["uid", "texto"], un: ["un", "texto"], cc: ["cc", "texto"], cn: "cn",
        cid: ["cid", "texto"], cpf: ["cpf", "texto"], nome: "nome", rec: ["rec", "num"], ven: ["ven", "num"],
        av: ["av", "num"], vp: ["vp", "num"], pmp: ["pmp", "num"], st: "st", parc: ["parc", "json"],
      },
    },
    // Doc "emp_<empresa>". "itens" (texto JSON) vira caixa_valor_receber_itens.
    caixa_valor_receber: {
      tabela: "caixa_valor_receber",
      campos: {
        companyId: ["company_id", "texto"], ini: ["ini", "data"], fim: ["fim", "data"], origem: "origem", por: "por",
        falhas: ["falhas", "int"], atualizadoEm: ts("atualizado_em"),
      },
    },
    caixa_valor_receber_itens: {
      tabela: "caixa_valor_receber_itens",
      campos: {
        empresa: "empresa", companyId: ["company_id", "texto"], doc: ["doc", "texto"], descricao: ["descricao", "texto"],
        titulo: ["titulo", "texto"], parcela: ["parcela", "texto"], vencimento: ["vencimento", "data"], valor: ["valor", "num"],
        cliente: "cliente", cc: ["cc", "texto"], ccNome: "cc_nome",
      },
    },
    // Doc _estado (só servidor). itens era texto JSON; lockAte epoch (0 fica em extra como 0).
    caixa_valor_receber_estado: {
      tabela: "caixa_valor_receber_estado",
      campos: {
        date: ["date", "data"], ini: ["ini", "data"], fim: ["fim", "data"], empresas: ["empresas", "textos"],
        ei: ["ei", "int"], fi: ["fi", "int"], done: ["done", "bool"], itens: ["itens", "jsonTexto"],
        falhas: ["falhas", "int"], lockAte: ms("lock_ate"),
      },
    },
    // Radar do mês (id "<empresa>-<AAAA-MM>"). em é ISO e comparado como texto na tela.
    caixa_radar: {
      tabela: "caixa_radar",
      campos: {
        ym: "ym", companyId: ["company_id", "texto"], em: ts("em"), receber: ["receber", "json"],
        incerto: ["incerto", "json"], pagar: ["pagar", "json"],
      },
    },
    // Doc "mutuo_execucoes/<MUTUO|ACERTO>_<AAAAMM>"; centros.<chave> -> mutuo_execucoes_centros.
    mutuo_execucoes: {
      tabela: "mutuo_execucoes",
      campos: { operacao: "operacao", competencia: ["competencia", "texto"], atualizadoEm: ts("atualizado_em") },
    },
    mutuo_execucoes_centros: {
      tabela: "mutuo_execucoes_centros",
      campos: {
        numero: ["numero", "int"], valor: ["valor", "num"], emissao: ["emissao", "texto"], descricao: "descricao",
        rotulo: "rotulo", lancamentos: ["lancamentos", "int"], emitidoPor: "emitido_por", emitidoEm: ts("emitido_em"),
        erroTitulo: "erro_titulo", pdfUrl: "pdf_url", pdfNome: "pdf_nome", xlsxUrl: "xlsx_url", xlsxNome: "xlsx_nome",
        billId: ["bill_id", "idTexto"], tituloDuplicado: ["titulo_duplicado", "bool"],
      },
    },
    // Doc "notas_debito". Gravação pela RPC registrar_nota_debito_mutuo (só avança).
    mutuo_meta: {
      tabela: "mutuo_meta",
      campos: { ultima: ["ultima", "int"], por: "por", atualizadoEm: ts("atualizado_em") },
    },
    // Planilhas importadas (id "<slot>_<empresa>") e forecasts ("fc-<AAAA-MM>", tipo "forecast").
    // payload / partes (texto JSON) viram as colunas jsonb; planosJson continua texto JSON para o front (jsonTexto).
    resultado_caixa: {
      tabela: "resultado_caixa",
      campos: {
        tipo: "tipo", slot: "slot", empresa: ["empresa", "int"], rotulo: "rotulo", nome: "nome", competencia: "competencia",
        em: ts("em"), arquivos: ["arquivos", "textos"], entradas: ["entradas", "json"], contas: ["contas", "json"],
        contasPorCc: ["contas_por_cc", "json"], planosJson: ["planos_json", "jsonTexto"], nomes: ["nomes", "json"],
        porArquivo: ["por_arquivo", "json"],
      },
    },

    // ================================ CONTAS PAGAS / ANTECIPAÇÕES ================================
    // "<empresa>_<AAAA-MM>" e "_corte" ({ ate, ymFechado, em }). bills -> cfin_pagos_bills.
    cfin_pagos: {
      tabela: "cfin_pagos",
      campos: {
        companyId: ["company_id", "texto"], ym: "ym", n: ["n", "int"], em: ts("em"), ate: ["ate", "data"],
        fechado: ["fechado", "bool"], ymFechado: "ym_fechado",
      },
    },
    // Um título/parcela por linha: o objeto do Sienge inteiro em "dados"; as outras colunas são derivadas
    // (linhaBillCfin, igual à RPC gravar_cfin_pagos_mes). Serve para listar/filtrar com DadosNucleo.tabela.
    cfin_pagos_bills: {
      tabela: "cfin_pagos_bills", chaveNumerica: true,
      campos: {
        cfinPagosId: ["cfin_pagos_id", "texto"], companyId: ["company_id", "texto"], ym: "ym", ordem: ["ordem", "int"],
        billId: ["bill_id", "idTexto"], installmentId: ["installment_id", "int"], creditorId: ["creditor_id", "idTexto"],
        creditorName: "creditor_name", documentIdentificationId: "document_identification_id",
        documentNumber: ["document_number", "texto"], dueDate: ["due_date", "data"], issueDate: ["issue_date", "data"],
        originalAmount: ["original_amount", "num"], balanceAmount: ["balance_amount", "num"], dados: ["dados", "json"],
      },
    },
    // Cabeçalho do mês (id "AAAA-MM"; o campo "mes" é o próprio id).
    antecipacoes_mes: {
      tabela: "antecipacoes_mes",
      campos: { eventos: ["eventos", "int"], fonte: "fonte", atualizadoEm: ts("atualizado_em") },
    },
    // Um evento por linha. k (= "<billId>|<data>") é o id. tit/emp/cliId/cc eram número.
    antecipacoes_mes_eventos: {
      tabela: "antecipacoes_mes_eventos",
      campos: {
        k: ["id", "texto"], tit: ["tit", "idTexto"], data: ["data", "data"], emp: ["emp", "idTexto"], empNome: "emp_nome",
        cli: "cli", cliId: ["cli_id", "idTexto"], unid: ["unid", "texto"], cc: ["cc", "idTexto"], ccNome: "cc_nome",
        doc: ["doc", "texto"], taxa: ["taxa", "num"], tipoJuros: "tipo_juros", parcelas: ["parcelas", "json"],
        vf: ["vf", "num"], vp: ["vp", "num"], pago: ["pago", "num"], descSienge: ["desc_sienge", "num"],
        maxDias: ["max_dias", "int"], minDias: ["min_dias", "int"], juros: ["juros", "num"], comercial: ["comercial", "num"],
        descTotal: ["desc_total", "num"], np: ["np", "int"], faixa: "faixa",
      },
    },

    // ================================ PAGADORIA ================================
    // Lote: conta {} e sienge {} achatados (campos com ponto). itens -> pagamento_lotes_itens.
    pagamento_lotes: {
      tabela: "pagamento_lotes",
      campos: {
        criadoPor: "criado_por", criadoPorEmail: "criado_por_email", criadoEm: ts("criado_em"), total: ["total", "num"],
        contaKey: ["conta_key", "texto"], "conta.id": ["conta_id", "texto"], "conta.nome": "conta_nome",
        "conta.numero": ["conta_numero", "texto"], "conta.agencia": ["conta_agencia", "texto"],
        "conta.banco": ["conta_banco", "texto"], dia: ["dia", "data"], empresaConta: ["empresa_conta", "texto"],
        dataBaixa: ["data_baixa", "data"], cancelado: ["cancelado", "bool"], canceladoMotivo: "cancelado_motivo",
        canceladoEm: ts("cancelado_em"), transferencias: ["transferencias", "json"],
        "sienge.numero": ["sienge_numero", "texto"], "sienge.status": "sienge_status", "sienge.geradoEm": ts("sienge_gerado_em"),
        "sienge.geradoPor": "sienge_gerado_por", "sienge.erro": "sienge_erro", "sienge.historico": ["sienge_historico", "json"],
      },
    },
    pagamento_lotes_itens: {
      tabela: "pagamento_lotes_itens",
      campos: {
        titulo: ["titulo", "texto"], parcela: ["parcela", "texto"], forma: "forma", linhaDigitavel: "linha_digitavel",
        vencimento: ["vencimento", "data"], valor: ["valor", "num"], valorBruto: ["valor_bruto", "num"],
        impostosRetidos: ["impostos_retidos", "num"], impostos: "impostos", credorId: ["credor_id", "texto"],
        credor: "credor", companyId: ["company_id", "texto"], ccs: "ccs", conferencia: "conferencia",
        documento: ["documento", "texto"], valida: ["valida", "json"],
      },
    },
    // Conta de parceria por CC (id = cc_id). conta null zera as colunas conta_*. updatedAt é epoch.
    cc_conta_parceria: {
      tabela: "cc_conta_parceria",
      campos: {
        cc_id: ["cc_id", "texto"], "conta.id": ["conta_id", "texto"], "conta.banco": ["conta_banco", "texto"],
        "conta.nome": "conta_nome", "conta.agencia": ["conta_agencia", "texto"], "conta.numero": ["conta_numero", "texto"],
        updatedAt: ms("atualizado_em"), updatedBy: "atualizado_por",
      },
    },
    // Credores do Sienge (id numérico; supplier/broker/employee 'S'/'N' <-> boolean).
    sienge_creditors: {
      tabela: "sienge_creditors", chaveNumerica: true,
      campos: {
        name: "name", tradeName: "trade_name", cpf: ["cpf", "texto"], cnpj: ["cnpj", "texto"], active: ["active", "bool"],
        supplier: ["supplier", "simNao"], broker: ["broker", "simNao"], employee: ["employee", "simNao"],
        stateRegistrationNumber: ["state_registration_number", "texto"], stateRegistrationType: "state_registration_type",
        paymentTypeId: ["payment_type_id", "int"], taxRegimeId: ["tax_regime_id", "int"], taxRegime: "tax_regime",
        taxClassificationId: ["tax_classification_id", "int"], taxClassification: "tax_classification",
        creationDate: ["creation_date", "data"], lastModificationDate: ["last_modification_date", "data"],
        address: ["address", "json"], phones: ["phones", "json"], contacts: ["contacts", "json"],
        otherContactMethods: ["other_contact_methods", "json"], links: ["links", "json"],
        _batimentoDate: ["batimento_date", "data"],
      },
    },

    // ================================ PARTICIPAÇÕES (ELLENCO) ================================
    // id = encodeURIComponent(credorKey).
    participacoes_credores: {
      tabela: "participacoes_credores",
      campos: {
        credorKey: "credor_key", credor: "credor", "categoriaMl.id": ["categoria_ml_id", "texto"],
        "categoriaMl.siengeId": ["categoria_ml_sienge_id", "texto"], "categoriaMl.label": "categoria_ml_label",
        por: "por", em: ts("em"),
      },
    },
    // Painel do sócio: credores marcados em Por categoria, com escopo e avaliação. id = encodeURIComponent(credorKey).
    participacoes_painel: {
      tabela: "participacoes_painel",
      campos: {
        credorKey: "credor_key", credor: "credor", on: ["marcado", "bool"], escopo: "escopo",
        justifica: "justifica", por: "por", em: ts("em"),
      },
    },
    // id "<companyId>_<closing>". expenses -> _expenses. updatedAtServer (Timestamp) também vai para atualizado_em
    // (no importador vale ele, antes de updatedAt); na leitura volta só updatedAt (epoch).
    participacoes_periods: {
      tabela: "participacoes_periods",
      campos: {
        companyId: ["company_id", "texto"], closing: "closing", fileName: "file_name", saldoTotal: ["saldo_total", "num"],
        pdfUrl: "pdf_url", pdfPath: "pdf_path", cacheVer: ["cache_ver", "int"], updatedBy: "atualizado_por",
        updatedAt: ms("atualizado_em"),
      },
    },
    // date (DD/MM/AAAA) e iso (AAAA-MM-DD) são a mesma data: os dois saem da coluna iso (iso vence na gravação).
    participacoes_periods_expenses: {
      tabela: "participacoes_periods_expenses",
      campos: {
        sourceFile: "source_file", credor: "credor", categoria: "categoria", categoriaId: ["categoria_id", "texto"],
        valor: ["valor", "num"], doc: ["doc", "texto"], periodo: "periodo", detalhe: "detalhe",
        date: ["iso", "dataBR"], iso: ["iso", "data"],
      },
    },

    // ================================ DFC / ORÇAMENTO ================================
    // "2027", "2027_v1", "2027_v2". payload/partes (lista de linhas) -> dfc_orcamento_linhas.
    dfc_orcamento: {
      tabela: "dfc_orcamento",
      campos: { fileName: "file_name", savedAt: ms("saved_at"), year: ["year", "int"], n: ["n", "int"] },
    },
    dfc_orcamento_linhas: {
      tabela: "dfc_orcamento_linhas",
      campos: {
        e: ["e", "texto"], enome: "enome", cc: ["cc", "texto"], en: "en", conta: ["conta", "texto"], cn: "cn", obs: "obs",
        m: ["m", "json"],
      },
    },
    // "c<empresa>". payload/partes (linhas compactas) -> dfc_realizado_itens.
    dfc_realizado: {
      tabela: "dfc_realizado",
      campos: {
        empresa: ["empresa", "texto"], fim: ["fim", "data"], ate: ["ate", "data"], v: ["v", "int"], em: ts("em"), n: ["n", "int"],
      },
    },
    dfc_realizado_itens: {
      tabela: "dfc_realizado_itens",
      campos: {
        gid: "gid", code: ["code", "texto"], cc: ["cc", "texto"], i: ["i", "int"], v: ["v", "num"], ccn: "ccn", cn: "cn",
      },
    },

    // ================================ RYDOO ================================
    // id legado = Date.now() do upload.
    rydoo_arquivos: {
      tabela: "rydoo_arquivos",
      campos: { fileName: "file_name", importedAt: ts("imported_at"), linhas: ["linhas", "int"], chaves: ["chaves", "textos"] },
    },
    // Doc "colaboradores" (cache). items mantém employee 'S'/'N' como veio.
    rydoo_meta: {
      tabela: "rydoo_meta",
      campos: { count: ["count", "int"], items: ["items", "json"], updatedAt: ts("atualizado_em") },
    },
    // id "<creditorId>_<MMAAAA>"; competencia (coluna) sai do id (competenciaRydoo), não é campo do doc.
    rydoo_titulos: {
      tabela: "rydoo_titulos",
      campos: {
        billId: ["bill_id", "texto"], pessoa: "pessoa", creditorId: ["creditor_id", "idTexto"],
        documentNumber: ["document_number", "texto"], notes: "notes", total: ["total", "num"],
        bankSent: ["bank_sent", "bool"], bankSentAt: ts("bank_sent_at"), emailSent: ["email_sent", "bool"],
        emailTo: "email_to", createdAt: ts("criado_em"),
      },
    },

    // ================================ FISCAL ================================
    // Fila de notas (realtime). fornecedor / cc / pagamento achatados; datas em epoch.
    fiscal_notas_envio: {
      tabela: "fiscal_notas_envio",
      campos: {
        status: "status", pedido: ["pedido", "texto"], pedidoApi: ["pedido_api", "texto"], empresa: ["empresa", "texto"],
        numeroNota: ["numero_nota", "texto"], serieNota: ["serie_nota", "texto"], valorNota: ["valor_nota", "num"],
        valorPedido: ["valor_pedido", "num"], observacao: "observacao",
        "fornecedor.id": ["fornecedor_id", "texto"], "fornecedor.doc": ["fornecedor_doc", "texto"],
        "fornecedor.nome": "fornecedor_nome", "cc.id": ["cc_id", "texto"], "cc.nome": "cc_nome",
        "pagamento.forma": "pagamento_forma", "pagamento.data": ["pagamento_data", "data"],
        "pagamento.detalhe": "pagamento_detalhe", "pagamento.conta": ["pagamento_conta", "json"],
        previsao: ["previsao", "json"], anexos: ["anexos", "json"], historico: ["historico", "json"],
        criadoPor: "criado_por", criadoPorEmail: "criado_por_email", criadoPorSienge: "criado_por_sienge",
        assumidoPor: "assumido_por", assumidoPorEmail: "assumido_por_email", assumidoEm: ms("assumido_em"),
        validadoPor: "validado_por", validadoPorEmail: "validado_por_email", validadoEm: ms("validado_em"),
        lancadoPor: "lancado_por", lancadoPorEmail: "lancado_por_email", lancadoEm: ms("lancado_em"),
        seqSienge: ["seq_sienge", "texto"], billId: ["bill_id", "texto"], motivoDevolucao: "motivo_devolucao",
        devolucaoTipo: "devolucao_tipo", devolvidoPor: "devolvido_por", devolvidoPorSienge: "devolvido_por_sienge",
        devolvidoEm: ms("devolvido_em"), motivosCancelamento: ["motivos_cancelamento", "textos"],
        criadoEm: ms("criado_em"), atualizadoEm: ms("atualizado_em"),
      },
    },
    fiscal_notas_aprendizado: {
      tabela: "fiscal_notas_aprendizado",
      campos: {
        em: ms("em"), pedido: ["pedido", "texto"], fornecedorId: ["fornecedor_id", "texto"],
        fornecedorDoc: ["fornecedor_doc", "texto"], fornecedorNome: "fornecedor_nome", numeroNota: ["numero_nota", "texto"],
        tipo: "tipo", motivos: ["motivos", "textos"], cartaLinhas: ["carta_linhas", "json"], motivo: "motivo",
      },
    },

    // ================================ MARKETING ================================
    marketing_budgets: {
      tabela: "marketing_budgets",
      campos: {
        eventName: "event_name", companyId: ["company_id", "texto"], costCenterId: ["cost_center_id", "texto"],
        costCenterName: "cost_center_name", plannedValue: ["planned_value", "num"], startDate: ["start_date", "data"],
        endDate: ["end_date", "data"], status: "status", notes: "notes", createdBy: "created_by",
        expenses: ["expenses", "json"], createdAt: ts("criado_em"), updatedAt: ts("atualizado_em"),
      },
    },
    // Docs por CC ({ ccs, pct }) e "_categorias" ({ ids }).
    marketing_budget_config: {
      tabela: "marketing_budget_config",
      campos: {
        ccs: ["ccs", "textos"], pct: ["pct", "num"], ids: ["ids", "textos"], updatedBy: "atualizado_por",
        updatedAt: ts("atualizado_em"),
      },
    },
    // Cache de 30 min por CC: { start, end, savedAt, bills } (bills juntado das partes <cc>_<i>.texto).
    marketing_budget_titulos: {
      tabela: "marketing_budget_titulos",
      campos: { start: ["inicio", "data"], end: ["fim", "data"], savedAt: ms("saved_at"), bills: ["bills", "json"] },
    },
    // "<cc>_<AAAA-MM>": cc_id e ym saem do id (idVendasMarketing). O doc "<cc>" (meses[]) não existe mais.
    marketing_budget_vendas: {
      tabela: "marketing_budget_vendas",
      campos: { vendas: ["vendas", "json"], distratos: ["distratos", "json"], savedAt: ms("saved_at") },
    },

    // ================================ TÍTULOS INCOMPLETOS ================================
    // Doc "atual" (só o cron grava). primeiros era texto JSON; lockAte epoch.
    titulos_incompletos_batimento: {
      tabela: "titulos_incompletos_batimento",
      campos: {
        date: ["date", "data"], at: ts("at"), total: ["total", "int"], rows: ["rows", "json"],
        primeiros: ["primeiros", "jsonTexto"], done: ["done", "bool"], lockAte: ms("lock_ate"),
      },
    },
  };

  // =============================================================================================
  // Ajudantes (sem rede) usados pelo front e pelo importador.

  // "1|99804-6" -> { companyId: "1", conta: "99804-6" } (parte no PRIMEIRO "|").
  function partesContaCaixa(chave) {
    const s = String(chave || "");
    const i = s.indexOf("|");
    return i < 0 ? null : { companyId: s.slice(0, i), conta: s.slice(i + 1) };
  }
  // "3349_102026" -> "102026"
  function competenciaRydoo(id) {
    const s = String(id || "");
    const i = s.indexOf("_");
    return i < 0 ? null : s.slice(i + 1);
  }
  // "13900_2024-01" -> { ccId: "13900", ym: "2024-01" }
  function idVendasMarketing(id) {
    const m = String(id || "").match(/^(.+)_(\d{4}-\d{2})$/);
    return m ? { ccId: m[1], ym: m[2] } : null;
  }
  // id do período da prestação de contas (participacoes.js cloudDocId)
  function idPeriodoParticipacoes(companyId, closing) {
    return (String(companyId || "").trim() + "_" + String(closing || "").trim()).replace(/[^\w.-]+/g, "_");
  }

  // ---- caixa_diario_config ----
  // doc saldo_inicial -> { contas: [linhas], ccExcluidos: [linhas] }. Chave sem "|" fica de fora (aviso de quem chama).
  function desmontarConfigCaixa(doc) {
    const d = doc || {};
    const base = {};
    if (d.updatedBy !== undefined) base.updatedBy = d.updatedBy;
    if (d.updatedAt !== undefined) base.updatedAt = d.updatedAt;
    const porChave = {};
    const pegar = (k) => {
      if (porChave[k]) return porChave[k];
      const p = partesContaCaixa(k);
      if (!p) return null;
      return (porChave[k] = Object.assign({}, base, p));
    };
    const ignoradas = [];
    Object.keys(d.contas || {}).forEach((k) => { const o = pegar(k); if (o) o.incluida = d.contas[k]; else ignoradas.push(k); });
    Object.keys(d.tipos || {}).forEach((k) => { const o = pegar(k); if (o) o.tipo = d.tipos[k]; else ignoradas.push(k); });
    const contas = Object.keys(porChave).map((k) => B.paraLinha(mapas.caixa_diario_config_contas, porChave[k], k));
    const exc = d.empreendimentosExcluidos || {};
    const ccExcluidos = Object.keys(exc).map((co) =>
      aplicarPadroes("caixa_diario_config_cc_excluidos", B.paraLinha(mapas.caixa_diario_config_cc_excluidos,
        Object.assign({}, base, { empreendimentos: exc[co] }), co)));
    const resto = sem(d, ["contas", "tipos", "empreendimentosExcluidos", "updatedAt", "updatedBy"]);
    return { contas, ccExcluidos, ignoradas, resto };
  }
  // linhas -> doc saldo_inicial ({ contas, tipos, empreendimentosExcluidos, updatedAt, updatedBy }). null se vazio.
  function montarConfigCaixa(linhasContas, linhasCc) {
    const out = { contas: {}, tipos: {}, empreendimentosExcluidos: {} };
    let ultima = null;
    const ver = (l) => { if (!ultima || String(l.atualizado_em) > String(ultima.atualizado_em)) ultima = l; };
    (linhasContas || []).forEach((l) => {
      if (l.incluida !== null && l.incluida !== undefined) out.contas[l.id] = !!l.incluida;
      if (l.tipo !== null && l.tipo !== undefined) out.tipos[l.id] = l.tipo;
      ver(l);
    });
    (linhasCc || []).forEach((l) => { out.empreendimentosExcluidos[l.id] = Array.isArray(l.empreendimentos) ? l.empreendimentos : []; ver(l); });
    if (!ultima) return null;
    if (ultima.atualizado_em) out.updatedAt = new Date(Date.parse(ultima.atualizado_em)).toISOString();
    if (ultima.atualizado_por) out.updatedBy = ultima.atualizado_por;
    return out;
  }

  // ---- caixa_movimentos: colunas derivadas do movimento (iguais à RPC gravar_caixa_movimentos_mes) ----
  function linhaMovimentoCaixa(m, paiId, companyId, ym, ordem) {
    const x = m || {};
    const ccs = [];
    const add = (c) => { if (c !== null && c !== undefined && c !== "" && ccs.indexOf(String(c)) < 0) ccs.push(String(c)); };
    add(x.costCenterId);
    (Array.isArray(x.financialCategories) ? x.financialCategories : []).forEach((fc) => add(fc && fc.costCenterId));
    const data = !vazio(x.bankMovementDate) ? x.bankMovementDate : (!vazio(x.paymentDate) ? x.paymentDate : x.date);
    return {
      caixa_movimentos_id: paiId, company_id: String(companyId), ym: ym, ordem: ordem,
      data: dataSP(data), centros_custo: ccs, dados: x, extra: {},
    };
  }

  // ---- cfin_pagos_bills: colunas derivadas do título (iguais à RPC gravar_cfin_pagos_mes) ----
  function linhaBillCfin(b, paiId, companyId, ym, ordem) {
    const x = b || {};
    const txt = (v) => (v === undefined || v === null ? null : String(v));
    return {
      cfin_pagos_id: paiId,
      company_id: !vazio(x.companyId) ? String(x.companyId) : (companyId || "todas"),
      ym: ym, ordem: ordem,
      bill_id: txt(x.billId), installment_id: B.paraBanco(x.installmentId, "int"), creditor_id: txt(x.creditorId),
      creditor_name: txt(x.creditorName),
      document_identification_id: x.documentIdentificationId == null ? null : String(x.documentIdentificationId).trim(),
      document_number: txt(x.documentNumber), due_date: dataSP(x.dueDate), issue_date: dataSP(x.issueDate),
      original_amount: B.paraBanco(x.originalAmount, "num"), balance_amount: B.paraBanco(x.balanceAmount, "num"),
      dados: x, extra: {},
    };
  }

  // ---- caixa_valor_receber: doc (itens texto JSON ou lista) <-> cabeçalho + itens ----
  function itensValorReceber(itens) {
    if (Array.isArray(itens)) return itens;
    if (typeof itens === "string" && itens.trim()) { try { const v = JSON.parse(itens); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    return [];
  }
  function desmontarValorReceber(doc, id) {
    const d = doc || {};
    const pai = B.paraLinha(mapas.caixa_valor_receber, sem(d, ["itens"]), id || ("emp_" + d.companyId));
    if (!pai.company_id && id) pai.company_id = String(id).replace(/^emp_/, "");
    aplicarPadroes("caixa_valor_receber", pai);
    const itens = itensValorReceber(d.itens).map((it, i) => Object.assign(
      B.paraLinha(mapas.caixa_valor_receber_itens, it || {}), { caixa_valor_receber_id: pai.id, ordem: i + 1 }));
    return { pai, itens };
  }
  // Doc no formato do Firestore: itens volta como TEXTO JSON (como o app e o cron leem hoje).
  function montarValorReceber(pai, itens) {
    if (!pai) return null;
    const o = B.paraObjeto(mapas.caixa_valor_receber, pai);
    delete o.id;
    const lista = (itens || []).slice().sort((a, b) => a.ordem - b.ordem).map((l) => {
      const x = B.paraObjeto(mapas.caixa_valor_receber_itens, l);
      delete x.id;
      return x;
    });
    o.itens = JSON.stringify(lista);
    return o;
  }

  // ---- antecipacoes_mes: { mes, eventos (nº), atualizadoEm, fonte } + lista de eventos ----
  function linhaEventoAntecipacao(ev, mes) {
    const l = B.paraLinha(mapas.antecipacoes_mes_eventos, ev || {}, ev && ev.k);
    l.antecipacoes_mes_id = mes || (l.data ? String(l.data).slice(0, 7) : null);
    return aplicarPadroes("antecipacoes_mes_eventos", l);
  }
  function eventoAntecipacao(l) {
    const o = B.paraObjeto(mapas.antecipacoes_mes_eventos, l);
    delete o.id; // k já volta (mesma coluna)
    return o;
  }
  // { eventos: [...], atualizadoEm, fonte } (o que antecipacoes.js lerMes guarda no cache). Eventos em ordem de data/k.
  function montarAntecipacaoMes(pai, eventos) {
    if (!pai) return { eventos: [], atualizadoEm: "", vazio: true };
    const o = B.paraObjeto(mapas.antecipacoes_mes, pai);
    const lista = (eventos || []).map(eventoAntecipacao).sort((a, b) =>
      String(a.data).localeCompare(String(b.data)) || String(a.k).localeCompare(String(b.k)));
    return { eventos: lista, atualizadoEm: o.atualizadoEm || "", fonte: o.fonte || "" };
  }

  // ---- pagamento_lotes ----
  // Lote (objeto do app) -> { pai, itens } com as mesmas regras da RPC salvar_pagamento_lote.
  function desmontarLote(lote) {
    const x = lote || {};
    const pai = B.paraLinha(mapas.pagamento_lotes, sem(x, ["itens"]), x.id);
    if (pai.criado_por_email) pai.criado_por_email = String(pai.criado_por_email).toLowerCase();
    if (pai.sienge_numero === "") pai.sienge_numero = null;
    if (pai.sienge_erro === "") pai.sienge_erro = null;
    if (pai.extra && pai.extra.sienge && typeof pai.extra.sienge === "object" && !Object.keys(pai.extra.sienge).length) delete pai.extra.sienge;
    aplicarPadroes("pagamento_lotes", pai);
    const itens = (Array.isArray(x.itens) ? x.itens : []).map((it, i) => {
      const l = B.paraLinha(mapas.pagamento_lotes_itens, it || {});
      if (l.titulo === null || l.titulo === undefined) l.titulo = "";
      return Object.assign(l, { pagamento_lotes_id: pai.id, ordem: i + 1 });
    });
    return { pai, itens };
  }
  // Linha (com pagamento_lotes_itens embutido ou à parte) -> lote no formato do app ({ id, conta, sienge, itens... }).
  function montarLote(pai, itens) {
    if (!pai) return null;
    const o = B.paraObjeto(mapas.pagamento_lotes, sem(pai, ["pagamento_lotes_itens"]));
    const lista = itens || pai.pagamento_lotes_itens || [];
    o.itens = lista.slice().sort((a, b) => a.ordem - b.ordem).map((l) => {
      const it = B.paraObjeto(mapas.pagamento_lotes_itens, l);
      delete it.id;
      return it;
    });
    if (o.cancelado === false) delete o.cancelado; // default do banco; o app só grava quando cancela
    o.id = pai.id;
    return o;
  }

  // ---- participacoes_periods ----
  function linhaDespesaParticipacao(x, paiId, ordem) {
    const l = B.paraLinha(mapas.participacoes_periods_expenses, x || {});
    // date diferente de iso: guarda o original em extra.date (não se perde).
    if (x && !vazio(x.date) && !vazio(x.iso) && B.paraBanco(x.date, "dataBR") !== B.paraBanco(x.iso, "data")) l.extra.date = x.date;
    return Object.assign(l, { participacoes_periods_id: paiId, ordem: ordem });
  }
  function despesaParticipacao(l) {
    const o = B.paraObjeto(mapas.participacoes_periods_expenses, l);
    if (l.extra && l.extra.date !== undefined) o.date = l.extra.date;
    delete o.id;
    return o;
  }
  // Período (doc) -> { pai, despesas }. atualizado_em = updatedAtServer (Timestamp/ISO) ou updatedAt (epoch).
  function desmontarPeriodo(doc, id) {
    const d = doc || {};
    const ref = id || idPeriodoParticipacoes(d.companyId, d.closing);
    const pai = B.paraLinha(mapas.participacoes_periods, sem(d, ["expenses", "updatedAtServer"]), ref);
    const srv = d.updatedAtServer && typeof d.updatedAtServer === "object" && !Array.isArray(d.updatedAtServer)
      ? (d.updatedAtServer.iso || B.paraMs(d.updatedAtServer)) : d.updatedAtServer;
    const at = B.paraBanco(srv, "iso");
    if (at) pai.atualizado_em = at;
    const despesas = (Array.isArray(d.expenses) ? d.expenses : []).map((x, i) => linhaDespesaParticipacao(x, ref, i + 1));
    return { pai, despesas };
  }
  function montarPeriodo(pai, despesas) {
    if (!pai) return null;
    const o = B.paraObjeto(mapas.participacoes_periods, sem(pai, ["participacoes_periods_expenses"]));
    const lista = despesas || pai.participacoes_periods_expenses || [];
    o.expenses = lista.slice().sort((a, b) => a.ordem - b.ordem).map(despesaParticipacao);
    o.id = pai.id;
    return o;
  }

  // ---- dfc_orcamento: { fileName, savedAt, year, n, payload (texto JSON das linhas), partes: [] } ----
  function linhaOrcamentoDfc(x, paiId, ordem) {
    return aplicarPadroes("dfc_orcamento_linhas", Object.assign(B.paraLinha(mapas.dfc_orcamento_linhas, x || {}),
      { dfc_orcamento_id: paiId, ordem: ordem }));
  }
  function montarOrcamentoDfc(pai, linhas) {
    if (!pai) return null;
    const o = B.paraObjeto(mapas.dfc_orcamento, sem(pai, ["dfc_orcamento_linhas"]));
    delete o.id;
    const lista = (linhas || pai.dfc_orcamento_linhas || []).slice().sort((a, b) => a.ordem - b.ordem).map((l) => {
      const x = B.paraObjeto(mapas.dfc_orcamento_linhas, l);
      delete x.id;
      if (Array.isArray(x.m)) x.m = x.m.map((v) => (typeof v === "string" ? Number(v) : v));
      return x;
    });
    o.payload = JSON.stringify(lista);
    o.partes = [];
    return o;
  }

  // ---- dfc_realizado: linha compacta [gid, code, cc, i, v, ccn, cn] <-> objeto ----
  function itemRealizadoDfc(r) {
    if (Array.isArray(r)) return { gid: r[0], code: r[1], cc: r[2], i: r[3], v: r[4], ccn: r[5], cn: r[6] };
    return r || {};
  }
  function compactoRealizadoDfc(o) {
    return [o.gid, o.code, o.cc, o.i, o.v, o.ccn, o.cn];
  }
  function linhaRealizadoDfc(r, paiId, ordem) {
    const l = B.paraLinha(mapas.dfc_realizado_itens, itemRealizadoDfc(r));
    return Object.assign(l, { dfc_realizado_id: paiId, ordem: ordem });
  }
  // Doc no formato atual (payload = texto JSON das linhas compactas, partes = []).
  function montarRealizadoDfc(pai, itens) {
    if (!pai) return null;
    const o = B.paraObjeto(mapas.dfc_realizado, sem(pai, ["dfc_realizado_itens"]));
    delete o.id;
    const lista = (itens || pai.dfc_realizado_itens || []).slice().sort((a, b) => a.ordem - b.ordem).map((l) => {
      const x = B.paraObjeto(mapas.dfc_realizado_itens, l);
      const c = compactoRealizadoDfc(x);
      return c.map((v, k) => (v === undefined ? (k === 5 || k === 6 ? "" : null) : v));
    });
    o.payload = JSON.stringify(lista);
    o.partes = [];
    return o;
  }

  // ---- resultado_caixa: payload (texto JSON com entradas/contas/contasPorCc/planosJson) vira colunas ----
  // texto = payload do doc ou as partes __pN já concatenadas. Devolve o objeto pronto para paraLinha.
  function abrirResultado(doc, texto) {
    const d = sem(doc, PEDACOS.concat(["tipo"]));
    if (doc && doc.tipo && doc.tipo !== "parte") d.tipo = doc.tipo;
    const t = texto !== undefined ? texto : (doc && typeof doc.payload === "string" ? doc.payload : "");
    if (t) {
      const det = JSON.parse(t); // erro sobe para quem chama (importador avisa)
      ["entradas", "contas", "contasPorCc", "planosJson"].forEach((k) => { if (det[k] !== undefined) d[k] = det[k]; });
      if (det.planosPorCc !== undefined && det.planosJson === undefined) d.planosPorCc = det.planosPorCc;
    }
    return d;
  }
  function montarResultado(l) {
    if (!l) return null;
    const o = B.paraObjeto(mapas.resultado_caixa, l);
    o.partes = [];
    return o;
  }

  // ---- mutuo_execucoes: { operacao, competencia, atualizadoEm, centros: { <chave>: {...} } } ----
  function linhaCentroMutuo(c, paiId, chave) {
    return Object.assign(B.paraLinha(mapas.mutuo_execucoes_centros, c || {}), { mutuo_execucoes_id: paiId, chave: String(chave) });
  }
  function montarExecucaoMutuo(pai, centros) {
    if (!pai) return null;
    const o = B.paraObjeto(mapas.mutuo_execucoes, sem(pai, ["mutuo_execucoes_centros"]));
    o.centros = {};
    (centros || pai.mutuo_execucoes_centros || []).forEach((l) => {
      const c = B.paraObjeto(mapas.mutuo_execucoes_centros, l);
      delete c.id;
      o.centros[l.chave] = c;
    });
    o.id = pai.id;
    return o;
  }

  // ---- marketing_budget_titulos / _vendas ----
  function montarCacheTitulos(l) {
    if (!l) return null;
    const o = B.paraObjeto(mapas.marketing_budget_titulos, l);
    return { start: o.start || "", end: o.end || "", savedAt: Number(o.savedAt) || 0, bills: Array.isArray(o.bills) ? o.bills : [] };
  }
  function linhaVendasMarketing(dados, ccId, ym) {
    const l = aplicarPadroes("marketing_budget_vendas", B.paraLinha(mapas.marketing_budget_vendas, dados || {}, ccId + "_" + ym));
    l.cc_id = String(ccId);
    l.ym = ym;
    return l;
  }

  const ajudantes = {
    PADROES, OBRIGATORIAS, PEDACOS, aplicarPadroes, faltando, sem,
    partesContaCaixa, competenciaRydoo, idVendasMarketing, idPeriodoParticipacoes,
    desmontarConfigCaixa, montarConfigCaixa, linhaMovimentoCaixa, linhaBillCfin,
    itensValorReceber, desmontarValorReceber, montarValorReceber,
    linhaEventoAntecipacao, eventoAntecipacao, montarAntecipacaoMes,
    desmontarLote, montarLote, linhaDespesaParticipacao, despesaParticipacao, desmontarPeriodo, montarPeriodo,
    linhaOrcamentoDfc, montarOrcamentoDfc, itemRealizadoDfc, compactoRealizadoDfc, linhaRealizadoDfc, montarRealizadoDfc,
    abrirResultado, montarResultado, linhaCentroMutuo, montarExecucaoMutuo, montarCacheTitulos, linhaVendasMarketing,
  };
  Object.keys(ajudantes).forEach(function (k) {
    Object.defineProperty(mapas, k, { value: ajudantes[k], enumerable: false });
  });
  return mapas;
});
