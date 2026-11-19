/* Mapas campo do Integra -> coluna do Supabase, área engenharia / vistoria / comercial / orçamento de empreendimento
   (ver docs/mapa-tabelas/engenharia-comercial.md e supabase/migrations/202611191320_engenharia_comercial.sql).
   Usados pelo front (js/engenharia/dados-engenharia.js) e pelo importador da Fase 4
   (ferramentas/migracao/importar-engenharia.js). Formato e tipos em js/nucleo/dados-base.js.
   Nomes de campo = os que o app grava no Firestore. "ms" onde o app grava epoch (Date.now()); "iso" onde grava
   new Date().toISOString() ou Timestamp do Firestore (volta como texto ISO; o código de tela já aceita os dois).
   Ids que no Firestore eram número (ou misturados número/texto) usam "idTexto": gravam texto, voltam número se
   forem só dígitos. Onde a amostra só tinha texto, "texto".

   ARQUIVOS (Firebase Storage): as colunas foto_* / *_path / *_paths guardam o CAMINHO do objeto no bucket
   (ex.: "vistorias/<id>/frente_<ts>.jpeg"). O front continua lendo/gravando o campo com o nome antigo
   (fotoFrente, fileUrl, fileUrls, siengeSentUrls) e com URL: o tipo "storagePath"/"storagePaths" do dados-base
   converte URL -> caminho na gravação e caminho -> URL na leitura:
     https://firebasestorage.googleapis.com/v0/b/crm-gestao-mldu.firebasestorage.app/o/<encodeURIComponent(caminho)>?alt=media
   O token da URL original é descartado: a URL remontada só abre enquanto as regras do Firebase Storage permitirem
   leitura pública daquele caminho. Ao mudar os arquivos para o Supabase Storage, trocar só a montagem da URL
   (DadosBase.configurarStorage({ montarUrl })). URL que não é deste bucket não é convertida: fica em extra com o
   nome do campo (ex.: extra.fotoFrente) e volta igual na leitura — nada se perde.

   Tabelas com forma especial (não usar só o CRUD genérico; ver dados-engenharia.js):
   - estoque_comercial: uma linha por unidade (antes docs cc_<cc>_<n> com units[]). "date" é do doc, não da unidade.
   - estoque_comercial_controle: doc inteiro em "dados" (_meta, _batimento_state, _conferencia_geral).
   - engenharia_acompanhamento: uma linha por empreendimento (antes doc "obras" com linhas[] e savedAt).
   - caucao_base (+ _controle, _ajustes): base inteira numa linha; _meta achatado; _ajustes uma linha por parcela.
   - vistoria_batimento / comercial_batimento: caches do cron (uma linha por dia / mês).
   - orcamento_forecast: company_id sai do id "emp_<companyId>". */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.MapasEngenharia = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- Ajudantes comuns ao front e ao importador (não enumeráveis: Object.keys devolve só os mapas) ----

  // Colunas not null com default: null/ausente vira o default (lote homogêneo, sem violar not null).
  const PADROES = {
    vistorias: { contract_keys: [], is_test: false },
    vistoria_avisos: { respostas_formulario: {}, visto: false },
    vistoria_batimento: { clientes: [] },
    construction_checks: { contract_keys: [], file_paths: [], file_names: [], sienge_sent_paths: [] },
    engenharia_acompanhamento: { historico: [] },
    caucao_base: { rows: [] },
    caucao_base_controle: { running: false, done: false },
    estoque_comercial_controle: { dados: {} },
    comercial_batimento: { vendas: [], distratos: [], dados: {} },
    tabelas_vigentes: { rows: [] },
    orcamento_empreendimento: { distratos: {}, vendas_qtd: {}, planos: [], condicoes: {} },
    orcamento_receita: { grade: {}, por_ano: {}, sub_mes: {}, juros_mes: {}, indices: [], clientes: [] },
    orcamento_forecast: { versoes: {} },
    tag_solicitacoes: { status: "Pendente", parecidas: [], aviso_visto: false },
    solicitacoes_producao: { status: "pendente", telas: [], telas_nomes: [], abas: [], aviso_visto: false, prints: {},
      arquivos: [], commits: [], totais: {}, publicacoes_parciais: [] },
  };
  // Colunas not null sem default: linha sem valor não entra.
  const OBRIGATORIAS = {
    vistorias: ["status"], vistoria_avisos: ["email"], vistoria_batimento: ["date"],
    caucao_base: ["tipo"], caucao_base_ajustes: ["titulo", "parcela", "vencimento", "ajustado_em"],
    estoque_comercial: ["enterprise_id"], tabelas_vigentes: ["enterprise_id"], orcamento_forecast: ["company_id"],
    tag_solicitacoes: ["tag_name"],
  };

  function aplicarPadroes(tabela, linha) {
    const pad = PADROES[tabela] || {};
    Object.keys(pad).forEach((c) => { if (linha[c] === null || linha[c] === undefined) linha[c] = JSON.parse(JSON.stringify(pad[c])); });
    return linha;
  }
  function faltando(tabela, linha) {
    return (OBRIGATORIAS[tabela] || []).filter((c) => linha[c] === null || linha[c] === undefined || linha[c] === "");
  }

  // Campos de data da linha do tempo da obra: "" no app quando não preenchido (no banco, null).
  const DATAS_ACOMPANHAMENTO = ["infra", "lazer", "cliente", "tvoCliente", "lo", "tvoContrato"];

  // Id de doc do Firestore em caucao_base -> { id, tipo, chunk } da tabela nova (null para _meta/_ajustes/outros).
  function idCaucaoBase(docId) {
    const s = String(docId || "");
    let m;
    if (s === "_passado") return { id: "passado", tipo: "passado", chunk: null };
    if ((m = s.match(/^_passado_(\d+)$/))) return { id: "passado", tipo: "passado", chunk: Number(m[1]) };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})_(\d+)$/))) return { id: m[1], tipo: "dia", chunk: Number(m[2]) };
    return null;
  }

  // Chave do mapa _ajustes = "titulo|parcela" (rowKey da tela de caução).
  function partesAjuste(chave) {
    const s = String(chave || "");
    const i = s.indexOf("|");
    return i < 0 ? null : { titulo: s.slice(0, i), parcela: s.slice(i + 1) };
  }

  // "emp_13" -> "13"
  function companyIdForecast(id) {
    const m = String(id || "").match(/^emp_(.+)$/);
    return m ? m[1] : null;
  }

  // Docs de controle do estoque (estoque_comercial_controle.id).
  const CONTROLE_ESTOQUE = ["_meta", "_batimento_state", "_conferencia_geral"];

  const ts = (col) => [col, "iso"];

  const mapas = {
    // ================================ VISTORIA ================================
    // Pedidos de vistoria. app {responsavelEmail, responsavelNome, atribuidoEm, atribuidoPor} é achatado.
    // Campos de checkData gravados por construcao.js:1585 (date, responsible...) não têm coluna: vão para extra.
    vistorias: {
      tabela: "vistorias",
      campos: {
        status: "status", customerId: ["customer_id", "idTexto"], contractId: ["contract_id", "idTexto"],
        contractKeys: ["contract_keys", "textos"], titulo: ["titulo", "idTexto"], tituloKey: ["titulo_key", "idTexto"],
        clienteName: "cliente_name", cidade: "cidade", empreendimento: "empreendimento",
        costCenterId: ["cost_center_id", "texto"], unidade: "unidade", companyId: ["company_id", "texto"],
        loteCoords: ["lote_coords", "json"],
        fotoFrente: ["foto_frente", "storagePath"], fotoMeioFundo: ["foto_meio_fundo", "storagePath"],
        fotoFundoFrente: ["foto_fundo_frente", "storagePath"],
        respostasFormulario: ["respostas_formulario", "json"], enviadoEm: ts("enviado_em"),
        linkEnviadoEm: ts("link_enviado_em"), closedBy: "closed_by", closedAt: ts("closed_at"),
        requestedBy: "requested_by", requestedByEmail: "requested_by_email",
        requestedByBackOffice: ["requested_by_back_office", "bool"], requestedAt: ts("requested_at"), origem: "origem",
        "app.responsavelEmail": "app_responsavel_email", "app.responsavelNome": "app_responsavel_nome",
        "app.atribuidoEm": ts("app_atribuido_em"), "app.atribuidoPor": "app_atribuido_por",
        isTest: ["is_test", "bool"], createdAt: ts("criado_em"), updatedAt: ts("atualizado_em"),
      },
    },
    // Aviso ao solicitante quando a vistoria é validada (coleção vazia hoje).
    vistoria_avisos: {
      tabela: "vistoria_avisos",
      campos: {
        vistoriaId: ["vistoria_id", "texto"], email: "email", nome: "nome", clienteName: "cliente_name",
        unidade: "unidade", empreendimento: "empreendimento", cidade: "cidade", titulo: ["titulo", "idTexto"],
        respostasFormulario: ["respostas_formulario", "json"],
        fotoFrente: ["foto_frente", "storagePath"], fotoMeioFundo: ["foto_meio_fundo", "storagePath"],
        fotoFundoFrente: ["foto_fundo_frente", "storagePath"],
        visto: ["visto", "bool"], vistoEm: ts("visto_em"), createdAt: ts("criado_em"),
      },
    },
    // Fila de clientes da tela Vistoria (cache do cron; id = date = 'AAAA-MM-DD'). Shards _p<i> e _meta somem.
    vistoria_batimento: {
      tabela: "vistoria_batimento",
      campos: { date: ["date", "data"], clientes: ["clientes", "json"], total: ["total", "int"] },
    },
    // Registros de construção do lote (aba Construção / validação da vistoria).
    construction_checks: {
      tabela: "construction_checks",
      campos: {
        customerId: ["customer_id", "texto"], contractId: ["contract_id", "texto"], contractKeys: ["contract_keys", "textos"],
        tituloKey: ["titulo_key", "texto"], companyId: ["company_id", "texto"], costCenterId: ["cost_center_id", "texto"],
        cidade: "cidade", empreendimento: "empreendimento", unidade: "unidade", vistoriaId: ["vistoria_id", "texto"],
        date: ["date", "data"], responsible: "responsible", stage: "stage", observations: "observations",
        detailsText: "details_text", fileUrl: ["file_path", "storagePath"], fileName: "file_name",
        fileUrls: ["file_paths", "storagePaths"], fileNames: ["file_names", "textos"],
        fotoFrente: ["foto_frente", "storagePath"], fotoMeioFundo: ["foto_meio_fundo", "storagePath"],
        fotoFundoFrente: ["foto_fundo_frente", "storagePath"],
        sendToSienge: ["send_to_sienge", "bool"], siengeSent: ["sienge_sent", "bool"],
        siengeSentUrls: ["sienge_sent_paths", "storagePaths"], siengeError: "sienge_error",
        createdAt: ts("criado_em"), updatedAt: ts("atualizado_em"),
      },
    },

    // ================================ ENGENHARIA ================================
    // Uma linha por empreendimento (linhas[] do doc "obras"; id = centro de custo). savedAt do doc = max(atualizado_em).
    engenharia_acompanhamento: {
      tabela: "engenharia_acompanhamento",
      campos: {
        nome: "nome", infra: ["infra", "data"], lazer: ["lazer", "data"], cliente: ["cliente", "data"],
        tvoCliente: ["tvo_cliente", "data"], lo: ["lo", "data"], tvoContrato: ["tvo_contrato", "data"],
        inseridoEm: ["inserido_em", "ms"], historico: ["historico", "json"],
      },
    },
    // Base da caução: id = data ('dia') ou 'passado'. rows = concatenação dos chunks; "tipo" é preenchido por quem monta.
    caucao_base: {
      tabela: "caucao_base",
      campos: {
        date: ["date", "data"], startDate: ["start_date", "data"], endDate: ["end_date", "data"], corte: ["corte", "data"],
        count: ["count", "int"], geradoEm: ts("gerado_em"), rows: ["rows", "json"],
      },
    },
    // caucao_base/_meta (linha única '_meta'). range {startDate, endDate} é achatado; prazo, planejadas... ficam em extra.
    caucao_base_controle: {
      tabela: "caucao_base_controle",
      campos: {
        date: ["date", "data"], count: ["count", "int"], running: ["running", "bool"], runningAt: ts("running_at"),
        done: ["done", "bool"], geradoEm: ts("gerado_em"), "range.startDate": ["range_start_date", "data"],
        "range.endDate": ["range_end_date", "data"], erro: "erro", erroEm: ts("erro_em"),
      },
    },
    // caucao_base/_ajustes: uma linha por chave 'titulo|parcela' ({vencimento, at} no app).
    caucao_base_ajustes: {
      tabela: "caucao_base_ajustes",
      campos: {
        titulo: ["titulo", "texto"], parcela: ["parcela", "texto"], vencimento: ["vencimento", "data"], at: ts("ajustado_em"),
      },
    },

    // ================================ COMERCIAL ================================
    // Uma linha por unidade (units[] dos docs cc_<cc>_<n>). Mesmas colunas da RPC substituir_estoque_comercial_cc.
    // "date" (do doc) e atualizado_em (updatedAt do doc) são preenchidos por quem monta / pela RPC.
    estoque_comercial: {
      tabela: "estoque_comercial", chaveNumerica: true,
      campos: {
        enterpriseId: ["enterprise_id", "texto"], enterpriseName: "enterprise_name", name: "name",
        commercialStock: "commercial_stock", legalStock: "legal_stock", buildingStock: "building_stock",
        area: ["area", "num"], contractId: ["contract_id", "idTexto"], contractNumber: ["contract_number", "texto"],
        contractValue: ["contract_value", "num"], situation: "situation", customerId: ["customer_id", "idTexto"],
        customerName: "customer_name", customerDoc: ["customer_doc", "texto"],
        receivableBillId: ["receivable_bill_id", "idTexto"], relFin: "rel_fin", quitado: ["quitado", "bool"],
        quitadoEvidencia: ["quitado_evidencia", "bool"], quitacaoDate: ["quitacao_date", "data"],
        quitacaoValor: ["quitacao_valor", "num"], quitacaoRecebido: ["quitacao_recebido", "num"],
        quitacaoFonte: "quitacao_fonte", receivedLocked: ["received_locked", "bool"],
        statementDone: ["statement_done", "bool"], censusAt: ["census_at", "data"], finAt: ts("fin_at"),
        filaAt: ts("fila_at"), extratoAt: ts("extrato_at"), siengeConferidoEm: ts("sienge_conferido_em"),
        kpiAVencer: ["kpi_a_vencer", "num"], kpiVencidas: ["kpi_vencidas", "num"], kpiLiquido: ["kpi_liquido", "num"],
        kpiPago: ["kpi_pago", "num"], kpiAcrescimo: ["kpi_acrescimo", "num"], kpiDesconto: ["kpi_desconto", "num"],
        presentDebitBalance: ["present_debit_balance", "num"], receivedAmount: ["received_amount", "num"],
        outstandingBalance: ["outstanding_balance", "num"], pmp3m: ["pmp3m", "num"],
        openParcelas: ["open_parcelas", "json"], carteiraCt: ["carteira_ct", "bool"],
        distratoData: ["distrato_data", "data"], distratoTitulo: ["distrato_titulo", "texto"],
      },
    },
    // _meta, _batimento_state, _conferencia_geral: o doc inteiro fica em "dados" (objeto { dados } no CRUD genérico).
    estoque_comercial_controle: {
      tabela: "estoque_comercial_controle", semExtra: true,
      campos: { dados: ["dados", "json"] },
    },
    // Vendas/distratos por mês (cache do cron). year/month do app -> ano/mes; vendas/distratos já como lista
    // (no Firestore eram texto JSON). Linhas _meta/_state guardam o doc em "dados".
    comercial_batimento: {
      tabela: "comercial_batimento",
      campos: {
        year: ["ano", "int"], month: ["mes", "int"], vendas: ["vendas", "json"], distratos: ["distratos", "json"],
        dados: ["dados", "json"],
      },
    },
    tabelas_vigentes: {
      tabela: "tabelas_vigentes",
      campos: {
        enterpriseId: ["enterprise_id", "texto"], enterpriseName: "enterprise_name", city: "city",
        cityId: ["city_id", "texto"], competencia: "competencia", rows: ["rows", "json"],
        createdAt: ts("criado_em"), updatedAt: ts("atualizado_em"),
      },
    },

    // ================================ ORÇAMENTO ================================
    orcamento_empreendimento: {
      tabela: "orcamento_empreendimento",
      campos: {
        ccId: ["cc_id", "texto"], companyId: ["company_id", "texto"], anoDe: ["ano_de", "int"], anoAte: ["ano_ate", "int"],
        distratos: ["distratos", "json"], vendasQtd: ["vendas_qtd", "json"], planos: ["planos", "json"],
        condicoes: ["condicoes", "json"], em: ts("em"),
      },
    },
    orcamento_receita: {
      tabela: "orcamento_receita",
      campos: {
        ccId: ["cc_id", "texto"], companyId: ["company_id", "texto"], anoDe: ["ano_de", "int"], anoAte: ["ano_ate", "int"],
        grade: ["grade", "json"], porAno: ["por_ano", "json"], subMes: ["sub_mes", "json"], jurosMes: ["juros_mes", "json"],
        total: ["total", "num"], principal: ["principal", "num"], reajuste: ["reajuste", "num"], fora: ["fora", "num"],
        antes: ["antes", "num"], subJudice: ["sub_judice", "int"], subJudiceValor: ["sub_judice_valor", "num"],
        parcelaMedia: ["parcela_media", "num"], parcelasMedia: ["parcelas_media", "num"], indices: ["indices", "json"],
        clientes: ["clientes", "json"], em: ts("em"),
      },
    },
    // id 'emp_<companyId>'; company_id é preenchido a partir do id (companyIdForecast), não é campo do doc.
    orcamento_forecast: {
      tabela: "orcamento_forecast",
      campos: { atual: ["atual", "int"], versoes: ["versoes", "json"], savedAt: ["saved_at", "ms"] },
    },

    // ================================ SOLICITAÇÕES ================================
    // Campos já em snake_case no app (mapeamento 1:1).
    tag_solicitacoes: {
      tabela: "tag_solicitacoes",
      campos: {
        tag_name: "tag_name", reason: "reason", type: "type", status: "status",
        solicitado_por_email: "solicitado_por_email", solicitado_por_nome: "solicitado_por_nome",
        parecidas: ["parecidas", "json"], motivo_decisao: "motivo_decisao", decidido_por_email: "decidido_por_email",
        decidido_por_nome: "decidido_por_nome", decidido_em: ts("decidido_em"), tag_criada: "tag_criada",
        destino_final: "destino_final", aviso_visto: ["aviso_visto", "bool"], criado_em: ts("criado_em"),
      },
    },
    // solicitante {email, nome} é achatado. Datas em epoch ms no app.
    solicitacoes_producao: {
      tabela: "solicitacoes_producao",
      campos: {
        ambiente: "ambiente", ambienteNome: "ambiente_nome", branch: "branch", sha: "sha", shaMain: "sha_main",
        versaoBase: ["versao_base", "int"], descricao: "descricao", comoTestar: "como_testar",
        telas: ["telas", "textos"], telasNomes: ["telas_nomes", "textos"], abas: ["abas", "json"],
        "solicitante.email": "solicitante_email", "solicitante.nome": "solicitante_nome", status: "status",
        avisoVisto: ["aviso_visto", "bool"], avisoVistoEm: ["aviso_visto_em", "ms"],
        semAlteracoesCodigo: ["sem_alteracoes_codigo", "bool"], prints: ["prints", "json"],
        arquivos: ["arquivos", "json"], commits: ["commits", "json"], totais: ["totais", "json"], motivo: "motivo",
        decididoPor: "decidido_por", decididoPorEmail: "decidido_por_email", decididoEm: ["decidido_em", "ms"],
        versao: ["versao", "texto"], publicadoEm: ["publicado_em", "ms"], testes: ["testes", "json"],
        publicacoesParciais: ["publicacoes_parciais", "json"], criadoEm: ["criado_em", "ms"],
      },
    },
  };

  const ajudantes = {
    PADROES, OBRIGATORIAS, aplicarPadroes, faltando, DATAS_ACOMPANHAMENTO, idCaucaoBase, partesAjuste,
    companyIdForecast, CONTROLE_ESTOQUE,
  };
  Object.keys(ajudantes).forEach(function (k) {
    Object.defineProperty(mapas, k, { value: ajudantes[k], enumerable: false });
  });
  return mapas;
});
