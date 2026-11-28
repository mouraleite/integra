/* Mapas campo do Integra -> coluna do Supabase, área núcleo (ver docs/mapa-tabelas/nucleo.md).
   Usados pelo front (js/nucleo/dados-nucleo.js) e pelo importador da Fase 4 (Node). Formato em js/nucleo/dados-base.js. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.MapasNucleo = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    usuarios: {
      tabela: "usuarios", chave: "id_legado", chaveNumerica: true,
      campos: {
        name: "nome", email: "email", login_email: "login_email", sienge_user: "sienge_user", phone: "telefone",
        profile_name: "perfil", status: "status", manager_email: "gestor_email",
      },
    },
    perfis: {
      tabela: "perfis", chave: "id_legado", semExtra: true,
      campos: { name: "nome", perms: "permissoes" },
    },
    centros_custo: {
      tabela: "centros_custo",
      campos: {
        tipo_cc: "tipo_cc", perc_ml: ["perc_ml", "num"], perc_terrenista: ["perc_terrenista", "num"],
        imposto_pago_empresa: ["imposto_pago_empresa", "bool"], valor_vgv: ["valor_vgv", "num"],
        clausula_suspensiva_ativa: ["clausula_suspensiva_ativa", "bool"],
        clausula_suspensiva_dias: ["clausula_suspensiva_dias", "int"],
        incorporacao_lotes_proprios: ["incorporacao_lotes_proprios", "bool"],
        incorporacao_lotes_tipo: "incorporacao_lotes_tipo", incorporacao_lotes_excecao: "incorporacao_lotes_excecao",
        registro_imovel: "registro_imovel", indexador_padrao: "indexador_padrao", associacao_nome: "associacao_nome",
        conta_parceria: "conta_parceria", conta_parceria_at: ["conta_parceria_at", "ms"], updatedAt: ["updated_at", "ms"],
      },
    },
    empresas: {
      tabela: "empresas",
      campos: {
        company_id: ["company_id", "int"], nome_usual: "nome_usual",
        percentual_mldu: ["percentual_mldu", "num"], percentual_mldu_edited: ["percentual_mldu_edited", "bool01"],
        percentual_liquido_mldu: ["percentual_liquido_mldu", "num"],
        percentual_liquido_mldu_edited: ["percentual_liquido_mldu_edited", "bool01"],
        consolidacao_padrao: ["consolidacao_padrao", "bool01"], gerida_pelo_grupo: ["gerida_pelo_grupo", "bool01"],
        cobranca_interna: ["cobranca_interna", "bool01"], nova_empresa: ["nova_empresa", "bool01"],
        gestao_elenco: ["gestao_elenco", "bool01"], spe_socios: ["spe_socios", "bool01"],
        holding_interna: ["holding_interna", "bool01"], updatedAt: ["updated_at", "ms"],
      },
    },
    condicoes_pagamento: {
      tabela: "condicoes_pagamento",
      campos: {
        boletoSienge: ["boleto_sienge", "bool"], parcelaWebro: ["parcela_webro", "bool"],
        repasseAdvogado: ["repasse_advogado", "bool"], updatedAt: ["updated_at", "ms"],
      },
    },
    motivos_cancelamento: {
      tabela: "motivos_cancelamento", chave: "id",
      campos: { codigo: "id", nome: "nome", ordem: ["ordem", "int"] },
    },
    preambulos: {
      tabela: "preambulos", chaveNumerica: true,
      campos: {
        text: "texto", responsibles: "responsaveis", status: "status", empresaId: ["empresa_id", "texto"],
        centrosCustoIds: ["centros_custo_ids", "ids"], deleted: ["excluido", "bool"], updatedAt: ["updated_at", "ms"],
      },
    },
    cartorios: {
      tabela: "cartorios",
      campos: { nome: "nome", deleted: ["excluido", "bool"], updatedAt: ["updated_at", "ms"], ordem: ["ordem", "int"] },
    },
    central_email_templates: {
      tabela: "central_email_templates",
      campos: {
        nome: "nome", assunto: "assunto", corpo: "corpo", tag: ["tag", "num"], diasVencido: ["dias_vencido", "int"],
        destino: "destino", para: "para", cc: "cc", status: "status", ativo: ["ativo", "bool"],
        criadoPorEmail: "criado_por_email", criadoPorNome: "criado_por_nome", aprovadoEm: ["aprovado_em", "ms"],
        avisoCriador: ["aviso_criador", "bool"],
      },
    },
    central_email_envios: {
      tabela: "central_email_envios",
      campos: {
        dia: ["dia", "data"], templateId: "template_id", customerId: ["customer_id", "texto"], titulo: ["titulo", "texto"],
        status: "status", em: ["em", "ms"], para: "para", cc: "cc", extrato: ["extrato", "bool"], erro: "erro",
      },
    },
    // Cliente/título que recebeu o e-mail da régua "Reenviar jurídico" (id "<customerId>_<titulo>").
    acordo_email_tag: {
      tabela: "acordo_email_tag",
      campos: { customerId: ["customer_id", "texto"], titulo: ["titulo", "texto"], tag: "tag", em: ["em", "ms"] },
    },
    // Follow-up do gestor (js/cobranca/followup-gestor.js). "criadoEm" vai para pedido_em; resumo e nota ficam em extra.
    followup_gestor: {
      tabela: "followup_gestor",
      campos: {
        customerId: ["customer_id", "texto"], saleId: ["sale_id", "texto"], titulo: ["titulo", "texto"],
        cliente: "cliente", unidade: "unidade", empreendimento: "empreendimento", operador: "operador",
        pedidoPor: "pedido_por", pedidoPorEmail: "pedido_por_email", mensagem: "mensagem", status: "status",
        criadoEm: ["pedido_em", "iso"], vistoEm: ["visto_em", "iso"], resposta: "resposta",
        respondidoEm: ["respondido_em", "iso"], respondidoPor: "respondido_por", notaId: ["nota_id", "texto"],
      },
    },
    obra_vgv: {
      tabela: "obra_vgv",
      campos: { nome: "nome", vgv: ["vgv", "num"], lancamento: ["lancamento", "data"], at: ["at", "ms"] },
    },
    parcerias: {
      tabela: "parcerias",
      campos: {
        companyId: ["company_id", "texto"], companyName: "company_name", partnerName: "partner_name", kind: "kind",
        obraCode: ["obra_code", "texto"], defaultPartnerShare: ["default_partner_share", "num"],
        contaTerrenista: "conta_terrenista", contaDistribuicao: "conta_distribuicao", sociosSeed: "socios_seed",
        creditor: "creditor", obras: "obras", costCenters: "cost_centers", socios: "socios",
        ordem: ["ordem", "int"], createdAt: ["created_at", "iso"],
      },
    },
    fluxos_processo: {
      tabela: "fluxos_processo",
      campos: {
        nome: "nome", nomeEm: ["nome_em", "ms"], oficial: ["oficial", "bool"],
        responsavelNome: "responsavel_nome", responsavelEmail: "responsavel_email",
        responsavelSienge: "responsavel_sienge", supervisorNome: "supervisor_nome", supervisorEmail: "supervisor_email",
        etapas: "etapas", createdAt: ["created_at", "ms"], updatedAt: ["updated_at", "ms"],
      },
    },
    tags: {
      tabela: "tags",
      campos: {
        name: "name", destino: "destino", status: "status", created_by: "created_by",
        is_default: ["is_default", "bool01"], solicitacao_id: ["solicitacao_id", "texto"],
      },
    },
    anexos_tag_memory: {
      tabela: "anexos_tag_memory",
      campos: {
        tag: "tag", originalName: "original_name", pending: ["pending", "bool"], phraseKey: "phrase_key",
        colors: ["colors", "ids"], phrases: ["phrases", "ids"], aspect: ["aspect", "num"],
        learnedAt: ["learned_at", "iso"], confirmed: ["confirmed", "bool"], rejected: ["rejected", "bool"],
        hits: ["hits", "int"], updatedAt: ["updated_at", "iso"],
      },
    },
    anexos_mapa: {
      tabela: "anexos_mapa",
      campos: {
        enterpriseId: ["enterprise_id", "texto"], chave: "chave", contractId: ["contract_id", "texto"],
        contractNumber: ["contract_number", "texto"], tag: "tag", destination: "destination", fileName: "file_name",
        description: "description", unitId: ["unit_id", "texto"], unitName: "unit_name", sentBy: "sent_by",
        sentAt: ["sent_at", "iso"], source: "source", copiaIntegra: ["copia_integra", "texto"], storagePath: "storage_path",
      },
    },
    auditoria_logs: {
      tabela: "auditoria_logs",
      campos: {
        timestamp: ["timestamp", "iso"], user: "user_name", userEmail: "user_email", action: "action", module: "module",
        status: "status", summary: "summary", customerId: ["customer_id", "texto"], customerLabel: "customer_label",
        enterpriseId: ["enterprise_id", "texto"], enterpriseName: "enterprise_name", unitId: ["unit_id", "texto"],
        unitName: "unit_name", titleId: ["title_id", "texto"], endpoint: "endpoint", method: "method", details: "details",
      },
    },
    auditoria_login_relatorios: {
      tabela: "auditoria_login_relatorios",
      campos: {
        arquivo: "arquivo", periodoDe: ["periodo_de", "data"], periodoAte: ["periodo_ate", "data"],
        total: ["total", "int"], usuarios: ["usuarios", "int"], bloqueios: ["bloqueios", "int"],
        partes: ["partes", "int"], enviadoPor: "enviado_por", enviadoPorEmail: "enviado_por_email",
        enviadoEm: ["enviado_em", "iso"],
      },
    },
    usuarios_online: {
      tabela: "usuarios_online",
      campos: {
        email: "email", name: "name", contaEmail: "conta_email", contaName: "conta_name", profile: "profile",
        online: ["online", "bool"], since: ["since", "ms"], lastSeen: ["last_seen", "ms"],
        lastSeenAt: ["last_seen_at", "ms"], lastUse: ["last_use", "ms"], logoutAt: ["logout_at", "ms"],
        tab: "tab", tabLabel: "tab_label", agent: "agent", sessoes: "sessoes",
      },
    },
    api_consumo: {
      tabela: "api_consumo",
      campos: {
        date: ["date", "data"], rest: ["rest", "int"], bulk: ["bulk", "int"], actors: "actors", apis: "apis",
        users: "users", updatedAt: ["updated_at", "ms"],
      },
    },
    suporte_chamados: {
      tabela: "suporte_chamados",
      campos: {
        tipo: "tipo", status: "status", modulo: "modulo", subitem: "subitem", subitemLabel: "subitem_label",
        aba: "aba", abaLabel: "aba_label", localPath: "local_path", descricao: "descricao", imagens: "imagens",
        mensagens: "mensagens", userId: ["user_id", "texto"], userName: "user_name", userEmail: "user_email",
        createdByAdmin: ["created_by_admin", "bool"], arquivadoAt: ["arquivado_at", "iso"], arquivadoPor: "arquivado_por",
        responsavelEmail: "responsavel_email", responsavelNome: "responsavel_nome",
        responsavelEm: ["responsavel_em", "iso"], createdAt: ["created_at", "iso"], updatedAt: ["updated_at", "iso"],
      },
    },
    documentos_autenticados: {
      tabela: "documentos_autenticados",
      campos: {
        codigo: "codigo", tipo: "tipo", tipoNome: "tipo_nome", hash: "hash", titulo: ["titulo", "texto"],
        unidade: "unidade", cliente: "cliente", arquivo: "arquivo", em: ["em", "iso"], reparcelamento: "reparcelamento",
        reparcelamentoEnviado: ["reparcelamento_enviado", "bool"],
        reparcelamentoEnviadoEm: ["reparcelamento_enviado_em", "iso"], substituido: ["substituido", "bool"],
      },
    },
    agenda_personal_notes: {
      tabela: "agenda_personal_notes",
      campos: { dono: "dono", data: ["data", "data"], usuario_id: "usuario_id", notes: "notes" },
    },
    agenda_recurring_notes: {
      tabela: "agenda_recurring_notes",
      campos: { dono: "dono", data: ["data", "data"], usuario_id: "usuario_id", notes: "notes" },
    },
    kmz_coordinates: {
      tabela: "kmz_coordinates",
      campos: {
        empreendimento_id: ["empreendimento_id", "texto"], placemarks: "placemarks", quadras: "quadras",
        count: ["count", "int"], quadraCount: ["quadra_count", "int"], updatedAt: ["updated_at", "iso"],
      },
    },
    // Só servidor (api/_lib/sync-creditors.js).
    sienge_sync_state: {
      tabela: "sienge_sync_state",
      campos: {
        lock: ["lock", "texto"], running: ["running", "bool"], phase: "phase", date: ["date", "data"],
        offset: ["posicao", "int"], total: ["total", "int"], gravados: ["gravados", "int"], removidos: ["removidos", "int"],
        done: ["done", "bool"], erro: "erro", finishedAt: ["finished_at", "iso"], updatedAt: ["updated_at", "iso"],
      },
    },
  };
});
