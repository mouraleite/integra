/* Central de e-mail: biblioteca de sugestões de texto, sem IA e sem custo.
   Cada sugestão é montada com partes por tom (abertura, pedido, fechamento, assinatura) e partes pela situação
   da tag (o racional da tag na Fila). As combinações passam de centenas por tag e tom; "Nova sugestão" nunca
   repete uma já mostrada na janela. Os textos usam só as variáveis do template; {R} vira a data de retorno. */
(function () {
  "use strict";

  const TONS = [
    { id: "cordial", nome: "Cordial" },
    { id: "direto", nome: "Direto" },
    { id: "empatico", nome: "Empático" },
    { id: "formal", nome: "Formal" },
    { id: "firme", nome: "Firme" }
  ];

  // Partes de cada tom. {R} = "até {{retorno:N}}" (ou "nos próximos dias" sem data de retorno).
  const TOM = {
    cordial: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}! Tudo bem?",
        "{{saudacao}}, {{primeiro_nome}}. Espero que esteja tudo bem por aí.",
        "Olá, {{primeiro_nome}}! {{saudacao}}.",
        "{{saudacao}}, {{primeiro_nome}}! Passando para um lembrete rápido.",
        "Oi, {{primeiro_nome}}, {{saudacao}}! Como vai?",
        "{{saudacao}}, {{primeiro_nome}}. Tudo certo com você?"
      ],
      pedido: [
        "Se puder, responda este e-mail {R} para combinarmos a regularização. Estamos aqui para ajudar.",
        "Quando puder, é só responder esta mensagem {R} que a gente encontra o melhor caminho junto com você.",
        "Conte com a gente: responda este e-mail {R} e enviamos o boleto atualizado.",
        "Se o pagamento já foi feito, pode desconsiderar. Se não, responda {R} que ajudamos com o boleto.",
        "Qualquer dúvida, é só responder por aqui {R}. Teremos prazer em ajudar.",
        "Fica o convite: responda este e-mail {R} e resolvemos isso de forma simples."
      ],
      fechamento: ["Um abraço,", "Obrigado pela atenção!", "Até breve,", "Abraços,"],
      assinatura: ["Equipe de Cobrança Moura Leite", "Equipe Moura Leite"]
    },
    direto: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}.",
        "{{primeiro_nome}}, {{saudacao}}.",
        "{{saudacao}}, {{primeiro_nome}}. Um aviso sobre o seu contrato.",
        "{{saudacao}}, {{primeiro_nome}}. Segue um lembrete importante."
      ],
      pedido: [
        "Para regularizar, responda este e-mail {R}.",
        "Responda {R} e enviamos o boleto atualizado.",
        "Pedimos o retorno {R} para regularizar.",
        "Responda esta mensagem {R} para receber a 2ª via atualizada.",
        "Regularize ou responda {R} para combinarmos a forma de pagamento.",
        "Se já pagou, desconsidere. Caso contrário, responda {R}."
      ],
      fechamento: ["Obrigado.", "Atenciosamente,", "Aguardamos seu retorno."],
      assinatura: ["Equipe de Cobrança Moura Leite", "Cobrança Moura Leite"]
    },
    empatico: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}. Sabemos que imprevistos acontecem e queremos ajudar.",
        "{{saudacao}}, {{primeiro_nome}}. Entendemos que a rotina às vezes aperta.",
        "{{saudacao}}, {{primeiro_nome}}. Estamos entrando em contato para ajudar, não para pressionar.",
        "Olá, {{primeiro_nome}}. {{saudacao}}! Sabemos que nem sempre o mês sai como planejado.",
        "{{saudacao}}, {{primeiro_nome}}. Sua tranquilidade com o seu lote é importante para nós."
      ],
      pedido: [
        "Se estiver passando por alguma dificuldade, responda {R} e vamos buscar juntos uma condição que caiba no seu orçamento.",
        "Podemos conversar sobre uma forma de pagamento que funcione para você. É só responder {R}.",
        "Responda este e-mail {R} contando a sua situação. Vamos analisar com atenção.",
        "Queremos encontrar uma saída boa para os dois lados. Responda {R} e conversamos.",
        "Se precisar de mais prazo ou de parcelamento, responda {R} que avaliamos com carinho.",
        "Estamos à disposição para ouvir você. Responda {R} e seguimos juntos."
      ],
      fechamento: ["Conte com a gente,", "Um abraço,", "Estamos à disposição,", "Com atenção,"],
      assinatura: ["Equipe de Cobrança Moura Leite", "Equipe Moura Leite"]
    },
    formal: {
      abertura: [
        "Prezado(a) {{nome}}, {{saudacao}}.",
        "Prezado(a) {{primeiro_nome}},",
        "{{saudacao}}, Sr(a). {{nome}}.",
        "Prezado(a) cliente {{nome}},"
      ],
      pedido: [
        "Solicitamos a regularização ou o contato por este e-mail {R}.",
        "Pedimos a gentileza de responder esta mensagem {R} para tratarmos da regularização.",
        "Permanecemos à disposição para emitir o boleto atualizado mediante retorno {R}.",
        "Solicitamos seu retorno {R}. Caso o pagamento já tenha sido efetuado, favor desconsiderar.",
        "Para tratar da regularização, solicitamos resposta a este e-mail {R}."
      ],
      fechamento: ["Atenciosamente,", "Cordialmente,", "Respeitosamente,"],
      assinatura: ["Departamento de Cobrança · Moura Leite", "Moura Leite · Cobrança"]
    },
    firme: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}.",
        "{{primeiro_nome}}, {{saudacao}}. Este é um aviso importante.",
        "{{saudacao}}, {{nome}}.",
        "{{saudacao}}, {{primeiro_nome}}. Precisamos tratar do seu contrato com prioridade."
      ],
      pedido: [
        "É necessário regularizar ou responder este e-mail {R}.",
        "Pedimos seu retorno {R}, sem falta, para regularizar a situação.",
        "Aguardamos a regularização ou o seu contato {R}.",
        "Responda este e-mail {R} para evitarmos as próximas medidas previstas em contrato.",
        "Não deixe para depois: responda {R} e regularize o contrato."
      ],
      fechamento: ["Atenciosamente,", "Aguardamos seu retorno.", "Contamos com a sua atenção."],
      assinatura: ["Departamento de Cobrança · Moura Leite", "Equipe de Cobrança Moura Leite"]
    }
  };

  // Situação de cada tag (o racional dela). "geral" vale para qualquer tom; "firme" entra só no tom Firme/Formal.
  const SIT_PADRAO = {
    geral: [
      "Há {{texto_abertas}} no contrato do lote {{unidade}}, no {{empreendimento}}, com atraso desde {{vencimento}}.",
      "Identificamos {{texto_abertas}} referente ao lote {{unidade}} do {{empreendimento}}.",
      "O contrato {{titulo}}, do lote {{unidade}} no {{empreendimento}}, está com {{texto_abertas}}.",
      "Em nosso sistema há {{texto_abertas}} do seu lote {{unidade}} ({{empreendimento}}), com atraso desde {{vencimento}}.",
      "Seu lote {{unidade}}, no {{empreendimento}}, tem {{texto_abertas}}."
    ],
    firme: [
      "Manter o contrato em atraso gera juros e multa e pode levar às medidas previstas em contrato.",
      "O atraso aumenta o valor devido com juros e multa."
    ]
  };

  const SITUACAO = {
    "1": { // 0% pago
      geral: [
        "Ainda não identificamos o primeiro pagamento do seu lote {{unidade}}, no {{empreendimento}}.",
        "O contrato do lote {{unidade}} ({{empreendimento}}) ainda está sem nenhuma parcela paga.",
        "Notamos que a primeira parcela do seu lote {{unidade}} no {{empreendimento}} ainda não foi paga.",
        "Para o seu lote {{unidade}}, no {{empreendimento}}, ainda não consta pagamento desde {{vencimento}}."
      ],
      firme: [
        "Sem o primeiro pagamento, o contrato pode ser desfeito, conforme as condições assinadas.",
        "O contrato sem pagamento corre o risco de ser cancelado, conforme as cláusulas do contrato."
      ]
    },
    "2": { // entrada Webro
      geral: [
        "A entrada do seu lote {{unidade}}, no {{empreendimento}}, ainda está em aberto.",
        "Ainda não identificamos o pagamento da entrada do lote {{unidade}} ({{empreendimento}}).",
        "Falta a quitação da entrada para seguir com o contrato do lote {{unidade}} no {{empreendimento}}."
      ],
      firme: ["Sem a entrada quitada, o contrato não segue para as próximas etapas."]
    },
    "0": { // acordo interno quebrado
      geral: [
        "O acordo feito para o lote {{unidade}}, no {{empreendimento}}, está com {{texto_abertas}}.",
        "Identificamos parcela do seu acordo em atraso desde {{vencimento}}, referente ao lote {{unidade}}.",
        "O acordo de regularização do lote {{unidade}} ({{empreendimento}}) ficou com parcela em aberto."
      ],
      firme: [
        "Com o acordo em atraso, as condições combinadas podem deixar de valer.",
        "O não pagamento do acordo pode cancelar as condições negociadas."
      ]
    },
    "5": { // acordo judicial quebrado
      geral: [
        "O acordo do lote {{unidade}}, no {{empreendimento}}, está com parcela em atraso desde {{vencimento}}.",
        "Identificamos {{texto_abertas}} no acordo referente ao lote {{unidade}} ({{empreendimento}})."
      ],
      firme: ["O descumprimento do acordo pode levar à retomada das medidas judiciais."]
    },
    "-2": { // proposta aguardando sinal
      geral: [
        "A sua proposta de acordo para o lote {{unidade}} está aprovada e aguarda o pagamento do sinal.",
        "Falta só o sinal para a proposta do lote {{unidade}} ({{empreendimento}}) passar a valer.",
        "O acordo do lote {{unidade}} está pronto: para valer, falta o pagamento do sinal."
      ],
      firme: ["Sem o sinal, a proposta perde a validade."]
    },
    "-3": { // termo de confissão
      geral: [
        "Para concluir o acordo do lote {{unidade}}, falta assinar o termo de confissão de dívida.",
        "O termo do seu acordo do lote {{unidade}} ({{empreendimento}}) está pronto para assinatura."
      ],
      firme: ["Sem a assinatura do termo, o acordo não é concluído."]
    },
    "-1": { // NEX cumprida
      geral: [
        "Conforme a notificação já enviada, o lote {{unidade}} do {{empreendimento}} segue com {{texto_abertas}}.",
        "Mesmo após a notificação, ainda há {{texto_abertas}} no lote {{unidade}} ({{empreendimento}})."
      ],
      firme: ["O prazo da notificação já terminou; as próximas medidas previstas em contrato podem ser adotadas."]
    },
    "9": { // enviar para o jurídico
      geral: [
        "O contrato do lote {{unidade}}, no {{empreendimento}}, está com {{texto_abertas}} desde {{vencimento}}.",
        "O atraso do lote {{unidade}} ({{empreendimento}}) chegou ao ponto em que o caso pode seguir para o jurídico."
      ],
      firme: [
        "Sem regularização, o caso será encaminhado ao jurídico. Esta é a oportunidade de resolver antes disso.",
        "Esta é a última oportunidade de negociar diretamente com a cobrança antes do encaminhamento ao jurídico."
      ]
    },
    "10": { // sem pagamento nos últimos 30 dias
      geral: SIT_PADRAO.geral.concat([
        "Não identificamos pagamentos do lote {{unidade}} ({{empreendimento}}) nos últimos 30 dias."
      ]),
      firme: SIT_PADRAO.firme
    },
    "11": { // com pagamento recente
      geral: [
        "Agradecemos o pagamento recente do lote {{unidade}}! Ainda há {{texto_abertas}}, com atraso desde {{vencimento}}.",
        "Recebemos o seu último pagamento, obrigado. Para deixar o lote {{unidade}} em dia, ainda há {{texto_abertas}}.",
        "Você já está regularizando o lote {{unidade}} e agradecemos por isso. Ainda há {{texto_abertas}}."
      ],
      firme: ["Para evitar novos juros, é importante quitar o que ainda está em aberto."]
    },
    "3": { // sub judice: texto cuidadoso, sem pressão
      geral: [
        "Entramos em contato sobre o contrato do lote {{unidade}}, no {{empreendimento}}.",
        "Gostaríamos de tratar com você do contrato do lote {{unidade}} ({{empreendimento}})."
      ],
      firme: []
    }
  };
  // Tags parecidas usam o mesmo racional.
  ["4", "7", "8", "8.75"].forEach((t) => { SITUACAO[t] = SITUACAO["3"]; });
  SITUACAO["8.5"] = SITUACAO["5"];
  SITUACAO["6"] = SITUACAO["5"];

  // Complemento opcional: quadro, extrato ou nada (deixa o texto mais curto).
  const COMPLEMENTO = {
    cordial: ["", "", "Veja abaixo o resumo:\n{{quadro_parcelas}}"],
    direto: ["", "{{quadro_parcelas}}", "{{extrato}}"],
    empatico: ["", ""],
    formal: ["", "Seguem as parcelas em aberto:\n{{quadro_parcelas}}", "{{extrato}}"],
    firme: ["", "{{quadro_parcelas}}"]
  };

  const ASSUNTO = {
    cordial: ["Lembrete do seu lote {{unidade}} · {{empreendimento}}", "{{primeiro_nome}}, um lembrete sobre o lote {{unidade}}", "Vamos colocar o lote {{unidade}} em dia?"],
    direto: ["Parcela em aberto · lote {{unidade}}", "Lote {{unidade}} · {{texto_abertas}}", "Regularização do lote {{unidade}}"],
    empatico: ["Podemos ajudar com o lote {{unidade}}?", "{{primeiro_nome}}, vamos conversar sobre o lote {{unidade}}?", "Uma solução para o seu lote {{unidade}}"],
    formal: ["Comunicado · contrato {{titulo}} · lote {{unidade}}", "Pendência financeira · {{empreendimento}} · {{unidade}}", "Aviso de parcela em aberto · contrato {{titulo}}"],
    firme: ["Importante: lote {{unidade}} em atraso", "Aviso de atraso · contrato {{titulo}}", "Regularize o lote {{unidade}} · {{empreendimento}}"]
  };

  // Gerador pseudoaleatório estável (mesma tag e tom = mesma ordem de sugestões).
  function rng(semente) {
    let x = 0;
    for (let i = 0; i < semente.length; i++) x = (x * 31 + semente.charCodeAt(i)) >>> 0;
    x = x || 1;
    return () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }

  function partesDe(tag, tom) {
    const t = TOM[tom] || TOM.cordial;
    const sit = SITUACAO[String(tag)] || SIT_PADRAO;
    const situacoes = sit.geral && sit.geral.length ? sit.geral : SIT_PADRAO.geral;
    const reforco = (tom === "firme" || tom === "formal") ? (sit.firme || []).concat("") : [""];
    return { t, situacoes, reforco, comp: COMPLEMENTO[tom] || [""], assuntos: ASSUNTO[tom] || ASSUNTO.cordial };
  }

  /** Quantas combinações diferentes existem para a tag e o tom. */
  function total(tag, tom) {
    const p = partesDe(tag, tom);
    return p.t.abertura.length * p.situacoes.length * p.reforco.length * p.comp.length * p.t.pedido.length * p.t.fechamento.length;
  }

  function montar(tag, tom, idx, diasRetorno) {
    const p = partesDe(tag, tom);
    const dims = [p.t.abertura.length, p.situacoes.length, p.reforco.length, p.comp.length, p.t.pedido.length, p.t.fechamento.length];
    const sel = [];
    let resto = idx;
    dims.forEach((n) => { sel.push(resto % n); resto = Math.floor(resto / n); });
    const ret = Number(diasRetorno) > 0 ? "até {{retorno:" + Math.round(Number(diasRetorno)) + "}}" : "nos próximos dias";
    const situacao = [p.situacoes[sel[1]], p.reforco[sel[2]]].filter(Boolean).join(" ");
    const partes = [
      p.t.abertura[sel[0]],
      situacao,
      p.comp[sel[3]],
      p.t.pedido[sel[4]].replace("{R}", ret),
      p.t.fechamento[sel[5]] + "\n" + p.t.assinatura[idx % p.t.assinatura.length]
    ].filter(Boolean);
    return {
      tom: (TONS.find((x) => x.id === tom) || TONS[0]).nome,
      tomId: tom,
      chave: tag + "|" + tom + "|" + idx,
      assunto: p.assuntos[idx % p.assuntos.length],
      texto: partes.join("\n\n")
    };
  }

  /** Próxima sugestão para a tag e o tom que ainda não foi mostrada (vistos = Set de chaves). */
  function proxima(tag, tom, diasRetorno, vistos) {
    const n = total(tag, tom);
    const sorteio = rng(String(tag) + "|" + tom + "|" + Date.now().toString(36).slice(0, 5));
    for (let i = 0; i < 400; i++) {
      const idx = Math.floor(sorteio() * n);
      const chave = tag + "|" + tom + "|" + idx;
      if (!vistos || !vistos.has(chave)) return montar(tag, tom, idx, diasRetorno);
    }
    return montar(tag, tom, Math.floor(Math.random() * n), diasRetorno);
  }

  window.CentralEmailSugestoes = { TONS, proxima, total, montar };
  if (typeof module !== "undefined" && module.exports) module.exports = window.CentralEmailSugestoes;
})();
