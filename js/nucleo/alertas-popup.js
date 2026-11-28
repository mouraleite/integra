/* Relação dos pop-ups que o sistema abre sozinho, a partir de regra já gravada no código. */
const AlertasPopupApp = {
  itens: [
    {
      id: "boletos-whatsapp",
      nome: "Lembrete de boletos no WhatsApp",
      quando: "No login, uma vez por mês, enquanto o mês não for marcado como concluído. Pode ser adiado por 15 min, 30 min, 1 h, 2 h, 3 h ou até amanhã.",
      logica: "A lista sai dos clientes com o alerta de WhatsApp ligado. O pop-up pede o envio manual da remessa do mês e some quando alguém marca o mês como concluído.",
      quem: "Quem tem a flag de reenvio de boleto no cadastro de usuário.",
      titulo: "Lembrete de Envio de Boletos (WhatsApp)",
      corpo: `<p>Os seguintes clientes estão com o alerta ativado para envio manual da remessa mensal via WhatsApp:</p>
        <div class="apa-item"><strong>Maria Aparecida Silva</strong><span>Título 18420 · Unidade 12, Quadra B</span></div>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real também aparecem Lembrar Mais Tarde e Marcar como Concluído neste Mês.</p>`
    },
    {
      id: "remessa-avulsa",
      nome: "Boletos avulsos para gerar",
      quando: "No login, nos dias em que o batimento das 7h da Remessa avulsa encontra parcelas do mês sem boleto. Não abre no primeiro dia útil do mês (dia da remessa mensal). Lembrar mais tarde esconde até a próxima entrada; Abrir Remessa avulsa não mostra mais naquele dia.",
      logica: "O batimento das 7h lê o extrato do mês: parcelas sem boleto e sem recebimento, situação Normal, condição Parcelas Mensais ou Parcela Acordo, sem financiamento em aberto. O back office gera o boleto avulso no Sienge e envia por e-mail na Remessa avulsa, pela caixa e com o texto da aba Configurações.",
      quem: "Operador de cobrança back office com acesso à Remessa avulsa. Administrador não recebe.",
      titulo: "Boletos avulsos para gerar",
      corpo: `<p>O batimento das 7h encontrou <b>12 parcela(s)</b> deste mês sem boleto gerado.</p>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real há Lembrar mais tarde e Abrir Remessa avulsa.</p>`
    },
    {
      id: "vistoria-resultado",
      nome: "Vistoria pedida na ficha foi aceita",
      quando: "Assim que o back office aceita a vistoria. Fica até a pessoa fechar.",
      logica: "O pedido nasce na ficha do cliente, sem link. O back office dispara um único link com os pedidos pendentes. Quando a vistoria é aceita, o aviso volta para quem pediu, com as respostas e as fotos. Quem pediu sendo o próprio back office não recebe esse aviso, porque é essa pessoa que valida as fotos.",
      quem: "Quem clicou em Solicitar Vistoria na ficha do cliente, exceto o operador de cobrança back office.",
      titulo: "Vistoria finalizada",
      corpo: `<p>O back office aceitou a vistoria que você pediu pela ficha do cliente.</p>
        <div class="apa-item"><strong>Cliente exemplo · QD 04 LT 18</strong><span>Água: sim · Energia: sim · Estágio: alvenaria</span></div>`
    },
    {
      id: "followup-gestor",
      nome: "Pedido de atualização do gestor",
      quando: "No login e assim que o administrador envia o pedido. Responder depois esconde até a próxima entrada no Integra. Some quando o operador responde.",
      logica: "O administrador clica em Pedir atualização na ficha do cliente e escreve as considerações. O pedido leva o resumo do contrato daquele momento: valores pagos, vencidos e a vencer, percentual pago, construção (com o lote do KMZ, se houver), Nex, renegociações, PMP e último contato. Nas Ocorrências e Promessas entra a nota Follow up do Gestor, e a resposta do operador fica como resposta dessa nota. Essas notas não contam como contato com o cliente. Os títulos pendentes aparecem nos Insights da home, e Contas a Receber > Follow-up Cobrança lista todos os pedidos.",
      quem: "O operador responsável pelo título, escolhido pelo administrador no pedido (vem preenchido com o operador da fila). Administrador não recebe.",
      titulo: "O gestor gostaria de uma atualização detalhada deste caso",
      corpo: `<p>Pedido de Administrador exemplo · 24/11/2026 08:40</p>
        <div class="apa-item"><strong>Cliente exemplo · Título 13444</strong><span>Pagos 26 parc. R$ 24.914,58 · Vencidos 3 parc. R$ 5.289,12 · 27% pago</span><span>Nex enviada em 10/10/2026 · 2 renegociações · PMP 33 dias</span></div>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real há Visualizar Extrato, Abrir ficha, o campo da resposta e Enviar resposta.</p>`
    },
    {
      id: "vistoria",
      nome: "Vistoria aguardando validação",
      quando: "No login e de novo quando uma vistoria entra em aguardando validação. Some ao confirmar a lista ou ao adiar.",
      logica: "Entram vistorias com status aguardando validação cuja obra não está ligada no painel de obras. As já confirmadas neste aviso não voltam.",
      quem: "Operador de cobrança back office. Administrador não recebe.",
      titulo: "Vistorias aguardando validação",
      corpo: `<div class="apa-item"><strong>QD 04 LT 18 · 22190</strong><span>ITU — Terras de Itu</span><span style="color:#7c3aed;font-weight:700;">Aguardando Validação</span></div>`
    },
    {
      id: "nex",
      nome: "Vencimento de NEX",
      quando: "No login, em dia útil, dentro da janela parametrizada de cada vencimento. Pode ser adiado até o limite da regra.",
      logica: "A configuração de NEX define o dia do vencimento, a partir de qual dia útil o aviso abre e até qual dia útil ele pode ser adiado. Sem vencimento nessa janela, o pop-up não abre.",
      quem: "Operador de cobrança back office. Administrador não recebe.",
      titulo: "Gerar NEX",
      corpo: `<p>Hoje é dia útil para gerar as NEX dos vencimentos parametrizados. Confira o prazo e abra Notificações.</p>
        <div class="apa-item"><strong>Vencimento dia 10 · 10/11/2026</strong><span>Pop-up a partir de 05/11/2026</span><span style="color:#105436;font-weight:700;">Adiar no máximo até 12/11/2026</span></div>`
    },
    {
      id: "distrato-mes",
      nome: "Prazo do distrato no mês",
      quando: "No login, no penúltimo e no último dia útil do mês. Uma vez por pessoa e por dia, ao fechar.",
      logica: "No penúltimo dia útil cobra a análise dos distratos do mês. No último dia útil cobra o lançamento. A lista de baixo é o follow-up da própria pessoa: distrato ainda não finalizado no Sienge.",
      quem: "Cobrança, back office de cobrança e relacionamento. Advogado e operador terceirizado não recebem.",
      titulo: "Distratos do mês",
      corpo: `<p>Hoje é o penúltimo dia útil do mês. Falta analisar os distratos que ainda estão em aberto.</p>
        <p style="color:#9a3412;">Você tem 1 distrato no follow-up que ainda não foi finalizado.</p>
        <div class="apa-item"><strong>Cliente exemplo</strong><span>Título 9044</span></div>`
    },
    {
      id: "cnd",
      nome: "Providenciar a CND",
      quando: "No login, quando o prazo da CND já chegou e a certidão ainda não foi enviada. Uma vez por item e por dia, ao fechar.",
      logica: "O prazo é 10 dias corridos depois do distrato. O aviso lista cidade, empreendimento, unidade e matrícula para a pesquisa na prefeitura. A certidão sobe no anexo da unidade.",
      quem: "O responsável gravado naquele item do follow-up de CND.",
      titulo: "Providenciar a CND",
      faixa: true,
      corpo: `<p>Passaram 10 dias corridos do distrato. Providencie a CND do lote.</p>
        <div class="apa-item"><strong>Distrato do lote 08, quadra 2</strong><span>Cidade Itu · Terras de Itu · Unidade QD 02 LT 08 · Matrícula 12345</span></div>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real há o campo para o PDF e o botão Enviar CND.</p>`
    },
    {
      id: "fechamento-pagadoria",
      nome: "Fechamento da pagadoria",
      quando: "No login, no antepenúltimo dia útil do mês. Uma vez por pessoa, ao marcar Ciente.",
      logica: "O período do lote vai do penúltimo dia útil até o último dia corrido do mês, sábado e domingo inclusos, para o pagamento dos parceiros cair no último dia útil.",
      quem: "Analista de Pagadoria I e Analista de Pagadoria II.",
      titulo: "Moura Leite Loteamentos",
      corpo: `<p>Hoje deverão ser feitos os lotes do dia 26/11/2026 ao dia 30/11/2026 para pagar dia 26. Sábado e domingo entram no período, para o fechamento dos parceiros ficar pago até o último dia.</p>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real o botão é Ciente.</p>`
    },
    {
      id: "lotes",
      nome: "Situação dos lotes",
      quando: "Às 15:30. Se a pessoa entra depois disso, abre na hora. Uma vez no dia, ao fechar.",
      logica: "Pede para atualizar os lotes. A busca separa títulos do dia ou vencidos que ainda não foram processados (até 60 dias) e títulos a vencer que saíram do lote porque o banco recusou.",
      quem: "Administrador, Analista de Tesouraria I e Analista de Tesouraria II. Supervisor e Analista III não recebem.",
      titulo: "Situação dos lotes",
      corpo: `<p>Atualize a situação dos lotes para checar se algum pagamento do dia ainda não foi processado ou se algum título saiu de lote por recusa do banco.</p>
        <p><button type="button" class="btn btn-primary" disabled>Buscar atualizações</button></p>
        <p style="margin-top:14px;font-weight:700;">Do dia ou vencidos, ainda sem processamento</p>
        <div class="apa-item"><strong>111200 · ITU PLAZA</strong><span>Vencimento hoje · Em aberto</span></div>
        <p style="margin-top:14px;font-weight:700;">A vencer, fora do lote por recusa do banco</p>
        <div class="apa-item"><strong>110880 · Fornecedor exemplo</strong><span>Vence em 12/11/2026 · sem lote atual</span></div>`
    },
    {
      id: "home-office",
      nome: "Home office de amanhã",
      quando: "No login, no dia anterior ao home office da pessoa. Uma vez para aquela data.",
      logica: "A escala é segunda, quinta e sexta, em rodízio de três semanas. Feriado nesse dia passa para a quarta. Se alguém do time está ausente naquele dia, ninguém fica de home office e o aviso não abre.",
      quem: "Letícia, Michelle ou Lucélia, somente quando o próximo dia da escala é o dela.",
      titulo: "Home office",
      corpo: `<p>Amanhã, quinta-feira 05/11/2026, você fica em home office.</p>
        <p>O almoço é das <strong>12h30–13h42</strong>.</p>`
    },
    {
      id: "ponto-sexta",
      nome: "Pendências no cartão de ponto",
      quando: "No login, na sexta-feira. Se a sexta for feriado, no dia útil anterior. Só nesse dia. Ciente dispensa o restante do dia, inclusive depois de Ctrl+F5 ou em outro computador.",
      logica: "Pede para checar as pendências no cartão de ponto do time. Não abre nos outros dias da semana. O ciente fica gravado no banco do Integra.",
      quem: "israel@mouraleite.com.br, só na própria conta. Testando como outra conta, não abre.",
      titulo: "Pendências no cartão de ponto",
      corpo: `<p>Cheque as pendências no cartão de ponto do time.</p>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real o botão é Ciente.</p>`
    },
    {
      id: "ponto-fechamento",
      nome: "Validar o ponto do time",
      quando: "No login, no dia 15. Se o dia 15 cair em feriado ou fim de semana, no próximo dia útil. Só nesse dia. Ciente dispensa o restante do dia, inclusive depois de Ctrl+F5 ou em outro computador.",
      logica: "Pede para validar o ponto do time. O período fechado vai do dia 15 do mês anterior até o dia 14 do mês do fechamento. Não fica aberto nos dias seguintes. O ciente fica gravado no banco do Integra.",
      quem: "israel@mouraleite.com.br, só na própria conta. Testando como outra conta, não abre.",
      titulo: "Validar o ponto do time",
      corpo: `<p>Valide o ponto do time. O mês fechou de 15/10/2026 até 14/11/2026.</p>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real o botão é Ciente. Se a sexta cair no mesmo dia, os dois textos vêm no mesmo aviso.</p>`
    },
    {
      id: "titulos-incompletos",
      nome: "Títulos incompletos",
      quando: "No batimento das 7h. Se a pessoa entra depois, abre na hora. Ciente dispensa o restante do dia, inclusive depois de atualizar a página.",
      logica: "A fila sai dos títulos com situação Incompleto ou Em inclusão, emitidos nos últimos 30 dias. Título que continua na fila no dia seguinte mostra há quantos dias está ciente. Título novo não mostra idade.",
      quem: "Analista de Pagadoria I.",
      titulo: "Títulos incompletos",
      corpo: `<p>Batimento das 7h. Estes títulos ainda estão incompletos no Sienge.</p>
        <div class="apa-item"><strong>Título 90441 · NF 1822</strong><span>CONSTRUTORA EXEMPLO · vencimento 20/11/2026</span><span style="color:#9a3412;font-weight:700;">Ciente há 1 dia</span></div>
        <div class="apa-item"><strong>Título 91002 · NF 1900</strong><span>FORNECEDOR NOVO · vencimento 25/11/2026 · Incompleto</span></div>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real o botão é Ciente.</p>`
    },
    {
      id: "webro-repasse",
      nome: "Repasse Webro pendente",
      quando: "No login, quando há título com a tag Pendente Repasse Webro. Ciente dispensa o restante do dia.",
      logica: "A baixa Webro registrada em Ocorrências e Promessas tem 3 dias úteis para o repasse entrar. Passado o prazo, o título fica com a tag Pendente Repasse Webro. Quem está com a fila de cobrança aberta atualiza a lista a cada 2 minutos; título que sai da tag sai da lista. O botão Checar repasse abre Recebimentos Webro, na aba Repasse pendente.",
      quem: "Analista de Pagadoria I.",
      titulo: "Repasse Webro pendente",
      faixa: true,
      corpo: `<p>Há títulos pendentes de baixa na Webro: a Webro recebeu e o repasse não entrou no prazo de 3 dias úteis. Checar repasse.</p>
        <div class="apa-item"><strong>Título 16752 · Cliente exemplo</strong><span>14704 - P-06 · baixa na Webro em 06/11/2026</span></div>
        <p style="color:#64748b;font-size:0.82rem;">Na tela real os botões são Ciente e Checar repasse.</p>`
    },
    {
      id: "esteira",
      nome: "Etapas vencidas na esteira",
      quando: "Todo dia às 08:00, enquanto a etapa continuar vencida. Se a pessoa entra depois, abre na hora. Fechar dispensa só aquele dia, inclusive depois de atualizar a página.",
      logica: "Lista financiamento em aberto cuja etapa atual da esteira está com o prazo estourado. No mesmo aviso, mostra cliente de financiamento com parcela vencida, a vencer neste mês ou no mês seguinte. O batimento das 7h grava essas parcelas; se ainda não houver batimento do dia, a consulta é feita na hora.",
      quem: "Administrador e operador de cobrança back office.",
      titulo: "Etapas vencidas na esteira",
      corpo: `<p>Estes financiamentos estão com a etapa atual fora do prazo.</p>
        <div class="apa-item"><strong>Bruna Alves · título 6526</strong><span>Validar minuta · atrasada</span></div>
        <p style="margin-top:12px;">Clientes de financiamento com parcela vencida, a vencer neste mês ou no mês seguinte.</p>
        <div class="apa-item"><strong>Erick Henrique · título 9336</strong><span>8 parcelas vencidas · 1 a vencer neste mês · 1 a vencer no mês seguinte</span></div>`
    },
    {
      id: "documentos",
      nome: "Documento não concluído no Sienge",
      quando: "No login, em dia útil contado depois da emissão. Nos dias úteis 5 e 6, só para quem gerou. A partir do 7º, nos dias 7, 9, 11 e assim por diante, para o perfil de quem gerou. Cada marco é visto uma vez, ao fechar.",
      logica: "Vale para cessão, aditamento, distrato e os demais documentos que ainda não estão lançados. Fim de semana e feriado não contam. Antes de abrir, o sistema confere de novo se o Sienge já concluiu o documento.",
      quem: "Quem gerou o documento, nos dias úteis 5 e 6. Do 7º dia útil em diante, a cada dois dias úteis, todas as pessoas do mesmo perfil de quem gerou, inclusive ela.",
      titulo: "Documento pendente no Sienge",
      corpo: `<p>O documento Cessão de direitos de ELISABETE FALCI, título 6526, foi emitido em 15/10/2026 e não foi concluído no Sienge ainda.</p>`
    },
    {
      id: "titulos-monitorados",
      nome: "Título acompanhado vencido",
      quando: "No login, depois que a fila do dia carrega, enquanto o título tiver parcela vencida. Uma vez por pessoa e por dia, ao fechar.",
      logica: "A lista de títulos acompanhados fica no código (hoje só o 16955, Casa SPA). Eles continuam na inadimplência; o aviso abre quando algum deles tem parcela vencida na fila do dia.",
      quem: "Operador de cobrança back office.",
      titulo: "Título acompanhado está vencido",
      corpo: `<p>Este título está na inadimplência e precisa de contato do back office.</p>
        <p style="margin:0 0 4px 0;"><strong>Título 16955</strong> · Cliente exemplo · CASA SPA</p>
        <div class="apa-item"><strong>Parcela 6 · venceu em 16/11/2026</strong><span>9 dia(s) em atraso</span><span style="color:#b91c1c;font-weight:700;">R$ 6.000,00</span></div>`
    },
    {
      id: "mudanca-endereco",
      nome: "Mudança de endereço do Integra",
      quando: "Ao abrir o Integra no endereço antigo (crm-gestao.vercel.app), uma vez por dia em cada navegador, até a virada. No dia da virada passa a bloquear o endereço antigo e levar para o novo.",
      logica: "Só age no endereço antigo de produção; bolhas de teste e o endereço novo não mostram. A chave BLOQUEAR em js/nucleo/aviso-endereco.js é ligada depois da carga final dos dados.",
      quem: "Todos os usuários.",
      titulo: "O Integra vai mudar de endereço",
      corpo: `<p>A partir de <strong>segunda-feira, 30/11/2026</strong>, o Integra passa a funcionar neste endereço:</p>
        <div class="apa-item"><strong>integra-mouraleite.vercel.app</strong></div>
        <p><strong>Até lá, continue usando este endereço normalmente.</strong> Salve o endereço novo nos favoritos.</p>`
    },
    {
      id: "repactuacao",
      nome: "Repactuação no virar do mês",
      quando: "No login, no primeiro e no último dia útil do mês. Uma vez por pessoa e por dia, ao fechar.",
      logica: "No último dia útil pede o cadastro dos indexadores no Sienge e o upload da prévia da competência seguinte. No primeiro dia útil pede para aplicar a repactuação antes de gerar a remessa.",
      quem: "Operador de cobrança back office.",
      titulo: "Último dia útil do mês",
      corpo: `<p>Hoje é o último dia útil para cadastrar os indexadores no Sienge e fazer a prévia da repactuação no IntegrA.</p>
        <p>A competência que será reajustada é <strong>dezembro de 2026</strong>. Tire no Sienge o relatório desse mês e faça o upload em Repactuação.</p>`
    }
  ],

  esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  /* ---------- Liga/desliga ----------
     A lista dos pop-ups desligados fica em config/popups_desligados ({ ids: [...] }) e numa cópia no navegador,
     para o aviso já saber na entrada. Cada pop-up que respeita a chave chama window.PopupAtivo(id) antes de abrir
     sozinho (a prévia desta tela continua abrindo). Sem nada gravado, vale DESLIGADOS_PADRAO. */
  DESLIGADOS_PADRAO: ["lotes"],
  // Pop-ups que já consultam a chave. Os demais aparecem como "Sempre ligado".
  COM_CHAVE: ["lotes", "fechamento-pagadoria", "remessa-avulsa", "titulos-incompletos", "webro-repasse", "documentos", "esteira", "ponto-sexta", "ponto-fechamento", "home-office"],
  CACHE: "crm_popups_desligados_v1",
  _desligados: null,
  _carregando: null,

  desligados() {
    if (!this._desligados) {
      let ids = null;
      try { ids = JSON.parse(localStorage.getItem(this.CACHE) || "null"); } catch (e) {}
      this._desligados = new Set(Array.isArray(ids) ? ids : this.DESLIGADOS_PADRAO);
    }
    return this._desligados;
  },

  ativo(id) {
    return !this.desligados().has(String(id));
  },

  guardarCache() {
    try { localStorage.setItem(this.CACHE, JSON.stringify([...this.desligados()])); } catch (e) {}
  },

  async esperarBanco() {
    for (let i = 0; i < 40; i++) {
      if (window.DadosNucleo && typeof window.DadosNucleo.lerConfig === "function") return "sb";
      const fc = window.firebaseCollections;
      if (window.firebaseDb && fc && fc.getDoc && fc.doc) return "fb";
      await new Promise((r) => setTimeout(r, 250));
    }
    return "";
  },

  async carregar() {
    if (this._carregando) return this._carregando;
    this._carregando = (async () => {
      try {
        const banco = await this.esperarBanco();
        let snap = null;
        if (banco === "sb") snap = await window.DadosNucleo.lerConfig("popups_desligados");
        else if (banco === "fb") snap = await window.firebaseCollections.getDoc(window.firebaseCollections.doc(window.firebaseDb, "config", "popups_desligados"));
        else return;
        const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
        const ids = existe ? ((snap.data() || {}).ids) : null;
        this._desligados = new Set(Array.isArray(ids) ? ids.map(String) : this.DESLIGADOS_PADRAO);
        this.guardarCache();
      } catch (e) {
        // Antes do login a leitura pode ser recusada: tenta de novo mais tarde (vale a cópia do navegador).
        console.warn("[Alertas pop-up] leitura do liga/desliga", e);
        this._carregando = null;
        this._tentativas = (this._tentativas || 0) + 1;
        if (this._tentativas < 6) setTimeout(() => this.carregar(), 15000);
      }
    })();
    return this._carregando;
  },

  async alternar(id, ligar) {
    const set = this.desligados();
    if (ligar) set.delete(String(id)); else set.add(String(id));
    this.guardarCache();
    this.abrir();
    try {
      const banco = await this.esperarBanco();
      const dados = { ids: [...set], atualizadoEm: new Date().toISOString(), por: (window.currentUser && (window.currentUser.email || window.currentUser.name)) || "" };
      if (banco === "sb") await window.DadosNucleo.gravarConfig("popups_desligados", dados);
      else if (banco === "fb") await window.firebaseCollections.setDoc(window.firebaseCollections.doc(window.firebaseDb, "config", "popups_desligados"), dados);
      else throw new Error("banco indisponível");
    } catch (e) {
      alert("Não consegui gravar no banco do Integra. A mudança vale só neste navegador por enquanto.");
    }
  },

  abrir() {
    const root = document.getElementById("alertas-popup-root");
    if (!root) return;
    const linhas = this.itens.map((item) => {
      const temChave = this.COM_CHAVE.indexOf(item.id) >= 0;
      const ligado = !temChave || this.ativo(item.id);
      const chave = temChave
        ? `<label class="apa-chave" title="${ligado ? "Ligado: abre sozinho pela regra" : "Desligado: não abre sozinho"}">
            <input type="checkbox" ${ligado ? "checked" : ""} onchange="AlertasPopupApp.alternar('${item.id}', this.checked)">
            <span class="apa-chave-trilho"></span><span class="apa-chave-txt">${ligado ? "Ligado" : "Desligado"}</span></label>`
        : `<span class="apa-chave-fixo">Sempre ligado</span>`;
      return `<tr class="${ligado ? "" : "is-desligado"}">
      <td class="apa-nome">${this.esc(item.nome)}</td>
      <td>${this.esc(item.quando)}</td>
      <td>${this.esc(item.logica)}</td>
      <td>${this.esc(item.quem)}</td>
      <td class="apa-situacao">${chave}</td>
      <td class="apa-acoes">
        <button type="button" class="tvig-ico" title="Visualizar" onclick="AlertasPopupApp.visualizar('${item.id}')">
          <i data-lucide="eye" style="width:15px;height:15px;"></i>
        </button>
      </td>
    </tr>`;
    }).join("");
    if (!this._lidoNaTela) {
      this._lidoNaTela = true;
      this.carregar().then(() => { if (document.getElementById("alertas-popup-root")) this.abrir(); });
    }
    root.innerHTML = `<p class="apa-lead">Cada linha é um pop-up que abre sozinho quando a regra abaixo se cumpre. Visualizar mostra o aviso como a pessoa recebe, sem gravar ciente e sem disparar a regra. A coluna Situação liga ou desliga o pop-up para todos os usuários.</p>
      <div style="overflow:auto;">
        <table class="apa-tabela">
          <thead>
            <tr>
              <th>Alerta</th>
              <th>Quando abre</th>
              <th>Lógica</th>
              <th>Quem recebe</th>
              <th class="apa-situacao">Situação</th>
              <th class="apa-acoes">Ações</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  },

  /** Faixa no topo da tela enquanto a prévia real está aberta: diz para quem é e que nada é gravado. */
  faixaPrevia(item) {
    const antiga = document.getElementById("apa-previa-faixa");
    if (antiga) antiga.remove();
    const faixa = document.createElement("div");
    faixa.id = "apa-previa-faixa";
    faixa.className = "apa-previa-faixa";
    faixa.textContent = "Prévia (nada é gravado) · Para: " + item.quem;
    document.body.appendChild(faixa);
    setTimeout(() => { if (faixa.parentNode) faixa.remove(); }, 8000);
  },

  async visualizar(id) {
    const item = this.itens.find((row) => row.id === id);
    if (!item) return;
    // Prévia real: o próprio módulo do pop-up registra em window.PopupPrevias a função que abre o aviso
    // de verdade, com dados de exemplo e sem gravar. Módulo sob demanda é carregado antes.
    if (item.grupo && typeof window.crmCarregarGrupoSobDemanda === "function") {
      try { await window.crmCarregarGrupoSobDemanda(item.grupo); } catch (e) {}
    }
    const previa = window.PopupPrevias && window.PopupPrevias[id];
    if (typeof previa === "function") {
      try {
        await previa();
        this.faixaPrevia(item);
        return;
      } catch (e) {
        console.warn("[Alertas pop-up] prévia real falhou, mostrando o resumo:", e);
      }
    }
    const antigo = document.getElementById("apa-preview");
    if (antigo) antigo.remove();
    const pop = document.createElement("div");
    pop.id = "apa-preview";
    pop.className = "apa-overlay";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-labelledby", "apa-preview-titulo");
    pop.innerHTML = `<div class="apa-preview-wrap">
      <p class="apa-preview-nota">Prévia para: ${this.esc(item.quem)}</p>
      <div class="apa-card">
        <div class="apa-card-head${item.faixa ? " is-faixa" : ""}">
          <h3 id="apa-preview-titulo">${this.esc(item.titulo)}</h3>
          <button type="button" class="btn btn-fechar" id="apa-preview-fechar">Fechar</button>
        </div>
        <div class="apa-card-corpo">${item.corpo}</div>
      </div>
    </div>`;
    document.body.appendChild(pop);
    pop.querySelector("#apa-preview-fechar").addEventListener("click", () => pop.remove());
  }
};

window.AlertasPopupApp = AlertasPopupApp;
/** true = o pop-up pode abrir sozinho. Usado pelos módulos antes de abrir o aviso automático. */
window.PopupAtivo = function (id) { return AlertasPopupApp.ativo(id); };
AlertasPopupApp.carregar();
