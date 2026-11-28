/* Mapas campo do Integra -> coluna do Supabase, área cobrança / clientes / relacionamento / jurídico
   (ver docs/mapa-tabelas/cobranca-juridico.md e supabase/migrations/202611191310_cobranca_juridico.sql).
   Usados pelo front (js/cobranca/dados-cobranca.js) e pelo importador da Fase 4 (ferramentas/migracao/importar-cobranca.js).
   Formato e tipos em js/nucleo/dados-base.js. Nomes de campo = os que o app grava no Firestore; "ms" onde o app grava
   epoch (Date.now()), "iso" onde grava new Date().toISOString().

   Tabelas com forma especial (não usar só o CRUD genérico; ver dados-cobranca.js):
   - customer_notes / jud_notes: uma linha por nota; customer_id vem do parâmetro da RPC (a nota não traz o cliente).
   - nex_letters: uma linha por carta; a chave do front é o id da carta (item_id), que se repete entre docs
     "<cliente>_<título>"; doc_id e sale_id são do doc de origem e são preenchidos pela camada de dados.
   - sienge_defaulters_history: tipo e indice saem do id do doc (dados-cobranca.js / importador).
   - registro_cadastro_linhas: registro_id e ordem são preenchidos por quem monta as linhas. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.MapasCobranca = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- Ajudantes comuns ao front e ao importador (não enumeráveis: Object.keys devolve só os mapas) ----

  // Mesma regra do window.occurrenceIdentity (app.js): id, senão data|autor|canal/fase|promessa/prazo|texto[0..80].
  function identidadeNota(n) {
    if (!n) return "";
    if (n.id) return String(n.id);
    return [n.date, n.author, n.canal || n.fase || "", n.promiseDate || n.prazo || "", String(n.text || "").slice(0, 80)].join("|");
  }

  // Mesma regra do window.occurrenceStamp: promiseStatusAt || updatedAt || lastEdit.date (ms; 0 se não houver).
  function carimboNota(n) {
    if (!n) return 0;
    const t = Date.parse(n.promiseStatusAt || n.updatedAt || (n.lastEdit && n.lastEdit.date) || "");
    return isFinite(t) ? t : 0;
  }

  // Mesma regra do window.mergeOccurrenceLists, para várias listas: mesma identidade fica a de carimbo maior
  // (mesclando campos); empate fica a primeira. Identidade vazia ("||||") é descartada.
  function mesclarNotas() {
    const mapa = new Map();
    Array.prototype.slice.call(arguments).forEach(function (lista) {
      (Array.isArray(lista) ? lista : []).forEach(function (n) {
        if (!n) return;
        const k = identidadeNota(n);
        if (!k || k === "||||") return;
        const antes = mapa.get(k);
        if (!antes) { mapa.set(k, n); return; }
        const a = carimboNota(antes), b = carimboNota(n);
        if (b > a) mapa.set(k, Object.assign({}, antes, n));
        else if (a > b) mapa.set(k, Object.assign({}, n, antes));
      });
    });
    return Array.from(mapa.values());
  }

  // Id do doc de sienge_defaulters_history -> { tipo, date, indice } (colunas derivadas do id).
  function tipoCacheDia(id, dados) {
    const s = String(id || "");
    let m;
    const d = dados && typeof dados.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dados.date) ? dados.date : null;
    if (s.charAt(0) === "_") return { tipo: "estado", date: d, indice: null };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})$/))) return { tipo: "ficha", date: m[1], indice: null };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})_chunk_(\d+)$/))) return { tipo: "bloco", date: m[1], indice: Number(m[2]) };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})_pronta$/))) return { tipo: "pronta", date: m[1], indice: null };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})_pronta_(\d+)$/))) return { tipo: "pronta_bloco", date: m[1], indice: Number(m[2]) };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})_warmup_.+_(\d+)$/))) return { tipo: "warmup", date: m[1], indice: Number(m[2]) };
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})_income_(\d+)$/))) return { tipo: "income", date: m[1], indice: Number(m[2]) };
    return null; // id fora do padrão: quem chama decide (o importador registra aviso)
  }

  // Campos que no Firestore eram texto JSON e no banco são jsonb.
  const JSON_TEXTO = {
    sienge_defaulters_history: ["data", "paidMap", "paidInstallmentIds"],
    inadimplencia_snapshots: ["data_json"],
  };

  const mapas = {
    // Espelho do cadastro de clientes do Sienge. O id do doc é o id numérico do cliente.
    sienge_customers: {
      tabela: "sienge_customers", chaveNumerica: true,
      campos: {
        name: "name", personType: "person_type", clientType: "client_type", foreigner: "foreigner",
        cpf: "cpf", cnpj: "cnpj", internationalId: "international_id", email: "email",
        numberIdentityCard: "number_identity_card", issuingBody: "issuing_body",
        issueDateIdentityCard: ["issue_date_identity_card", "data"], birthDate: ["birth_date", "data"],
        birthPlace: "birth_place", nationality: "nationality", sex: "sex", civilStatus: "civil_status",
        matrimonialRegime: "matrimonial_regime", marriageDate: ["marriage_date", "data"], motherName: "mother_name",
        fatherName: "father_name", profession: "profession", mailingAddress: "mailing_address", socialName: "social_name",
        licenseNumber: "license_number", licenseIssuingBody: "license_issuing_body",
        licenseIssueDate: ["license_issue_date", "data"],
        phones: ["phones", "json"], addresses: ["addresses", "json"], contacts: ["contacts", "json"],
        procurators: ["procurators", "json"], subTypes: ["sub_types", "json"], familyIncome: ["family_income", "json"],
        spouse: ["spouse", "json"],
        createdAt: ["created_at", "data"], modifiedAt: ["modified_at", "data"],
        modifiedAtDateTime: ["modified_at_date_time", "horaSP"],
        is_subjudice: ["is_subjudice", "bool"], subjudice_entry_date: ["subjudice_entry_date", "iso"],
        subjudice_exit_date: ["subjudice_exit_date", "iso"],
      },
    },
    // Cache diário da carteira (ficha, blocos, fila pronta, warmup, income e estados do cron).
    // data / paidMap / paidInstallmentIds eram texto JSON: a camada de dados e o importador fazem JSON.parse antes.
    // batchIndex (warmup) e idx (income) ficam em extra; a coluna indice é derivada do id.
    sienge_defaulters_history: {
      tabela: "sienge_defaulters_history",
      campos: {
        date: ["date", "data"], chunks: ["chunks", "int"], count: ["count", "int"], rev: ["rev", "int"],
        cacheRev: ["cache_rev", "int"], timestampStr: ["timestamp_str", "texto"], atFull: ["at_full", "texto"],
        data: ["data", "json"], paidMap: ["paid_map", "json"], paidInstallmentIds: ["paid_installment_ids", "json"],
        companyIds: ["company_ids", "json"], companyId: ["company_id", "texto"], warmupDone: ["warmup_done", "bool"],
        batimentoPedidoEm: ["batimento_pedido_em", "iso"], createdAt: ["created_at", "iso"],
      },
    },
    inadimplencia_snapshots: {
      tabela: "inadimplencia_snapshots",
      campos: {
        date: ["date", "data"], total_value: ["total_value", "num"], total_count: ["total_count", "int"],
        total_customers: ["total_customers", "int"], avg_ticket: ["avg_ticket", "num"],
        subjudice_value: ["subjudice_value", "num"], subjudice_count: ["subjudice_count", "int"],
        subjudice_customers: ["subjudice_customers", "int"], subjudice_detail: ["subjudice_detail", "json"],
        recovered_count: ["recovered_count", "int"], new_count: ["new_count", "int"],
        is_week_start: ["is_week_start", "bool"], is_week_end: ["is_week_end", "bool"],
        is_month_close: ["is_month_close", "bool"], data_json: ["data_json", "json"],
        source_count: ["source_count", "int"], saved_at: ["saved_at", "iso"],
        sprint_clients: ["sprint_clients", "int"], sprint_titles: ["sprint_titles", "int"],
        sprint_value: ["sprint_value", "num"], sprint_avg_delay: ["sprint_avg_delay", "int"],
        sprint_saved_at: ["sprint_saved_at", "iso"], sprint_origem: "sprint_origem",
      },
    },
    // Ocorrências de cobrança (uma linha por nota). customer_id: parâmetro da RPC salvar_notas_cliente.
    customer_notes: {
      tabela: "customer_notes",
      campos: {
        date: ["date", "iso"], author: "author", text: "text", canal: "canal", iniciativa: "iniciativa",
        reminder: "reminder", status: "status", promiseStatus: "promise_status", promiseDate: ["promise_date", "data"],
        promiseStatusAt: ["promise_status_at", "iso"], promisedInstallments: ["promised_installments", "textos"],
        saleId: ["sale_id", "texto"], unitId: ["unit_id", "texto"], contractId: ["contract_id", "idTexto"],
        receivableBillId: ["receivable_bill_id", "idTexto"], pinned: ["pinned", "bool"],
        webroBaixa: ["webro_baixa", "bool"], reuniaoSemanalTerceirizada: ["reuniao_semanal_terceirizada", "bool"],
        checkPayment: ["check_payment", "bool"], checkPaymentDate: ["check_payment_date", "data"],
        boletoDueDate: ["boleto_due_date", "data"], nexLocked: ["nex_locked", "bool"], nexId: ["nex_id", "texto"],
        colenciPix: ["colenci_pix", "bool"], colenciPrazo: ["colenci_prazo", "data"], customerName: "customer_name",
        unitLabel: "unit_label", valorAtualizado: ["valor_atualizado", "num"],
        descontoEncargosPct: ["desconto_encargos_pct", "num"], origem: "origem", attachments: ["attachments", "json"],
        pastTexts: ["past_texts", "textos"], lastEdit: ["last_edit", "json"], updatedAt: ["updated_at", "iso"],
      },
    },
    // Etapas judiciais (uma linha por nota). customer_id: parâmetro da RPC salvar_notas_juridicas.
    jud_notes: {
      tabela: "jud_notes",
      campos: {
        date: ["date", "iso"], author: "author", text: "text", type: "type", fase: "fase", faseId: ["fase_id", "texto"],
        prazo: ["prazo", "data"], pinned: ["pinned", "bool"], semAlteracao: ["sem_alteracao", "bool"],
        etapaInicio: ["etapa_inicio", "iso"], lastEdit: ["last_edit", "json"],
        agreementAttachment: ["agreement_attachment", "json"], replies: ["replies", "json"],
      },
    },
    processos_judiciais: {
      tabela: "processos_judiciais",
      campos: { customerId: ["customer_id", "texto"], numero: "numero", updatedAt: ["updated_at", "iso"] },
    },
    // Catálogo de motivos ({ id, nome } na tela); ordem = posição na lista (RPC salvar_processos_contra_motivos).
    processos_contra_motivos: {
      tabela: "processos_contra_motivos",
      campos: { nome: "nome", ordem: ["ordem", "int"] },
    },
    processos_contra: {
      tabela: "processos_contra",
      campos: {
        parteTipo: "parte_tipo", parteId: ["parte_id", "texto"], parteNome: "parte_nome", parteRotulo: "parte_rotulo",
        customerId: ["customer_id", "texto"], companyId: ["company_id", "texto"], companyName: "company_name",
        autorTipo: "autor_tipo", poloEmpresa: "polo_empresa", autorNome: "autor_nome", reuNome: "reu_nome",
        valorCausa: ["valor_causa", "num"], processo: "processo", motivo: "motivo", motivoId: ["motivo_id", "texto"],
        anexos: ["anexos", "json"], createdAt: ["created_at", "iso"], createdBy: "created_by",
      },
    },
    custas_judiciais: {
      tabela: "custas_judiciais",
      campos: {
        customerId: ["customer_id", "texto"], saleId: ["sale_id", "texto"], customerName: "customer_name",
        data: ["data", "data"], descricao: "descricao", tipos: ["tipos", "textos"], valor: ["valor", "num"],
        guias: ["guias", "json"], comprovantes: ["comprovantes", "json"], anexos: ["anexos", "json"],
        companyId: ["company_id", "texto"], companyName: "company_name", costCenterId: ["cost_center_id", "texto"],
        unitName: "unit_name", processo: "processo", billId: ["bill_id", "texto"],
        documentNumber: ["document_number", "texto"], notes: "notes", dueDate: ["due_date", "data"],
        liberatedAt: ["liberated_at", "iso"], liberatedBy: "liberated_by", reemPago: ["reem_pago", "bool"],
        reemConferidoEm: ["reem_conferido_em", "iso"], pagoEm: ["pago_em", "data"], createdAt: ["created_at", "iso"],
        createdBy: "created_by", updatedAt: ["updated_at", "iso"], updatedBy: "updated_by",
      },
    },
    boletos_honorarios: {
      tabela: "boletos_honorarios",
      campos: {
        key: "key", competencia: "competencia", generatedAt: ["generated_at", "iso"],
        generatedDate: ["generated_date", "data"], source: "source", author: "author", authorEmail: "author_email",
        authorProfile: "author_profile", terceirizado: ["terceirizado", "bool"], companyId: ["company_id", "texto"],
        companyName: "company_name", enterpriseId: ["enterprise_id", "texto"], enterpriseName: "enterprise_name",
        unitId: ["unit_id", "texto"], unitName: "unit_name", customerId: ["customer_id", "texto"],
        customerName: "customer_name", customerDoc: ["customer_doc", "texto"], billId: ["bill_id", "texto"],
        contractNumber: ["contract_number", "texto"], boletoDueDate: ["boleto_due_date", "data"],
        finePct: ["fine_pct", "num"], interestPct: ["interest_pct", "num"], honorariosPct: ["honorarios_pct", "num"],
        taxa: ["taxa", "num"], parcelas: ["parcelas", "json"], totais: ["totais", "json"],
      },
    },
    boletos_pagamentos: {
      tabela: "boletos_pagamentos",
      campos: {
        recId: ["rec_id", "texto"], competencia: "competencia", customerId: ["customer_id", "texto"],
        billId: ["bill_id", "texto"], allPaid: ["all_paid", "bool"], checkedAt: ["checked_at", "iso"],
        checkedDate: ["checked_date", "data"], parcelas: ["parcelas", "json"],
      },
    },
    // Campos já em snake_case no app; vencimento era "DD/MM/AAAA" e volta assim.
    boletos_baixa_banco: {
      tabela: "boletos_baixa_banco",
      campos: {
        titulo: ["titulo", "texto"], customerId: ["customer_id", "texto"], parcelas: ["parcelas", "textos"],
        parcelas_numero: ["parcelas_numero", "textos"], linha: "linha", nosso_numero: "nosso_numero",
        valor: ["valor", "num"], vencimento: ["vencimento", "dataBR"], conferido_por: "conferido_por",
        comprovante: "comprovante", comprovante_nome: "comprovante_nome", informado_por_email: "informado_por_email",
        informado_por_nome: "informado_por_nome", informado_em: ["informado_em", "iso"],
      },
    },
    // Uma carta NEX por linha; "id" da carta = item_id. doc_id / sale_id vêm do doc "<cliente>_<título>".
    nex_letters: {
      tabela: "nex_letters", chave: "item_id",
      campos: {
        customerId: ["customer_id", "texto"], titulo: ["titulo", "texto"], customerName: "customer_name",
        letterType: "letter_type", unitLabel: "unit_label", date: ["date", "data"], author: "author", status: "status",
        tracking: "tracking", zeroPaid: ["zero_paid", "bool"], lostPayIso: ["lost_pay_iso", "data"],
        deliveredAt: ["delivered_at", "data"], arDigital: ["ar_digital", "json"], html: "html",
        createdAt: ["created_at", "iso"],
      },
    },
    reneg_propostas: {
      tabela: "reneg_propostas",
      campos: {
        customerId: ["customer_id", "texto"], saleId: ["sale_id", "texto"], customerName: "customer_name",
        status: "status", cenario: "cenario", paymentMethod: "payment_method", sinalPct: ["sinal_pct", "num"],
        sinalValue: ["sinal_value", "num"], sinalDue: ["sinal_due", "data"], sinalPago: ["sinal_pago", "bool"],
        sinalPagoEm: ["sinal_pago_em", "iso"], expiraEm: ["expira_em", "data"], expiradaEm: ["expirada_em", "iso"],
        concluidaEm: ["concluida_em", "iso"], instQty: ["inst_qty", "int"], installmentValue: ["installment_value", "num"],
        firstDueDate: ["first_due_date", "data"], selectedBillIds: ["selected_bill_ids", "textos"],
        codigoAuth: ["codigo_auth", "texto"], reparcelamento: ["reparcelamento", "json"],
        createdAt: ["created_at", "iso"], createdBy: "created_by", createdByEmail: "created_by_email",
      },
    },
    // criadoEm / decididoEm: Date.now() no app. criadoEm vai para a coluna padrão criado_em.
    reneg_liberacao: {
      tabela: "reneg_liberacao",
      campos: {
        status: "status", criadoEm: ["criado_em", "ms"], customerId: ["customer_id", "texto"], cliente: "cliente",
        titulo: ["titulo", "texto"], unidade: "unidade", modalidade: "modalidade", modalidadeNome: "modalidade_nome",
        pmp: ["pmp", "int"], contratos: ["contratos", "json"], pago: ["pago", "num"], pctPago: ["pct_pago", "num"],
        saldoDevedor: ["saldo_devedor", "num"], construcao: "construcao", acordos: ["acordos", "int"],
        pagasQtd: ["pagas_qtd", "int"], pagasValor: ["pagas_valor", "num"], vencidasQtd: ["vencidas_qtd", "int"],
        vencidasValor: ["vencidas_valor", "num"], aVencerQtd: ["a_vencer_qtd", "int"],
        aVencerValor: ["a_vencer_valor", "num"], justificativa: "justificativa", operador: "operador",
        decididoEm: ["decidido_em", "ms"], decididoPor: "decidido_por",
      },
    },
    relacionamento_docs_assinatura: {
      tabela: "relacionamento_docs_assinatura",
      campos: {
        tipo: "tipo", tipoLabel: "tipo_label", status: "status", cliente: "cliente", titulo: ["titulo", "texto"],
        unidade: "unidade", arquivo: "arquivo", centroId: ["centro_id", "texto"], centroNome: "centro_nome",
        titularId: ["titular_id", "texto"], titularNome: "titular_nome", cedenteNome: "cedente_nome",
        cessionario: "cessionario", plano: "plano", pdfUrl: "pdf_url", userId: ["user_id", "texto"],
        userName: "user_name", userEmail: "user_email", createdAt: ["created_at", "iso"],
        lancadoEm: ["lancado_em", "iso"], lancadoPor: "lancado_por",
      },
    },
    // Ficha do arquivo da tela Registro (id "atual"); "partes" deixou de existir.
    registro_cadastro: {
      tabela: "registro_cadastro",
      campos: { arquivo: "arquivo", quando: ["quando", "iso"], por: "por", unidades: ["unidades", "int"] },
    },
    // Uma linha por unidade do arquivo (registro_id e ordem preenchidos por quem monta).
    registro_cadastro_linhas: {
      tabela: "registro_cadastro_linhas",
      campos: {
        empresaId: ["empresa_id", "texto"], empresa: "empresa", obraId: ["obra_id", "texto"], obra: "obra",
        unidade: ["unidade", "texto"], letra: "letra",
      },
    },
    webro_repasse_pendente: {
      tabela: "webro_repasse_pendente",
      campos: {
        titulo: ["titulo", "texto"], customerId: ["customer_id", "texto"], cliente: "cliente", unidade: "unidade",
        operador: "operador", baixa: ["baixa", "data"], vistoEm: ["visto_em", "data"],
      },
    },
    // Metadados dos anexos jurídicos por cliente (arquivo no Storage em storagePath).
    anexos_juridicos: {
      tabela: "anexos_juridicos",
      campos: {
        customerId: ["customer_id", "texto"], fileId: ["file_id", "texto"], originalName: "original_name", ext: "ext",
        size: ["size", "int"], tags: ["tags", "textos"], dateOverride: "date_override",
        targetCustomerId: ["target_customer_id", "texto"], targetCustomerIds: ["target_customer_ids", "textos"],
        storagePath: "storage_path", uploadedAt: ["uploaded_at", "iso"],
      },
    },
  };

  const ajudantes = { identidadeNota, carimboNota, mesclarNotas, tipoCacheDia, JSON_TEXTO };
  Object.keys(ajudantes).forEach(function (k) {
    Object.defineProperty(mapas, k, { value: ajudantes[k], enumerable: false });
  });
  return mapas;
});
