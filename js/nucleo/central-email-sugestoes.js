/* Central de e-mail: biblioteca de sugestões de texto, sem IA e sem custo.
   Cada sugestão é montada com partes por tom (abertura, pedido, fechamento, assinatura) e partes pela situação
   da tag (o racional da tag na Fila). As combinações passam de centenas por tag e tom; "Outra sugestão" nunca
   repete uma já mostrada na janela. Os textos usam só as variáveis do template; {R} vira a data de retorno.
   Trechos entre **asteriscos** saem em negrito no e-mail. */
(function () {
  "use strict";

  // Tons pedidos em 27/11/2026: cobrança com boas-vindas, lembrete, atraso contumaz e jurídico de fácil entendimento.
  const TONS = [
    { id: "boasvindas", nome: "Cobrança com boas-vindas" },
    { id: "lembrete", nome: "Lembrete" },
    { id: "contumaz", nome: "Atraso contumaz" },
    { id: "juridico", nome: "Jurídico" }
  ];

  // Partes de cada tom. {R} = "até {{retorno:N}}" (ou "nos próximos dias" sem data de retorno).
  const TOM = {
    // Reaproximação (27/11/2026): sem entusiasmo; pergunta se o boleto está chegando, se há dificuldade, e oferece ajuda.
    boasvindas: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}. Tudo bem?",
        "{{saudacao}}, {{primeiro_nome}}. Estamos passando para saber como você está.",
        "Olá, {{primeiro_nome}}. {{saudacao}}! Queremos saber se está tudo certo com os pagamentos do seu lote {{unidade}}.",
        "{{saudacao}}, {{primeiro_nome}}. Gostaríamos de retomar o contato sobre o seu lote no {{empreendimento}}.",
        "{{saudacao}}, {{primeiro_nome}}. Somos da equipe Moura Leite e queremos ajudar com os pagamentos do seu lote."
      ],
      pedido: [
        "Os boletos estão chegando no seu e-mail? Se não estiverem, responda {R} que enviamos de novo.",
        "Se estiver com alguma dificuldade com os boletos ou com o pagamento, responda {R} e buscamos juntos uma solução.",
        "Pode ser que o boleto não tenha chegado. Responda {R} e conferimos o seu e-mail de cadastro e enviamos a 2ª via.",
        "Se o pagamento já foi feito, pode desconsiderar. Se não, responda {R} que ajudamos com o boleto.",
        "Queremos entender o que aconteceu. Responda {R} e conversamos sobre a melhor forma de pagamento para você.",
        "Se preferir, responda {R} com o melhor telefone e horário para falarmos com você."
      ],
      fechamento: ["Conte com a gente,", "Um abraço,", "Estamos à disposição,", "Atenciosamente,"],
      assinatura: ["Equipe Moura Leite", "Equipe de Relacionamento Moura Leite"]
    },
    lembrete: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}. Passando para um lembrete rápido.",
        "{{saudacao}}, {{primeiro_nome}}! Só um lembrete amigável.",
        "Olá, {{primeiro_nome}}. {{saudacao}}! Um lembrete sobre o seu lote {{unidade}}.",
        "{{saudacao}}, {{primeiro_nome}}. Tudo bem? Um aviso breve.",
        "Oi, {{primeiro_nome}}, {{saudacao}}! Talvez tenha passado despercebido."
      ],
      pedido: [
        "Se já pagou, pode desconsiderar. Se não, responda {R} e enviamos a 2ª via.",
        "Para receber o boleto atualizado, é só responder este e-mail {R}.",
        "Qualquer dúvida, responda por aqui {R}.",
        "Assim que puder, regularize ou responda {R} para combinarmos.",
        "Responda esta mensagem {R} e ajudamos com o pagamento.",
        "Fica o lembrete: responda {R} e resolvemos de forma simples."
      ],
      fechamento: ["Obrigado!", "Um abraço,", "Até breve,", "Atenciosamente,"],
      assinatura: ["Equipe de Cobrança Moura Leite", "Equipe Moura Leite"]
    },
    // Firme, sem ser agressivo (27/11/2026): diz com clareza que o atraso se repete e pede retorno com data,
    // sem cobrança insistente ("sem falta", "não deixe para depois") e sem citar tentativas anteriores.
    contumaz: {
      abertura: [
        "{{saudacao}}, {{primeiro_nome}}.",
        "{{saudacao}}, {{primeiro_nome}}. Escrevemos sobre o seu contrato.",
        "{{saudacao}}, {{primeiro_nome}}. Precisamos tratar da situação do seu contrato.",
        "{{saudacao}}, {{nome}}. Voltamos a falar sobre o seu contrato."
      ],
      reforco: [
        "Os atrasos têm se repetido e precisamos combinar uma solução definitiva.",
        "Para o contrato ficar em dia, precisamos definir com você como regularizar."
      ],
      pedido: [
        "Pedimos o seu retorno **{R}** para regularizar.",
        "Contamos com a regularização ou com uma proposta sua **{R}**.",
        "Responda este e-mail **{R}** para combinarmos como o contrato fica em dia.",
        "Regularize ou responda **{R}**; estamos à disposição para combinar a melhor forma.",
        "Seu retorno **{R}** é importante para mantermos o contrato regular."
      ],
      fechamento: ["Atenciosamente,", "Aguardamos seu retorno.", "Contamos com você."],
      assinatura: ["Departamento de Cobrança · Moura Leite", "Equipe de Cobrança Moura Leite"]
    },
    // Linguagem jurídica, mas fácil de entender: cita o contrato e as consequências em palavras simples.
    juridico: {
      abertura: [
        "Prezado(a) {{nome}},",
        "{{saudacao}}, Sr(a). {{nome}}.",
        "Prezado(a) {{primeiro_nome}}, {{saudacao}}.",
        "Prezado(a) cliente {{nome}},"
      ],
      reforco: [
        "Pelo contrato assinado, o atraso gera multa e juros e permite à empresa adotar as medidas previstas nele.",
        "Em palavras simples: enquanto houver valor em aberto, o contrato não está sendo cumprido."
      ],
      pedido: [
        "Para evitar as medidas previstas em contrato, solicitamos a regularização ou o contato por este e-mail **{R}**.",
        "Solicitamos seu retorno **{R}**. Caso o pagamento já tenha sido feito, desconsidere esta mensagem.",
        "Pedimos que responda **{R}** para tratarmos da regularização de forma amigável.",
        "Ainda é possível resolver de forma amigável: responda este e-mail **{R}**."
      ],
      fechamento: ["Atenciosamente,", "Respeitosamente,", "Cordialmente,"],
      assinatura: ["Departamento de Cobrança · Moura Leite", "Moura Leite · Cobrança"]
    }
  };

  // Situação de cada tag (o racional dela). "geral" vale para qualquer tom; "firme" entra nos tons
  // Atraso contumaz e Jurídico. semPressao: tags sub judice, sem reforço nem menção a medidas.
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
      semPressao: true,
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

  // Tom que já vem escolhido ao abrir as sugestões, pelo racional da tag (o operador pode trocar).
  const TOM_DA_TAG = {
    "1": "boasvindas", "2": "boasvindas", "-2": "boasvindas", "-3": "boasvindas",
    "10": "lembrete", "11": "lembrete",
    "0": "contumaz", "-1": "contumaz",
    "9": "juridico", "5": "juridico", "6": "juridico", "8.5": "juridico",
    "3": "juridico", "4": "juridico", "7": "juridico", "8": "juridico", "8.75": "juridico"
  };

  function tomSugerido(tag) {
    return TOM_DA_TAG[String(tag)] || "lembrete";
  }

  // Complemento opcional: quadro, extrato ou nada (deixa o texto mais curto).
  const COMPLEMENTO = {
    boasvindas: ["", "", "Veja abaixo as parcelas em aberto:\n{{quadro_parcelas}}"],
    lembrete: ["", "", "{{quadro_parcelas}}"],
    contumaz: ["", "{{quadro_parcelas}}", "{{extrato}}"],
    juridico: ["", "Seguem as parcelas em aberto:\n{{quadro_parcelas}}", "{{extrato}}"]
  };

  const ASSUNTO = {
    boasvindas: ["{{primeiro_nome}}, os boletos do lote {{unidade}} estão chegando?", "Podemos ajudar com os pagamentos do lote {{unidade}}?", "Seu lote {{unidade}} no {{empreendimento}}: estamos à disposição"],
    lembrete: ["Lembrete do seu lote {{unidade}} · {{empreendimento}}", "{{primeiro_nome}}, um lembrete sobre o lote {{unidade}}", "Parcela em aberto · lote {{unidade}}"],
    contumaz: ["Lote {{unidade}}: parcelas em atraso", "Aviso de atraso · contrato {{titulo}}", "{{primeiro_nome}}, precisamos do seu retorno sobre o lote {{unidade}}"],
    juridico: ["Comunicado · contrato {{titulo}} · lote {{unidade}}", "Notificação de pendência · {{empreendimento}} · {{unidade}}", "Aviso sobre o contrato {{titulo}} · lote {{unidade}}"]
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
    const t = TOM[tom] || TOM.lembrete;
    const sit = SITUACAO[String(tag)] || SIT_PADRAO;
    const situacoes = sit.geral && sit.geral.length ? sit.geral : SIT_PADRAO.geral;
    // Reforço: no Jurídico entram as consequências da tag (ex.: "o contrato pode ser desfeito"); no Atraso contumaz,
    // só as frases firmes do próprio tom, sem falar em consequências. Sub judice: sem reforço e sem pedido que fale em medidas.
    const reforco = sit.semPressao ? [""]
      : (tom === "juridico" ? (sit.firme || []).concat(t.reforco || [], "")
        : (tom === "contumaz" ? (t.reforco || []).concat("") : [""]));
    const pedido = sit.semPressao ? t.pedido.filter((p) => !/medidas/i.test(p)) : t.pedido;
    return { t, pedido: pedido.length ? pedido : t.pedido, situacoes, reforco, comp: COMPLEMENTO[tom] || [""], assuntos: ASSUNTO[tom] || ASSUNTO.lembrete };
  }

  /** Quantas combinações diferentes existem para a tag e o tom. */
  function total(tag, tom) {
    const p = partesDe(tag, tom);
    return p.t.abertura.length * p.situacoes.length * p.reforco.length * p.comp.length * p.pedido.length * p.t.fechamento.length;
  }

  function montar(tag, tom, idx, diasRetorno) {
    const p = partesDe(tag, tom);
    const dims = [p.t.abertura.length, p.situacoes.length, p.reforco.length, p.comp.length, p.pedido.length, p.t.fechamento.length];
    const sel = [];
    let resto = idx;
    dims.forEach((n) => { sel.push(resto % n); resto = Math.floor(resto / n); });
    const ret = Number(diasRetorno) > 0 ? "até {{retorno:" + Math.round(Number(diasRetorno)) + "}}" : "nos próximos dias";
    const situacao = [p.situacoes[sel[1]], p.reforco[sel[2]]].filter(Boolean).join(" ");
    const partes = [
      p.t.abertura[sel[0]],
      situacao,
      p.comp[sel[3]],
      p.pedido[sel[4]].replace("{R}", ret),
      p.t.fechamento[sel[5]] + "\n" + p.t.assinatura[idx % p.t.assinatura.length]
    ].filter(Boolean);
    return {
      tom: (TONS.find((x) => x.id === tom) || TONS[1]).nome,
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

  const raiz = typeof window !== "undefined" ? window : globalThis;
  raiz.CentralEmailSugestoes = { TONS, proxima, total, montar, tomSugerido };
  if (typeof module !== "undefined" && module.exports) module.exports = raiz.CentralEmailSugestoes;
})();
