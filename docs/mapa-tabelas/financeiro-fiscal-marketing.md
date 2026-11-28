# Mapa de tabelas: financeiro, tesouraria, pagadoria, fiscal, contábil e marketing

Migration: `supabase/migrations/202611191330_financeiro_fiscal_marketing.sql`.
Base: amostra de até 200 docs por coleção (`integra-export/inventario-amostra`) e leitura do código (`js/`, `api/_lib/`, `lib/`).

## Regras gerais desta área

- **Colunas padrão** (`extra`, `criado_em`, `atualizado_em`) em todas as tabelas, inclusive nas tabelas de itens. Trigger
  `<tabela>_atualizado_em` em todas (laço `do $$` na seção 11 da migration).
- **Campos de auditoria do Firestore viram as colunas padrão**: `createdAt`/`criadoEm` → `criado_em`;
  `updatedAt`/`atualizadoEm` → `atualizado_em`; `updatedBy` → `atualizado_por`. Epoch ms vira `timestamptz`.
  Na carga, gravar o valor original (insert não dispara o trigger).
- **Pedaços de documento grande** (`_p2`, `__p0`, `parte`, `partes`, `n`, `chunk`, `i`, `texto`, `payload`, `pai`, `tipo: "parte"`)
  são só contorno do limite de 1 MB do Firestore: o importador junta as partes e **não** guarda esses campos.
- **Ids de outras áreas** (empresa, centro de custo, cliente, unidade, título/credor do Sienge) ficam em colunas `text`,
  sem FK.
- **Leitura x gravação**: a tela libera leitura com `_acessar`, `_visualizar` ou `_editar` (`js/nucleo/app.js:7753`).
  A função `privado.fin_pode_ver('<base>')` reproduz isso. Gravação usa `privado.tem_permissao('<base>_editar')`.
  Exceção: **cache preenchido ao consultar** (a tela grava enquanto lê); aí quem vê a tela também grava (indicado abaixo).
- `privado.fin_pode_ver` tem prefixo `fin_` para não colidir com as outras áreas. Se outra área criar o mesmo
  helper (`pode_ver`/`tem_tela`), dá para unificar depois.
- **Helpers de conversão** (`privado.fin_num`, `fin_int`, `fin_data`, `fin_ts`, `fin_arr`) servem às RPCs. Eles aceitam os
  mesmos objetos JSON que o front gravava no Firestore. Assim a Fase 3 troca `setDoc` pela RPC sem remontar os objetos.
- **RPCs "apaga e põe"**: onde o código regravava um bloco inteiro (mês, lote, período), há uma função atômica
  `security invoker` (a RLS do chamador vale). Lista na seção [RPCs](#rpcs).
- **Realtime**: só `fiscal_notas_envio` tem `onSnapshot` na área.
- **runTransaction / increment**: nenhum na área. O único contador (`mutuo_meta.ultima`) era lido e gravado sem trava;
  agora é `registrar_nota_debito_mutuo`.

## Decisões sobre documentos grandes

| Coleção | Tamanho | Decisão | Motivo |
|---|---|---|---|
| `cfin_pagos` | até 684 KB/doc | **uma linha por título** (`cfin_pagos_bills`), com colunas de filtro e `dados jsonb` | Base histórica permanente: mês fechado não volta ao Sienge (`morning-warmup.js:944`). O código filtra título a título por período (`compras-controle-financeiro.js:1116`) e deduplica. |
| `antecipacoes_mes` | até 784 KB/doc | **uma linha por evento** (`antecipacoes_mes_eventos`) | A tela filtra evento a evento por data, empresa, CC e busca (`antecipacoes.js:158-178`). O cron troca só os eventos da janela de 7 dias. |
| `caixa_posicao` | 134 KB/doc | **uma linha por unidade por dia** | `loadDate`/`listDates` filtram por data (`caixa-diario.js:178-200`). A fila monta índice por unidade (`app.js:10495`). |
| `caixa_movimentos` | pequeno na amostra; até 700 KB por desenho | **uma linha por movimento** (`caixa_movimentos_itens`), `dados jsonb` + `data` + `centros_custo` | Base histórica até 2025-12, nunca relida. Filtro por data e centro de custo item a item (`sienge-api.js:2178`). |
| `caixa_valor_receber` | pequeno | **uma linha por título/parcela** (`caixa_valor_receber_itens`) | Itens uniformes, somados por dia/vencimento na tela. |
| `participacoes_periods` | 35 KB/doc | **uma linha por despesa** (`participacoes_periods_expenses`) | Soma, filtro por credor/categoria e reparo linha a linha (`participacoes.js:639`, `:928-941`). |
| `pagamento_lotes` | 31 KB/doc | **uma linha por item** (`pagamento_lotes_itens`) | O código procura título/parcela dentro dos lotes (`gerar-pagamento.js:1470`). |
| `dfc_orcamento` | ~300 KB/doc | **uma linha por linha do orçamento** (`dfc_orcamento_linhas`, `m numeric[12]`) | Planilha de orçamento de verdade (não regenerável do Sienge), agregada por empresa/CC/conta. |
| `dfc_realizado` | até 480 KB (2 partes) | **uma linha por item** (`dfc_realizado_itens`) | Linhas uniformes (grupo, categoria, CC, mês, valor), somadas na grade. |
| `resultado_caixa` | até 470 KB (partes) | **jsonb por documento** (`entradas`, `contas`, `contas_por_cc`, `planos_json`, `nomes`, `por_arquivo`) | Grade aninhada (conta → mês → `{o, r}`) lida inteira e fundida na tela (`resultado-caixa.js:2151`). **Não** é cache: é a única cópia na nuvem das planilhas importadas. |
| `marketing_budget_titulos` | até 780 KB (partes) | **jsonb por centro de custo** (`bills`) — cache regenerável | Cache com validade de 30 min (`marketing-budget.js:16`, `:773`). |
| `marketing_budget_vendas` | 89 KB/doc | **jsonb por CC+mês** (`vendas`, `distratos`) — cache regenerável | Lido por mês e exibido. O doc cabeçalho (só `meses`) vira consulta `select ym where cc_id`. |
| `rydoo_meta` | pequeno | **jsonb** (`items`) — cache regenerável | Lista de colaboradores do Sienge, lida inteira. |
| `caixa_radar` | (vazio) | **jsonb** (`receber`, `incerto`, `pagar`) | Foto congelada do mês, exibida em bloco. |
| `titulos_incompletos_batimento` | pequeno | **jsonb** (`rows`, `primeiros`) | Foto única "atual" do cron, exibida no aviso. |

---

## Tesouraria (Caixa e banco)

### caixa_diario_config → `caixa_diario_config_contas`, `caixa_diario_config_cc_excluidos`
Doc único `saldo_inicial` com três mapas. Não há tabela-mãe: a configuração vira linhas por conta e por empresa.

| Campo | Destino | Transformação |
|---|---|---|
| `contas["<emp>|<conta>"]` (bool) | `caixa_diario_config_contas.incluida` | `id` = chave; `company_id`/`conta` = chave partida no **primeiro** `|` |
| `tipos["<emp>|<conta>"]` | `caixa_diario_config_contas.tipo` | mesma linha da chave (cria a linha se só existir em `tipos`) |
| `empreendimentosExcluidos["<emp>"]` (array) | `caixa_diario_config_cc_excluidos.empreendimentos text[]` | `id` = código da empresa |
| `updatedBy` / `updatedAt` | `atualizado_por` / `atualizado_em` em todas as linhas | |

- Permissão: leitura `fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')`; gravação `sub_fin_cb_fluxo_caixa_diario_editar`.
- Código: `js/financeiro/caixa-diario.js:1057` (lê), `:1077` (grava com merge por chave). Fase 3: upsert de uma linha por
  chave alterada (`flags[key]`, `tipos[key]`), ou da linha da empresa em `cc_excluidos`.

### caixa_movimentos → `caixa_movimentos` + `caixa_movimentos_itens`
| Campo | Destino |
|---|---|
| doc id `<emp>_<AAAA-MM>` / `<emp>_base` | `caixa_movimentos.id` |
| `companyId`, `ym`, `n`, `em` | `company_id`, `ym`, `n`, `em` (timestamptz) |
| `ate` (só `_base`) | `ate` |
| `movimentos[]` (+ `movimentos` de `<id>_p2…`) | `caixa_movimentos_itens`: `ordem`, `dados` = objeto inteiro, `data` = `bankMovementDate ‖ paymentDate ‖ date`, `centros_custo` = `costCenterId` + `financialCategories[].costCenterId` |
| `partes`, `parte` | descartados |

- Permissão: padrão `usuario_ativo()` para tudo. O cache é gravado por qualquer tela que use `SiengeApiService`
  (`js/nucleo/sienge-api.js:2067`, `:2106`, `:2189`, `:2201`).
- RPC: `gravar_caixa_movimentos_mes(company_id, ym, movimentos)`. O marcador `_base` é um upsert direto em `caixa_movimentos`.
- Importador: docs `_pN` não viram linha de cabeçalho; os itens dele vão para o pai `<emp>_<ym>`, com `ordem` seguindo.
  A amostra só tem meses vazios da empresa 10: **conferir no export completo o formato do movimento** (campos de data).

### caixa_posicao → `caixa_posicao` (uma linha por unidade por dia)
| Campo | Destino |
|---|---|
| doc `date` / `rows[].d` | `d date` |
| `rows[].uid, un, cc, cn, cid, cpf, nome, st` | colunas homônimas (text) |
| `rows[].rec, ven, av, vp` | `numeric(15,2)` |
| `rows[].pmp` | `numeric` |
| `rows[].parc` | `parc jsonb` |
| `chunk`, `updatedAt` | descartados (`criado_em` = `updatedAt` do chunk) |
| doc `_meta` (`lastDate`, `chunks`, `count`) | **não importado**: sai de `max(d)` / `count(*)` |

- Permissão: padrão `usuario_ativo()` (leitura e gravação). A fila de cobrança lê (`js/nucleo/app.js:10495`) e o Estoque
  comercial grava ao atualizar (`js/comercial/estoque-comercial.js:845`, `:2345`).
- Código: `js/financeiro/caixa-diario.js:166`, `:170`, `:180`, `:193`. Servidor: `api/_lib/estoque-batimento.js:492`, `:499`.
- RPCs: `gravar_caixa_posicao(data, linhas)` (apaga o dia e insere) e `listar_datas_caixa_posicao()`.
- Revisar: a amostra tem ~2.900 linhas/dia. Vale definir retenção (ex.: 90 dias), porque o Firestore nunca apagava.

### caixa_valor_receber → `caixa_valor_receber` + `caixa_valor_receber_itens` + `caixa_valor_receber_estado`
| Campo | Destino |
|---|---|
| doc `emp_<id>`: `companyId, ini, fim, origem, por, falhas, atualizadoEm` | `caixa_valor_receber` (`ini`/`fim` date; `atualizadoEm` → `atualizado_em`) |
| `itens` (string JSON) | `JSON.parse` → `caixa_valor_receber_itens` (`ccNome` → `cc_nome`, `vencimento` date, `valor` numeric) |
| doc `_estado`: `date, ini, fim, empresas, ei, fi, done, itens, falhas, lockAte` | `caixa_valor_receber_estado` (`itens` parseado → jsonb, `lockAte` ms → `lock_ate`) |

- Permissão: leitura **e gravação** com `fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')`. O botão Atualizar relê o Sienge
  e grava para todos (`caixa-diario.js:737`); não é edição.
- `caixa_valor_receber_estado`: **só servidor**. RLS ligada sem política (`api/_lib/morning-warmup.js:1217`, `:1231`, `:1272`).
- RPC: `gravar_caixa_valor_receber(registro, itens)`, que aceita `itens` como array ou como a string JSON atual.
  Servidor: `morning-warmup.js:1254`. Tela: `caixa-diario.js:651`.

### caixa_radar → `caixa_radar` (coleção vazia)
`ym, companyId, em, receber[], incerto[], pagar[]` → `ym`, `company_id`, `em`, `receber`/`incerto`/`pagar` jsonb.
id `<empresa>-<AAAA-MM>`. Permissão: leitura `fin_pode_ver`, gravação `sub_fin_cb_fluxo_caixa_diario_editar`.
Código: `caixa-diario.js:415`, `:450`.

### mutuo_execucoes → `mutuo_execucoes` + `mutuo_execucoes_centros` (coleção vazia)
| Campo | Destino |
|---|---|
| id `MUTUO_<AAAAMM>` / `ACERTO_<AAAAMM>`, `operacao`, `competencia`, `atualizadoEm` | `mutuo_execucoes` |
| `centros.<chave>` (mapa, gravado com merge por chave) | `mutuo_execucoes_centros` (único por `mutuo_execucoes_id` + `chave`) |
| `centros.*.numero, valor, emissao, descricao, rotulo, lancamentos, emitidoPor, emitidoEm, erroTitulo, pdfUrl, xlsxUrl, pdfNome, xlsxNome, billId, tituloDuplicado` | colunas snake_case; `emitidoEm` → timestamptz |

- Permissão: `sub_fin_cb_mutuo` (leitura) / `sub_fin_cb_mutuo_editar` (gravação, como em `mutuo.js:126`).
- Código: `js/financeiro/mutuo.js:684`, `:700` (merge), `:717`. Fase 3: upsert em `mutuo_execucoes` e upsert com
  `on_conflict=mutuo_execucoes_id,chave` em `mutuo_execucoes_centros`. Isso reproduz o merge do mapa.
- `emissao`: formato não confirmado (coleção vazia), por isso ficou `text`.

### mutuo_meta → `mutuo_meta` (coleção vazia)
Doc `notas_debito`: `ultima` (int), `por`, `atualizadoEm`. Código: `mutuo.js:333` (lê) e `:351` (gravava sem trava).
RPC `registrar_nota_debito_mutuo(numero, por)` só avança o número (`greatest`). Permissão: `sub_fin_cb_mutuo`.

### resultado_caixa → `resultado_caixa` (jsonb por documento)
| Campo | Destino |
|---|---|
| doc id `<slot>_<empresa>`, `ant-AAAA_<empresa>`, `fc-<AAAA-MM>` | `id` |
| `tipo` (`forecast`) | `tipo` (arquivos de resultado ficam `null`) |
| `slot, empresa, rotulo, nome, competencia, em, arquivos` | colunas (`empresa` int, `em` timestamptz, `arquivos text[]`) |
| `entradas, contas, contasPorCc, planosJson, nomes, porArquivo` | jsonb `entradas`, `contas`, `contas_por_cc`, `planos_json`, `nomes`, `por_arquivo` |
| `payload` (string JSON) ou `partes[]` → docs `__pN.texto` | concatenar → `JSON.parse` → espalhar nas colunas jsonb acima |

- `planosJson` é uma string JSON no Firestore e vira jsonb já parseado. A Fase 3 passa a gravar o objeto e a ler sem `JSON.parse`.
- Docs `tipo: "parte"` (`__pN`) **não** viram linha.
- Permissão: leitura `fin_pode_ver('sub_fin_cb_resultado_caixa')` **ou** `fin_pode_ver('sub_orc_geral_novo_orcamento')`,
  porque o DFC lê os forecasts em `orcamento-dfc.js:2053`. Gravação: `sub_fin_cb_resultado_caixa_editar`.
- Código: `js/financeiro/resultado-caixa.js:531`, `:554` (`where tipo == forecast`, com índice), `:1960`, `:1976`, `:2028`, `:2151`.
- Revisar: `carregarNuvem` também sobe o acervo local (`enviarAcervo`/`enviarPendentes`). Para quem só visualiza, essa
  gravação passa a ser negada (antes ninguém era barrado).

## Contas pagas e antecipações

### cfin_pagos → `cfin_pagos` + `cfin_pagos_bills`
| Campo | Destino |
|---|---|
| doc `<emp>_<AAAA-MM>`: `companyId, ym, n, em, ate, fechado` | `cfin_pagos` (`ate` date; `fechado` bool) |
| doc `_corte`: `ate, ymFechado, em` | linha `id='_corte'` com `company_id`/`ym` nulos, `ym_fechado` |
| `bills[]` (+ `<id>_pN.bills`) | `cfin_pagos_bills`: `dados` = objeto inteiro; colunas `bill_id, installment_id, creditor_id, creditor_name, document_identification_id` (sem espaços nas pontas), `document_number, due_date, issue_date, original_amount, balance_amount` |

- Permissão: leitura **e gravação** com `fin_pode_ver('sub_compras_geral_controle_financeiro')`. O cache é gravado ao
  consultar (`compras-controle-financeiro.js:1219`).
- Código: `js/compras/compras-controle-financeiro.js:1059`, `:1065`, `:1098`, `:1107`. Servidor: `api/_lib/morning-warmup.js:898`, `:904`,
  `:930`, `:975`.
- RPC: `gravar_cfin_pagos_mes(company_id, ym, bills, ate, fechado)`. O servidor usa service role.
- Fora desta área: o estado do cron fica em `sienge_defaulters_history/_cfin_state` (`morning-warmup.js:750`, `:854`), coleção da
  área de cobrança.

### antecipacoes_mes → `antecipacoes_mes` + `antecipacoes_mes_eventos`
| Campo | Destino |
|---|---|
| doc `AAAA-MM`: `mes, eventos, atualizadoEm, fonte, partes` | `antecipacoes_mes` (`id` = mês; `partes` descartado) |
| docs `AAAA-MM__pN.texto` (concatenar em ordem de N) | `JSON.parse` → um evento por linha |
| `k` | `antecipacoes_mes_eventos.id` |
| `tit, data, emp, empNome, cli, cliId, unid, cc, ccNome, doc, taxa, tipoJuros, parcelas, vf, vp, pago, descSienge, maxDias, minDias, juros, comercial, descTotal, np, faixa` | snake_case; `data` date; dinheiro numeric(15,2); `parcelas` jsonb (arrays compactos) |

- Na amostra, alguns docs só têm `texto` sem os campos do cabeçalho (são as partes) e 2 `texto` não são JSON
  válido sozinhos, porque são pedaços: concatenar antes de parsear.
- Permissão: leitura `fin_pode_ver('sub_fin_antec_antecipacoes')` (chave derivada de `sub_fin_antec` + `antecipacoes`,
  `config-users.js:481`; ela não aparece na amostra de perfis, então **conferir**). Sem política de gravação: só o servidor grava.
- Código: `js/financeiro/antecipacoes.js:108`, `:117`. Servidor: `lib/antecipacoes-batimento.js:65-91`.
- RPC: `substituir_antecipacoes_janela(ini, fim, eventos, fonte)`, só para service_role.
- Fora desta área: o estado do cron fica em `config/antecipacoes_batimento` (área núcleo/config).

## Pagadoria

### pagamento_lotes → `pagamento_lotes` + `pagamento_lotes_itens`
| Campo | Destino |
|---|---|
| `id` (= doc id) | `id` |
| `criadoPor, criadoPorEmail, criadoEm, total, contaKey, dia, empresaConta, dataBaixa` | `criado_por`, `criado_por_email` (minúsculo), `criado_em`, `total`, `conta_key`, `dia` (date), `empresa_conta`, `data_baixa` (date) |
| `conta.{id,nome,numero,agencia,banco}` | `conta_id, conta_nome, conta_numero, conta_agencia, conta_banco` |
| `cancelado, canceladoMotivo, canceladoEm` | `cancelado` (default false), `cancelado_motivo`, `cancelado_em` |
| `transferencias[]` | jsonb (3 de 122 docs; só exibido) |
| `sienge.{numero,status,geradoEm,geradoPor,erro,historico}` | `sienge_numero, sienge_status, sienge_gerado_em, sienge_gerado_por, sienge_erro` (vazio → null), `sienge_historico` jsonb |
| `itens[]` | `pagamento_lotes_itens`: `titulo, parcela, forma, linhaDigitavel, vencimento, valor, valorBruto, impostosRetidos, impostos, credorId, credor, companyId, ccs, conferencia, documento, valida(jsonb)` |

- Permissão: `sub_fin_cp_gerar_pagamento` (leitura) / `_editar` (gravação; `gerar-pagamento.js:3386`).
- Código: `js/financeiro/gerar-pagamento.js:303`, `:1449`, `:2285` (delete), `:3376` (grava o lote inteiro), `:3809` (delete).
- RPC: `salvar_pagamento_lote(lote)` faz upsert do cabeçalho e troca os itens. Para apagar, basta `delete` no cabeçalho
  (os itens saem em cascata).
- Fase 3: a leitura precisa remontar `lote.conta`, `lote.sienge` e `lote.itens` a partir das colunas (select com embed
  `pagamento_lotes_itens(*)`).

### cc_conta_parceria → `cc_conta_parceria`
`cc_id` → `cc_id` (e `id`); `conta.{id,banco,nome,agencia,numero}` → `conta_*`; `updatedAt` (ms) → `atualizado_em`;
`updatedBy` → `atualizado_por`. Se `conta` for `null`, todas as colunas `conta_*` ficam nulas.
- Permissão: leitura `usuario_ativo()`, porque o Gerar pagamento usa a conta via `CentrosCustoState` (`gerar-pagamento.js:526`).
  Gravação: `sub_cfg_apoio_centro_custo_editar`.
- Código: `js/financeiro/centros-custo.js:493`, `:505`, `:584`. Fase 3: a comparação `updatedAt >= conta_parceria_at`
  passa a usar `Date.parse(atualizado_em)`.

### sienge_creditors → `sienge_creditors`
| Campo | Destino |
|---|---|
| `id` | `id` (text) |
| `name, tradeName, cpf, cnpj, stateRegistrationNumber, stateRegistrationType, taxRegime, taxClassification` | snake_case text |
| `active` | boolean |
| `supplier, broker, employee` ('S'/'N') | **boolean** (`'S'` → true) |
| `paymentTypeId, taxRegimeId, taxClassificationId` | integer |
| `creationDate, lastModificationDate` | date |
| `address` (objeto), `phones`, `contacts`, `otherContactMethods`, `links` | jsonb |
| `_batimentoDate` | `batimento_date` (sem o `_` inicial) |

- Permissão: leitura `usuario_ativo()`, porque compras, jurídico, financeiro e Rydoo leem (`compras-previsoes.js:1709`,
  `parametrizacao-parceiro.js:2623`, `processo-contra.js:647`). Gravação **só servidor** (`api/_lib/sync-creditors.js:95-120`,
  `writeBatch` e limpeza por `_batimentoDate`).
- Fase 3: `sync-creditors` converte 'S'/'N' para boolean. O front (`rydoo.js` `employee === "S"` etc.) passa a testar `true`.
- O estado do cron (`sienge_sync_state/creditors`) fica com a área núcleo. A coleção legada `creditors` (fallback no código)
  não está no inventário.

## Prestação de contas Ellenco (participações)

### participacoes_credores → `participacoes_credores`
`credorKey` → `credor_key` (único); `credor`; `categoriaMl.{id,siengeId,label}` → `categoria_ml_id`,
`categoria_ml_sienge_id`, `categoria_ml_label`; `por`; `em` → timestamptz. O `id` continua `encodeURIComponent(credorKey)`.
- Permissão: `sub_part_geral_participacoes` / `_editar`. Código: `js/financeiro/participacoes.js:2341`, `:2423` (set/delete).

### participacoes_periods → `participacoes_periods` + `participacoes_periods_expenses`
| Campo | Destino |
|---|---|
| id `<companyId>_<closing>` | `id` (único também por `company_id, closing`) |
| `companyId, closing, fileName, saldoTotal, pdfUrl, pdfPath, cacheVer` | snake_case |
| `updatedBy` | `atualizado_por` |
| `updatedAtServer.iso` (ou `updatedAt` ms) | `atualizado_em` |
| `expenses[]` | `participacoes_periods_expenses`: `sourceFile, credor, categoria, categoriaId, valor, doc, periodo, detalhe, iso` |
| `expenses[].date` (DD/MM/AAAA) | **descartado**: é a mesma data de `iso`. O importador confere e, se divergir, guarda em `extra.date` |

- Permissão: `sub_part_geral_participacoes` / `_editar`. Código: `participacoes.js:275` (grava com merge, chamado em `:1594`),
  `:282` (`where companyId ==`, com índice pelo unique `company_id, closing`).
- RPC: `salvar_participacoes_period(period)`.
- `pdfUrl` aponta para o Firebase Storage: a migração dos arquivos (bucket `participacoes/…`) é outra etapa. Depois dela,
  reescrever `pdf_url`.

## Orçamento / DFC (contábil-gerencial)

### dfc_orcamento → `dfc_orcamento` + `dfc_orcamento_linhas`
Docs `2027`, `2027_v1` e `2027_v2`, com `fileName, savedAt (ms), year, n, payload | partes`. Linhas
`{e, enome, cc, en, conta, cn, obs, m[12]}` → colunas homônimas, com `m numeric(15,2)[]`.
- Permissão: `sub_orc_geral_novo_orcamento` / `_editar`. Código: `js/orcamento/orcamento-dfc.js:3271-3312`.
- RPC: `gravar_dfc_orcamento(id, file_name, saved_at, year, linhas)`. A Fase 3 mantém a conferência pós-gravação
  (`n` e `saved_at`).

### dfc_realizado → `dfc_realizado` + `dfc_realizado_itens`
Doc `c<empresa>`: `empresa, fim, ate, v, em, n` → colunas (`fim`/`ate` date). As linhas compactas `[gid, code, cc, i, v, ccn, cn]`
(de `payload` ou das partes `c<emp>__pN.texto` concatenadas) viram `dfc_realizado_itens`.
- Permissão: leitura **e gravação** com `fin_pode_ver('sub_orc_geral_novo_orcamento')`. É cache do Sienge gravado ao consultar
  (`orcamento-dfc.js:643-665`). Leitura em `:603`, `:611`.
- RPC: `gravar_dfc_realizado(empresa, fim, ate, itens)`, que aceita objeto ou array compacto.
- Na amostra, `c21` tem `n = 0` e não tem `ate`: importar assim mesmo (cabeçalho sem itens).

## Rydoo

### rydoo_arquivos → `rydoo_arquivos`
`fileName, importedAt, linhas, chaves[]` → `file_name`, `imported_at`, `linhas`, `chaves text[]`. O `id` legado é `Date.now()`
(mantido); novos ids saem de `gen_random_uuid()`. Código: `js/financeiro/rydoo.js:1759` (lê todas as chaves para
deduplicar) e `:1781`. Permissão: `sub_fin_cp_rydoo` / `_editar`.

### rydoo_meta → `rydoo_meta` (cache regenerável)
Doc `colaboradores`: `count`, `items` jsonb, `updatedAt` → `atualizado_em`. Código: `rydoo.js:1718`, `:1743`.
Permissão: leitura e gravação com `fin_pode_ver('sub_fin_cp_rydoo')` (é cache).

### rydoo_titulos → `rydoo_titulos`
id `<creditorId>_<MMAAAA>`: `competencia` = parte depois do primeiro `_`. Campos: `billId, pessoa, creditorId, documentNumber,
notes, total, bankSent, bankSentAt, emailSent, emailTo` → snake_case; `createdAt` → `criado_em`.
Código: `rydoo.js:1901`, `:1908` (delete), `:2600` (merge). Permissão: `sub_fin_cp_rydoo` / `_editar`.
O cron `api/_lib/rydoo-email.js` não lê nem grava estas coleções.

## Fiscal

### fiscal_notas_envio → `fiscal_notas_envio` (realtime)
| Campo | Destino |
|---|---|
| `fornecedor.{id,doc,nome}` | `fornecedor_id, fornecedor_doc, fornecedor_nome` |
| `cc.{id,nome}` | `cc_id, cc_nome` |
| `pagamento.{forma,data,detalhe,conta}` | `pagamento_forma`, `pagamento_data` (date), `pagamento_detalhe`, `pagamento_conta` (jsonb) |
| `previsao`, `anexos[]`, `historico[]` | jsonb |
| `criadoEm, assumidoEm, validadoEm, lancadoEm, devolvidoEm, atualizadoEm` (ms) | timestamptz (`criado_em`, `assumido_em`, …, `atualizado_em`) |
| `motivosCancelamento[]` | `text[]` |
| demais (`status, pedido, pedidoApi, empresa, numeroNota, serieNota, valorNota, valorPedido, observacao, criadoPor*, assumidoPor*, validadoPor*, lancadoPor*, seqSienge, billId, motivoDevolucao, devolucaoTipo, devolvidoPor, devolvidoPorSienge`) | snake_case |

- Listener: `js/fiscal/fiscal-enviar-nota.js:160`, `onSnapshot(orderBy("criadoEm","desc"), limit(400))`. Ele é compartilhado
  por Enviar nota (`:476`), Validar nota (`fiscal-inserir-nota.js:50`), Compras controle financeiro (`:2391`) e Previsões
  (`compras-previsoes.js:2934`). Vai para `supabase_realtime`; índice em `criado_em desc`.
- Permissão: leitura `usuario_ativo()`, porque Compras também ouve a fila. Gravação: `sub_fiscal_geral_enviar_nota_editar`
  **ou** `sub_fiscal_geral_inserir_nota_editar` (`fiscal-enviar-nota.js:506`, `fiscal-inserir-nota.js:105`).
- `anexos[].url` aponta para o Firebase Storage (`fiscal-notas/<id>/…`): reescrever depois da migração dos arquivos.

### fiscal_notas_aprendizado → `fiscal_notas_aprendizado`
`em` (ms) → timestamptz; `pedido, fornecedorId, fornecedorDoc, fornecedorNome, numeroNota, tipo, motivo` → snake_case;
`motivos[]` → `text[]`; `cartaLinhas[]` → jsonb. Código: `fiscal-enviar-nota.js:185` (grava), `:204` (`limit(120)`, sem
ordem; a Fase 3 pode ordenar por `em desc`). Permissão: leitura com enviar_nota **ou** inserir_nota; gravação
`sub_fiscal_geral_inserir_nota_editar` (quem devolve a nota, `fiscal-inserir-nota.js:1579`).

## Marketing

### marketing_budgets → `marketing_budgets`
`eventName, companyId, costCenterId, costCenterName, plannedValue, startDate, endDate, status, notes, createdBy` → snake_case
(`start_date`/`end_date` date); `createdAt` → `criado_em`; `updatedAt` → `atualizado_em`; `expenses[]` → jsonb (despesas do
evento, somadas e exibidas só no bloco do evento: `marketing.js:55`, `:292`). O id automático do Firestore é mantido; novos
ids saem de `gen_random_uuid()` (substitui `addDoc`, `marketing.js:132`). Código: `marketing.js:91`, `:129`, `:144`;
`marketing-budget.js:740`. Permissão: `sub_mkt_geral_budget` / `_editar`.

### marketing_budget_config → `marketing_budget_config`
Docs por centro de custo: `ccs[]` → `text[]`, `pct` → numeric. Doc `_categorias`: `ids[]` → `text[]`. `updatedAt`/`updatedBy` →
padrão. Código: `marketing-budget.js:247`, `:427`, `:446` (merge), `:3523`. Permissão: leitura com budget **ou** config;
gravação `sub_mkt_geral_config_editar` **ou** `sub_mkt_geral_budget_editar` (as duas telas gravam; **conferir**).

### marketing_budget_titulos → `marketing_budget_titulos` (cache de 30 min)
Doc `<cc>`: `start` → `inicio`, `end` → `fim` (`end` é palavra reservada), `savedAt` → `saved_at`. As partes `<cc>_<i>.texto`
são concatenadas e parseadas em `bills` jsonb. **Importador: pode pular**, porque o cache expira em 30 min
(`marketing-budget.js:16`, `:773`). Permissão: leitura e gravação com `fin_pode_ver('sub_mkt_geral_budget')`.
Código: `marketing-budget.js:780`, `:788`, `:819`, `:823`.

### marketing_budget_vendas → `marketing_budget_vendas` (cache)
Docs `<cc>_<AAAA-MM>`: `vendas[]`, `distratos[]` jsonb, `savedAt` → `saved_at`; `cc_id` e `ym` saem do id. O doc cabeçalho
`<cc>` (`meses[]`, `savedAt`) **não é importado**: a lista de meses vira `select ym from marketing_budget_vendas where cc_id = …`.
Código: `marketing-budget.js:1330`, `:1337`, `:1366`, `:1374`. Permissão: leitura e gravação com `fin_pode_ver('sub_mkt_geral_budget')`.

## Títulos incompletos

### titulos_incompletos_batimento → `titulos_incompletos_batimento`
Doc `atual`: `date` date, `at` timestamptz, `total`, `rows` jsonb, `primeiros` (string JSON → jsonb), `done`,
`lockAte` (ms; 0 → null) → `lock_ate`. Leitura `usuario_ativo()`, pelo aviso das 7h em `js/cobranca/titulos-incompletos.js:467`.
Gravação **só servidor** (`api/_lib/morning-warmup.js:1333`, `:1338`, `:1354`).

---

## RPCs

| Função | Substitui | Grant |
|---|---|---|
| `gravar_caixa_movimentos_mes(text, text, jsonb)` | `_gravarMesCaixa` (`sienge-api.js:2085`) | authenticated, service_role |
| `gravar_caixa_posicao(date, jsonb)` | `saveFromUnits` / `saveCaixaPosicao` | authenticated, service_role |
| `listar_datas_caixa_posicao()` | `listDates` | authenticated, service_role |
| `gravar_caixa_valor_receber(jsonb, jsonb)` | `atualizarVr` / `continuarValorReceber` | authenticated, service_role |
| `gravar_cfin_pagos_mes(text, text, jsonb, date, boolean)` | `_gravarMesPago` / `gravarMesPago` | authenticated, service_role |
| `substituir_antecipacoes_janela(date, date, jsonb, text)` | `runAntecipacoesBatimento` (ler/regravar mês) | **só service_role** |
| `salvar_pagamento_lote(jsonb)` | `setDoc(lote)` | authenticated, service_role |
| `salvar_participacoes_period(jsonb)` | `savePeriodToFirebase` | authenticated, service_role |
| `gravar_dfc_realizado(text, date, date, jsonb)` | `salvarRealizadoEmpresa` | authenticated, service_role |
| `gravar_dfc_orcamento(text, text, timestamptz, integer, jsonb)` | `salvarOrcamentoNuvem` | authenticated, service_role |
| `registrar_nota_debito_mutuo(integer, text)` | `gravarUltimaNd` | authenticated, service_role |

Todas são `security invoker` e `set search_path = ''`. Campos desconhecidos dos itens caem em `extra`.

## Tabelas só do servidor (RLS ligada, sem política de gravação)
- `caixa_valor_receber_estado`: sem nenhuma política.
- `antecipacoes_mes`, `antecipacoes_mes_eventos`, `sienge_creditors`, `titulos_incompletos_batimento`: só política de leitura.

## Notas para o importador (Fase 4)
1. **Juntar partes antes de tudo**:
   - `cfin_pagos` e `caixa_movimentos`: `<id>_pN`, com N ≥ 2 → itens do pai `<id>`, na ordem.
   - `antecipacoes_mes`: `<mes>__pN`, a partir de N = 0 → concatenar `texto`.
   - `dfc_realizado`, `dfc_orcamento` e `resultado_caixa`: `partes[]` → concatenar `texto` na ordem do array.
   - `marketing_budget_titulos`: `<cc>_<i>` → concatenar `texto`.

   Doc de parte nunca vira linha de cabeçalho.
2. **Ignorar docs auxiliares**: `caixa_posicao/_meta`, os cabeçalhos `<cc>` de `marketing_budget_vendas` e
   `marketing_budget_titulos` (cache).
3. **Linhas especiais**: `cfin_pagos/_corte` (`ym_fechado`), `caixa_movimentos/<emp>_base` (`ate`),
   `caixa_valor_receber/_estado` vai para outra tabela (`caixa_valor_receber_estado`).
4. **Conversões**:
   - epoch ms → `timestamptz`; `{"__tipo":"timestamp","iso":…}` → `iso`.
   - 'S'/'N' → boolean (`sienge_creditors`).
   - Strings JSON (`itens`, `primeiros`, `payload`, `planosJson`, `texto`) → `JSON.parse`.
   - `""` em campos date/numeric → `null`.
5. **Ordem de carga**: cabeçalho antes dos itens (FKs: `*_id` → pai). Os itens usam `identity`: não informar `id`.
6. Para as tabelas de itens, dá para usar as próprias RPCs com service role. Elas já fazem o mapeamento campo → coluna e
   aceitam o JSON do Firestore. Exceção: o `criado_em` original só é preservado com insert direto.
7. **Storage**: URLs do Firebase em `participacoes_periods.pdf_url`, `fiscal_notas_envio.anexos[].url` e
   `mutuo_execucoes_centros.pdf_url/xlsx_url` precisam ser reescritas depois da migração dos arquivos.

## Pontos para o dono revisar
- **Quem vê também grava** em caches preenchidos ao consultar (`cfin_pagos*`, `dfc_realizado*`, `caixa_valor_receber*`,
  `rydoo_meta`, `marketing_budget_titulos/vendas`). Isso mantém o comportamento atual; a alternativa é mover a gravação
  para o servidor.
- **`caixa_posicao` e `caixa_movimentos` gravados por qualquer usuário ativo**, como hoje no Firestore.
- **Chave `sub_fin_antec_antecipacoes`**: derivada da árvore de permissões e ausente na amostra de perfis.
- **`marketing_budget_config`** aceita gravação por budget_editar ou config_editar.
- **Retenção de `caixa_posicao`**: hoje cresce sem limite (uma foto por dia).
- **Visualizadores de `resultado_caixa`**: o upload automático do acervo local passa a falhar para quem não tem `_editar`.
- **Nomes curtos mantidos como coluna** (`d, uid, un, cc, cn, cid, rec, ven, av, vp, e, en, cn, gid, i, v`), pela regra
  "coluna = campo". Estão comentados na migration.
