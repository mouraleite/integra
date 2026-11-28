# Mapa de tabelas — engenharia / vistoria / comercial / orçamento de empreendimento

Migration: `supabase/migrations/202611191320_engenharia_comercial.sql`.
Inventário usado: `integra-export/inventario-amostra` (19/11/2026). Todas as coleções desta área têm menos de 200
documentos, então a amostra é a **coleção inteira** (os `check` de status foram feitos sobre 100% dos dados).

## Regras gerais desta área

- **Arquivos**: toda coluna `foto_*`, `*_path`, `*_paths` guarda o **caminho do objeto no bucket do Firebase**
  (ex.: `vistorias/qjrxRfazmOrufN0sg4ll/frente_1790000000000.jpeg`), nunca a URL. O importador extrai o caminho da
  URL `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<caminho codificado>?alt=media&token=...`:
  pegar o trecho entre `/o/` e `?` e aplicar `decodeURIComponent`. O primeiro segmento (`vistorias/`, `construcoes/`)
  é a pasta que vira bucket no Supabase. URL que não for do Firebase Storage: manter em `extra.urls_externas`
  (não ocorreu na amostra). Campos `*Url`/`*Urls` foram renomeados para `*_path`/`*_paths` para o nome não mentir.
- **Ids**: `id text` = id do documento do Firestore. Coleções criadas com `addDoc` ganharam
  `default gen_random_uuid()::text` para o código novo não precisar gerar id.
- **Datas**: Timestamp do Firestore (`{"__tipo":"timestamp","iso":...}`), ISO texto e epoch ms → `timestamptz`;
  `AAAA-MM-DD` → `date`. String vazia → `null`.
- **createdAt/updatedAt/criadoEm/criado_em** → colunas padrão `criado_em`/`atualizado_em`. O importador deve
  informar os dois valores explicitamente (o trigger só mexe em `atualizado_em` no UPDATE, não no INSERT).
  Sem valor na origem: `criado_em` = `atualizado_em` = horário da carga.
- **Campos fora do mapa**: qualquer campo do doc que não tenha coluna vai para `extra` com o nome original (camelCase).
- **Funções de apoio** (schema `privado`, prefixo `engcom_` para não colidir com as outras áreas):
  `engcom_tem_alguma(variadic chaves)` (true se tiver qualquer uma das chaves; admin sempre), e conversões
  tolerantes `engcom_data/ts/num/bool` usadas pelas RPCs.

## Pastas do Firebase Storage desta área (criar buckets depois)

| Pasta (bucket) | Quem grava | Caminho | Onde |
|---|---|---|---|
| `vistorias/` | link do WhatsApp e app do vistoriador (cliente sem login no link!) | `vistorias/<vistoriaId>/frente_<ts>.jpeg`, `meio_fundo_<ts>.jpeg`, `fundo_frente_<ts>.jpeg` | js/engenharia/vistoria.js:556, 563, 570 |
| `vistorias/` | (leitura: `listAll` da pasta da vistoria) | `vistorias/<vistoriaId>/` | js/engenharia/verificar-construcao.js:2313, js/engenharia/construcao.js:411 |
| `construcoes/` | aba Construção da ficha do cliente | `construcoes/<customerId>/<ts>_<nome sanitizado>` | js/engenharia/construcao.js:439 |

Observações: o código **lista a pasta** `vistorias/<id>` para achar as fotos (não confia só nos campos) — o bucket
precisa permitir `list` por prefixo. O link do cliente faz upload **sem login**: no Supabase isso exige upload
assinado emitido pelo servidor (ver "Dúvidas"). `solicitacoes_producao.prints` hoje não tem upload no código.

---

## vistorias → `public.vistorias`

76 docs. Pedidos de vistoria do lote: criados pela ficha (status `solicitada`), pela tela Vistoria (link do
WhatsApp, `aguardando_fotos`) ou atribuídos ao app do vistoriador; o cliente/vistoriador envia fotos
(`aguardando_validacao`); o back office valida (`concluida`) e gera um `construction_checks`.

| Campo | Coluna | Transformação |
|---|---|---|
| id do doc | `id` | — |
| `status` | `status` | check: solicitada, aguardando_fotos, aguardando_validacao, concluida |
| `customerId` (int 57 / texto 19) | `customer_id` text | `String()` |
| `contractId` (int/texto) | `contract_id` text | `String()` |
| `contractKeys` | `contract_keys` text[] | cada item `String()`; ausente → `{}` |
| `titulo` (int/texto) | `titulo` text | `String()` |
| `tituloKey` (int/texto) | `titulo_key` text | `String()` |
| `clienteName` | `cliente_name` | — |
| `cidade`, `empreendimento`, `unidade` | idem | — |
| `costCenterId` (int/texto) | `cost_center_id` text | `String()` |
| `companyId` | `company_id` | — |
| `loteCoords` | `lote_coords` jsonb | `{lat,lng}`; null (62 docs) → null |
| `fotoFrente`, `fotoMeioFundo`, `fotoFundoFrente` | `foto_frente`, `foto_meio_fundo`, `foto_fundo_frente` | **URL → caminho** do Storage |
| `respostasFormulario` | `respostas_formulario` jsonb | exibido em bloco |
| `enviadoEm` (Timestamp) | `enviado_em` | timestamptz |
| `linkEnviadoEm` | `link_enviado_em` | ISO → timestamptz |
| `closedBy`, `closedAt` | `closed_by`, `closed_at` | ISO → timestamptz |
| `requestedBy`, `requestedByEmail`, `requestedByBackOffice`, `requestedAt` | `requested_by`, `requested_by_email`, `requested_by_back_office`, `requested_at` | — |
| `origem` | `origem` | — |
| `app.responsavelEmail/responsavelNome/atribuidoEm/atribuidoPor` | `app_responsavel_email`, `app_responsavel_nome`, `app_atribuido_em`, `app_atribuido_por` | objeto achatado; `atribuidoEm` ISO → timestamptz |
| `isTest` | `is_test` | ausente → false |
| `createdAt` (Timestamp 62 / ISO 14) | `criado_em` | timestamptz |
| `updatedAt` | `atualizado_em` | ISO; ausente → `criado_em` |
| outros (`saleId`, `realSaleId`, `contractNumber`, `saleCode`, `billIds`, `unitName`, e os campos de `checkData` gravados pela edição — ver abaixo) | `extra` | — |

- **Doc grande?** Não (máx. 1,3 KB).
- **Permissão**: padrão (usuário ativo) em select/insert/update/delete. Motivo: a coleção é usada pela ficha de
  qualquer cliente (aba Construção, botão "Solicitar vistoria"), pela fila de cobrança (sinais de obra/álbum,
  app.js), pela tela Vistoria (`sub_vistoria_geral_vistoria_*`) e pelo app do vistoriador. Revisar se o dono quer
  restringir a exclusão a `sub_vistoria_geral_vistoria_editar`.
- **Listeners**: `onSnapshot` status != concluida (js/engenharia/verificar-construcao.js:967);
  status == aguardando_validacao (verificar-construcao.js:2749) → **realtime ligado**.
- **Consultas**: status != concluida (verificar-construcao.js:188, 2772); status == aguardando_validacao (2639);
  customerId/tituloKey/titulo == (construcao.js:604-619); contractId == (construcao.js:1304);
  `app.responsavelEmail` == (vistoria-app/app.js:95); leitura total (app.js:40263); por id (vistoria.js:62).
  Índices criados para todos (+ GIN em `contract_keys`).
- **Escritas**: addDoc (verificar-construcao.js:1980, 2102; construcao.js:1360); updateDoc (verificar-construcao.js:196,
  1572, 2000, 2123, 2413; construcao.js:760, 1585; vistoria.js:585); deleteDoc (construcao.js:1654).
- **Sem transação**. RPC nova `public.enviar_vistoria(id, respostas, foto_frente, foto_meio_fundo, foto_fundo_frente)`
  substitui o updateDoc de vistoria.js:585 e só aceita vistoria ainda aberta (não reabre concluída).
- **Atenção Fase 3**: construcao.js:1585 faz `updateDoc` em `vistorias` com o objeto `checkData`
  (date, responsible, stage, observations, fileUrl, fileUrls, fileNames, sendToSienge, siengeSent...). Esses campos
  **não têm coluna** em `vistorias`: o código novo deve gravá-los em `extra` (com `extra || patch`) ou criar o
  registro em `construction_checks`. Nenhum doc atual tem esses campos.
- **Importador**: tipos mistos → texto; `createdAt` pode ser Timestamp ou ISO; extrair caminhos das 3 fotos.

## vistoria_avisos → `public.vistoria_avisos`

Coleção vazia; desenhada pelo código (verificar-construcao.js:2415, 3358, 3370). Aviso ao solicitante da ficha
quando a vistoria é validada.

| Campo | Coluna | Transformação |
|---|---|---|
| `vistoriaId` | `vistoria_id` | FK `vistorias(id)` on delete cascade |
| `email` | `email` | minúsculo (check) |
| `nome`, `clienteName`, `unidade`, `empreendimento`, `cidade`, `titulo` | `nome`, `cliente_name`, ... | — |
| `respostasFormulario` | `respostas_formulario` jsonb | — |
| `fotoFrente/MeioFundo/FundoFrente` | `foto_*` | URL → caminho |
| `visto`, `vistoEm` | `visto`, `visto_em` | — |
| `createdAt` | `criado_em` | — |

- **Permissão**: dado pessoal → dono = `email` = e-mail do JWT (`auth.jwt() ->> 'email'`); admin vê tudo. Qualquer
  usuário ativo cria (quem valida cria o aviso para outra pessoa). Só admin apaga.
- **Listener**: `onSnapshot` where email == (verificar-construcao.js:3370) → **realtime ligado**. Índice (email, visto).
- **Importador**: nada a importar.

## vistoria_batimento → `public.vistoria_batimento`

Coleção vazia hoje; escrita pelo cron (api/_lib/painel-diario.js:218-246: `<data>_p<i>` com `data` = JSON string e
`_meta` {date, parts, total}); lida em verificar-construcao.js:1221-1240.

- **Decisão (doc grande)**: **cache regenerável**. Uma linha por dia: `id` = `date` = 'AAAA-MM-DD',
  `clientes` jsonb = concatenação dos arrays dos shards, `total`. O `_meta` e os shards somem: a tela lê
  `select clientes from vistoria_batimento where date = hoje`.
- **Permissão**: select padrão; escrita só service role (sem política).
- **Importador**: nada (regenera no próximo cron). Fase 3: o cron pode apagar dias antigos.

## construction_checks → `public.construction_checks`

99 docs. Registros de estágio da construção do lote (manuais na aba Construção ou gerados ao validar a vistoria).

| Campo | Coluna | Transformação |
|---|---|---|
| `customerId`, `contractId`, `tituloKey`, `companyId` | `customer_id`, `contract_id`, `titulo_key`, `company_id` | texto |
| `contractKeys` | `contract_keys` text[] | ausente → `{}` |
| `costCenterId` (texto 61 / int 1) | `cost_center_id` | `String()` |
| `cidade`, `empreendimento`, `unidade` | idem | — |
| `vistoriaId` | `vistoria_id` | sem FK (pode apontar para vistoria apagada) |
| `date` | `date` | 'AAAA-MM-DD' → date |
| `responsible`, `stage`, `observations` | idem | — |
| `detailsText` | `details_text` | — |
| `fileUrl` (null em 3) | `file_path` | **URL → caminho** |
| `fileName` | `file_name` | — |
| `fileUrls` | `file_paths` text[] | cada URL → caminho (aponta para `vistorias/` e `construcoes/`) |
| `fileNames` | `file_names` text[] | — |
| `fotoFrente/MeioFundo/FundoFrente` | `foto_*` | URL → caminho |
| `sendToSienge`, `siengeSent`, `siengeError` | `send_to_sienge`, `sienge_sent`, `sienge_error` | — |
| `siengeSentUrls` (no código, não na amostra) | `sienge_sent_paths` text[] | URL → caminho |
| `createdAt`, `updatedAt` | `criado_em`, `atualizado_em` | ISO |

- **Permissão**: padrão (aba Construção da ficha de qualquer cliente + Vistoria + fila).
- **Consultas**: customerId == (texto e número; construcao.js:1698-1699, 604-619) → no Postgres basta texto;
  leitura total (verificar-construcao.js:2793; app.js:40274). Sem listener, sem transação.
- **Escritas**: addDoc (construcao.js:1588; verificar-construcao.js:2484), updateDoc (construcao.js:1585), deleteDoc (1654).

## engenharia_acompanhamento → `public.engenharia_acompanhamento`

1 doc (`obras`) com `linhas` (7 itens) e `savedAt` (epoch ms).

- **Decisão**: o array vira **uma linha por empreendimento** (o código busca por id do CC: app.js:9725,
  previsao-obras.js). `historico` (versões anteriores, só exibidas) fica em jsonb.

| Campo (linhas[]) | Coluna | Transformação |
|---|---|---|
| `id` | `id` | centro de custo |
| `nome` | `nome` | — |
| `infra`, `lazer`, `cliente`, `tvoCliente`, `lo`, `tvoContrato` | `infra`, `lazer`, `cliente`, `tvo_cliente`, `lo`, `tvo_contrato` | 'AAAA-MM-DD' → date; "" → null |
| `inseridoEm` (epoch ms) | `inserido_em` | timestamptz |
| `historico` | `historico` jsonb | ausente → `[]` |
| `savedAt` (do doc) | `atualizado_em` de todas as linhas | epoch ms → timestamptz |

- **Permissão**: select padrão (lido por Relacionamento > Previsão de obras e cancelamento); escrita
  `sub_eng_geral_acompanhamento_editar` (mesma checagem de engenharia-acompanhamento.js:38).
- **Fase 3**: o código regrava a lista inteira (setDoc, engenharia-acompanhamento.js:246); trocar por upsert da linha
  editada e delete da excluída. "Versão da nuvem" = `max(atualizado_em)`.

## caucao_base → `public.caucao_base`, `public.caucao_base_controle`, `public.caucao_base_ajustes`

5 docs: `2026-11-18_0` (rows da base do dia), `_meta`, `_passado`, `_passado_0`, `_ajustes` (mapa com 61 chaves).

- **Decisão (doc grande, até 57 KB)**: as bases (`<data>_<n>` e `_passado_<n>`) são **cache regenerável** (rotina das
  06:30 lê o Sienge): uma linha por base em `caucao_base` com `rows` jsonb (concatenação dos chunks). `id` = data
  ('2026-11-18', `tipo`='dia') ou 'passado' (`tipo`='passado'; `start_date`, `end_date`, `corte`, `count`, `gerado_em`).
- `_meta` → `caucao_base_controle` (linha única id '_meta'): `date`, `count`, `running`, `running_at` (runningAt),
  `done`, `gerado_em`, `range.startDate/endDate` → `range_start_date/range_end_date`, `erro`, `erro_em`;
  `prazo`, `planejadas`, `prorrogadas`, `adiadas`, `falhas`, `vencidasRetidas`, `leituraMs`, `totalMs`, `chunks` → `extra`.
- `_ajustes` → `caucao_base_ajustes`: **uma linha por chave** (`id` = 'titulo|parcela', `titulo`, `parcela`
  = split no `|`, `vencimento` date, `at` → `ajustado_em`). É dado digitado pelo usuário (não regenerável).
- **Permissão**: tela Gestão de caução. Leitura/gravação da base: qualquer uma de `sub_eng_geral_caucao_{acessar,visualizar,editar}`
  ou `sub_eng_geral_engenharia_{acessar,visualizar,editar}` (app.js:5598 faz a chave da caução herdar da engenharia).
  Ajustes: grava com `sub_eng_geral_caucao_editar` ou `sub_eng_geral_engenharia_editar`. Controle: só leitura pela
  tela; escrita só service role.
- **Transação**: `runTransaction` em `_meta` (lib/caucao-batimento.js:290) → RPC
  `public.travar_caucao_batimento(p_hoje, p_forcar, p_simular, p_trava default 4 min)` retorna
  `{resultado: 'rodando'|'feito'|'ok', anterior}`; só `service_role`.
- **Leituras**: engenharia-caucao.js:956-993 (passado), 1136 (_meta), 1174 (base do dia), 1187/1205 (_ajustes).
  Escritas do servidor: lib/caucao-batimento.js:228-269, 409.
- **Importador**: importar `_ajustes` (61 linhas). As bases podem ser importadas (concatenar `rows` dos chunks em
  ordem de `chunk`) ou deixadas para o próximo cron; `_meta` → 1 linha com `running=false`.

## estoque_comercial → `public.estoque_comercial` (unidades) e `public.estoque_comercial_controle`

76 docs (15 MB): `cc_<cc>_<n>` (73 docs, array `units`, até 634 KB, total **11.993 unidades**, ids únicos),
`_meta`, `_batimento_state`, `_conferencia_geral`.

- **Decisão (doc grande)**: **uma linha por unidade**. Motivo: o código busca/filtra item a item — por empreendimento
  (marketing-budget.js:325-345 lê só `cc_<id>_*`), por `pmp3m` (app.js:10509), por `commercialStock`/contrato
  (comercial.js:1165, caixa-diario.js:144), por `id` da unidade (estoque-comercial.js:683, dedupe por `updatedAt`).
  O shard (`chunk`, `cc_<cc>_<n>`) some.

| Campo (units[]) | Coluna | Transformação |
|---|---|---|
| `id` (número) | `id` text | `String()` |
| `enterpriseId` | `enterprise_id` | ausente → `enterpriseId` do doc |
| `enterpriseName`, `name` | `enterprise_name`, `name` | — |
| `commercialStock`, `legalStock`, `buildingStock` | `commercial_stock`, `legal_stock`, `building_stock` | V/T/R/D/L/P; legal/building sempre "" |
| `area` | `area` numeric | — |
| `contractId` (número/null), `contractNumber` | `contract_id`, `contract_number` | texto |
| `contractValue` | `contract_value` numeric(15,2) | arredonda 2 casas |
| `situation` | `situation` | "", Emitido, Cancelado |
| `customerId` (número/texto), `customerName`, `customerDoc` | `customer_id`, `customer_name`, `customer_doc` | texto |
| `receivableBillId` (número/texto/null) | `receivable_bill_id` | texto |
| `relFin` | `rel_fin` | quitado/adimplente/inadimplente/distratado |
| `quitado`, `quitadoEvidencia` | `quitado`, `quitado_evidencia` | — |
| `quitacaoDate` | `quitacao_date` | date |
| `quitacaoValor`, `quitacaoRecebido` | `quitacao_valor`, `quitacao_recebido` | numeric(15,2) |
| `quitacaoFonte` | `quitacao_fonte` | — |
| `receivedLocked`, `statementDone`, `carteiraCt` | `received_locked`, `statement_done`, `carteira_ct` | — |
| `censusAt` ('AAAA-MM-DD') | `census_at` | date |
| `finAt`, `filaAt`, `extratoAt`, `siengeConferidoEm` | `fin_at`, `fila_at`, `extrato_at`, `sienge_conferido_em` | ISO → timestamptz |
| `kpiAVencer`, `kpiVencidas`, `kpiLiquido`, `kpiPago`, `kpiAcrescimo`, `kpiDesconto` | `kpi_a_vencer`, ... | numeric(15,2) |
| `presentDebitBalance`, `receivedAmount`, `outstandingBalance` | idem snake | numeric(15,2) |
| `pmp3m` | `pmp3m` numeric | — |
| `openParcelas` | `open_parcelas` jsonb | exibido em bloco |
| `distratoData`, `distratoTitulo` | `distrato_data` date, `distrato_titulo` | — |
| `tituloInexistente` e qualquer outro | `extra` | — |
| doc: `date` | `date` | data de gravação do chunk |
| doc: `updatedAt` | `atualizado_em` | ISO |

- `_meta`, `_batimento_state`, `_conferencia_geral` → `estoque_comercial_controle` (`id` = id do doc, `dados` = doc
  inteiro). São estado de rotina, lidos/mesclados como objeto.
- **RPCs**: `public.substituir_estoque_comercial_cc(p_enterprise_id, p_unidades jsonb)` recebe o array `units` no
  formato atual (camelCase), faz upsert e apaga as unidades do CC que não vieram (substitui setDoc dos chunks +
  deleteDoc dos sobrando: estoque-comercial.js:744-776, 855-875; api/_lib/estoque-batimento.js:472-482).
  `public.mesclar_estoque_comercial_controle(p_id, p_patch, p_substituir)` = `setDoc(..., {merge:true})`.
- **Permissão**: padrão em tudo (ver Dúvidas). Sem listener, sem transação.
- **Fase 3**: `saveFirebase` (gravação total) = chamar a RPC por CC e depois apagar CCs que não estão mais no estado
  (`delete from estoque_comercial where enterprise_id <> all(:ccs)`). Para devolver o formato `units[]` ao front,
  montar o objeto camelCase a partir das colunas + `extra` (nulos podem ser omitidos).
- **Importador**: ler os docs `cc_*` por streaming (arquivo de 15 MB), gerar uma linha por unidade; em caso de id
  repetido entre chunks vale o doc com `updatedAt` maior (mesma regra de estoque-comercial.js:683). Os 3 docs `_*`
  vão inteiros para `estoque_comercial_controle.dados`.

## comercial_batimento → `public.comercial_batimento`

Coleção vazia hoje; escrita pelo cron (api/_lib/painel-diario.js:90-165, 249-310): docs 'AAAA-MM' com
`vendas`/`distratos` como **strings JSON**, `splitVendas`, `parts`, shards `<id>_p<i>`, `<id>_parts`, `_state`, `_meta`.
Lida em js/comercial/comercial.js:246-275.

- **Decisão**: **cache regenerável**. Uma linha por mês (`id`='AAAA-MM', `ano`, `mes`, `vendas` jsonb já
  concatenado dos shards, `distratos` jsonb — sem `JSON.stringify`). `_meta` e `_state` ficam como linhas com `dados`.
  Shards somem.
- **Permissão**: select padrão; escrita só service role.
- **Importador**: nada.

## tabelas_vigentes → `public.tabelas_vigentes`

24 docs (máx. 2,4 KB).

| Campo | Coluna | Transformação |
|---|---|---|
| id do doc (= campo `id`) | `id` | o campo `id` repetido no doc é descartado |
| `enterpriseId`, `enterpriseName` | `enterprise_id`, `enterprise_name` | — |
| `city`, `cityId` | `city`, `city_id` | — |
| `competencia` | `competencia` text | 'AAAA-MM' (check) |
| `rows` | `rows` jsonb | 154 linhas no total; editadas/exibidas em bloco |
| `createdAt`, `updatedAt` | `criado_em`, `atualizado_em` | ISO |

- **Permissão**: select padrão (lido pelo Orçamento: orcamento-modulo.js:1248); escrita
  `sub_com_geral_tabelas_vigentes_editar`.
- **Uso**: getDocs total (tabelas-vigentes.js:532), setDoc (552), deleteDoc (564). Sem listener. Índice
  (enterprise_id, competencia).

## orcamento_empreendimento → `public.orcamento_empreendimento`

1 doc (`14100`) + `_padrao` previsto no código.

| Campo | Coluna | Transformação |
|---|---|---|
| id do doc | `id` | CC ou '_padrao' |
| `ccId`, `companyId` | `cc_id`, `company_id` | — |
| `anoDe`, `anoAte` | `ano_de`, `ano_ate` | integer |
| `distratos`, `vendasQtd` | `distratos`, `vendas_qtd` jsonb | `{"AAAA": [12]}` |
| `planos`, `condicoes` | `planos`, `condicoes` jsonb | — |
| `em` | `em` timestamptz | também usado em `atualizado_em` |

- **Decisão**: documento de plano lido e gravado inteiro → jsonb nas partes em bloco.
- **Permissão**: leitura `sub_orc_geral_novo_orcamento_{acessar,visualizar,editar}`; escrita `..._editar`.
- **Uso**: orcamento-modulo.js:479 (lista), 582 (delete), 819 (get), 859 (set), 1002/1054 (_padrao, merge).

## orcamento_receita → `public.orcamento_receita`

1 doc (`14100`, 81 KB).

- **Decisão**: resultado calculado, lido inteiro (orcamento-modulo.js:2972) → totais em colunas, partes em jsonb
  (`grade`, `porAno`→`por_ano`, `subMes`→`sub_mes`, `jurosMes`→`juros_mes`, `indices`, `clientes`).
  `total`, `principal`, `reajuste`, `fora`, `antes`, `subJudiceValor`, `parcelaMedia` → numeric(15,2);
  `subJudice` → integer; `parcelasMedia` → numeric; `anoDe/anoAte` → integer; `em` → timestamptz.
- **Permissão**: igual a orcamento_empreendimento.
- **Uso**: setDoc (2946; se falhar regrava sem `clientes`, 2952), deleteDoc (583).

## orcamento_forecast → `public.orcamento_forecast`

1 doc (`emp_13`).

| Campo | Coluna | Transformação |
|---|---|---|
| id `emp_<companyId>` | `id` + `company_id` | `company_id` = id sem o prefixo `emp_` |
| `atual` | `atual` integer | — |
| `versoes` | `versoes` jsonb | bloco |
| `savedAt` (epoch ms) | `saved_at` timestamptz | — |

- **Permissão**: leitura `sub_orc_geral_novo_forecast_{acessar,visualizar,editar}`; escrita `..._editar`.
- **Uso**: orcamento-forecast.js:127 (setDoc), 141 (getDoc).

## tag_solicitacoes → `public.tag_solicitacoes`

9 docs. Campos já em snake_case: mapeamento 1:1 (`tag_name`, `reason`, `type`, `status`, `solicitado_por_email`,
`solicitado_por_nome`, `parecidas` jsonb, `motivo_decisao`, `decidido_por_email`, `decidido_por_nome`,
`decidido_em` ISO → timestamptz, `aviso_visto`, `tag_criada`, `destino_final`); `criado_em` (ISO) → `criado_em`.

- **Permissão**: select/insert padrão (o solicitante consulta pendentes para não repetir, anexos.js:4786);
  update: `sub_cfg_apoio_tags_editar` (administrador e back office têm) **ou** o próprio solicitante
  (`solicitado_por_email` = e-mail do JWT, para marcar `aviso_visto`); delete: admin.
- **Listeners**: status == Pendente (config-tags.js:537) e solicitado_por_email == (553) → **realtime ligado**.
- **Fase 3**: aprovar cria registro em `tags` (outra área, config-tags.js:672) e atualiza a solicitação.

## solicitacoes_producao → `public.solicitacoes_producao`

3 docs.

| Campo | Coluna | Transformação |
|---|---|---|
| `ambiente`, `ambienteNome`, `branch`, `sha`, `shaMain` | `ambiente`, `ambiente_nome`, `branch`, `sha`, `sha_main` | — |
| `versaoBase` | `versao_base` integer | — |
| `descricao`, `comoTestar`, `motivo`, `versao` | `descricao`, `como_testar`, `motivo`, `versao` | — |
| `telas`, `telasNomes` | `telas`, `telas_nomes` text[] | — |
| `abas` | `abas` jsonb | — |
| `solicitante.email` / `.nome` | `solicitante_email` / `solicitante_nome` | objeto achatado (filtro `where solicitante.email`) |
| `status` | `status` | pendente/aprovado/recusado/publicado (sem check) |
| `avisoVisto`, `avisoVistoEm` (epoch ms) | `aviso_visto`, `aviso_visto_em` | — |
| `semAlteracoesCodigo` | `sem_alteracoes_codigo` | — |
| `prints`, `arquivos`, `commits`, `totais`, `testes`, `publicacoesParciais` | jsonb | — |
| `decididoPor`, `decididoPorEmail`, `decididoEm` (epoch ms) | `decidido_por`, `decidido_por_email`, `decidido_em` | — |
| `publicadoEm` (epoch ms) | `publicado_em` | — |
| `criadoEm` (epoch ms) | `criado_em` | — |

- **Permissão**: select/insert padrão; update: admin ou o solicitante; delete: admin. `api/_lib/publicar.js:156`
  lê pela REST do Firestore → no Supabase, ler com a service role.
- **Listeners**: `solicitante.email` == (aviso-develop.js:941), status == pendente (1055) → **realtime ligado**.
  Consulta ambiente == (835). Escritas: addDoc/updateDoc (914-915, 1012, 1178, 1208).

---

## Não mapeado aqui (outras áreas / sem dados)

- `config_stages/construction` (construcao.js:15, 33 — lista de estágios da construção): coleção não está no
  inventário; deve ir para `public.configuracoes` (núcleo).
- `config/vistoria_recorrencia` e chaves de `config/global` usadas pela Vistoria (verificar-construcao.js:298-345,
  984-1031, 1831 — há `runTransaction` em `config/global`, 345): núcleo/config.
- `kmz_coordinates` (vistoria.js:231), `config/crm_users` (vistoria-app/app.js:85), `caixa_posicao` e
  `sienge_defaulters_history` (gravados pelo estoque): outras áreas.

## Dúvidas / decisões para o dono revisar

1. **Link público da vistoria (cliente sem login)**: hoje vistoria.html lê/grava `vistorias` e sobe fotos sem
   autenticação. Pela convenção (nunca `anon`) não criei acesso anônimo. Proposta: rota do servidor
   (`/api/vistoria-link`) com a service role que lê as vistorias pelos ids do link, emite upload assinado para
   `vistorias/<id>/` e chama `public.enviar_vistoria`. O app do vistoriador (logado) chama a RPC direto.
2. **Estoque com permissão padrão**: a tela grava o cache ao abrir e o Caixa diário chama `EstoqueComercialApp.init()`;
   restringir a escrita a `sub_com_geral_estoque_*` pode quebrar quem não tem a chave. Revisar.
3. **Orçamento e tabelas vigentes exigem `_editar` para gravar**; o front hoje não checa `_editar` (só o acesso à tela).
   Quem só tem `_acessar` vai cair em "salvo neste navegador". Confirmar nos perfis.
4. `vistorias`/`construction_checks` com acesso padrão inclusive para apagar (aba Construção da ficha).
5. Checks de status em `vistorias` e `tag_solicitacoes` cobrem 100% dos dados atuais; `solicitacoes_producao.status`
   ficou sem check.
6. `construction_checks.vistoria_id` sem FK (registros podem apontar para vistoria apagada); `vistoria_avisos`
   tem FK com cascade.
