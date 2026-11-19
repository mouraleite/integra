# Mapa de tabelas — cobrança / clientes / relacionamento / jurídico

Migration: `supabase/migrations/202611191310_cobranca_juridico.sql`.
Regras gerais em `supabase/CONVENCOES.md`. Amostra usada: `integra-export/inventario-amostra` (até 200 docs/coleção).

## Regras comuns para o importador (Fase 4)

- **Colunas padrão**: `extra` recebe todo campo do doc que não tem coluna (nada se perde). `criado_em` = `createdAt`/`created_at`/`date`
  do doc quando existir (senão `now()`); `atualizado_em` = `updatedAt`/`updated_at` quando existir.
- **Datas**: ISO com hora / Timestamp do Firestore / epoch ms → `timestamptz`; `AAAA-MM-DD` ou `DD/MM/AAAA` → `date`.
  String vazia `""` → `null`. Data sem fuso (`"2026-04-02 16:02:07.453"`) → interpretar em `America/Sao_Paulo`.
- **Ids numéricos** (`saleId: 10306`, `contractId`, `receivableBillId`) → texto (`String(v)`).
- **Texto JSON** (`"[...]"` gravado como string) → `JSON.parse` para `jsonb`; se não parsear, gravar a string como jsonb e registrar.
- **Dinheiro** → `numeric(15,2)` (arredonda floats como `3994607.629999998` → `3994607.63`). Percentuais ficam `numeric` sem escala.
- Tabelas com upsert por lista usam RPC (abaixo); a carga pode inserir direto com a service role.
- O id gerado pelo Firestore (`addDoc`) é mantido em `id text`.

## RPCs (substituem `runTransaction` e "grava a lista inteira")

| Função | Substitui | Observação |
|---|---|---|
| `salvar_notas_cliente(customer_id, notas jsonb, remover text[])` | `saveNotesToFirebase` (app.js:8359; `runTransaction` em app.js:8409) | Upsert por `id`; em conflito só troca se o carimbo (promiseStatusAt → updatedAt → lastEdit.date) for ≥ o gravado; `remover` = ids apagados (`dropIdentities`). Devolve a lista do cliente. |
| `salvar_notas_juridicas(customer_id, notas, remover)` | `saveJudNotesToFirebase` (app.js:8619) | Mesmo contrato; carimbo = lastEdit.date. |
| `salvar_nex_letters(doc_id, customer_id, titulo, itens)` | `saveNexHistory` (app.js:38753) | Substitui as cartas do `<cliente>_<título>`; lista vazia apaga. |
| `salvar_processos_contra_motivos(itens)` | `salvarCatalogo` (processo-contra.js:1631) | Troca o catálogo inteiro. |
| `substituir_registro_cadastro(arquivo, quando, por, linhas)` | `gravarRemoto` (registro.js:67) | Ficha + linhas numa transação só. Recebe as linhas com as chaves originais (`empresaId`…). |

As listas `notas`/`itens` vão com as chaves já em snake_case (nomes das colunas). Funções `security invoker`: a RLS vale.
`privado.carimbo_nota()` é a função auxiliar do carimbo.

## Chaves de permissão usadas

Catálogo em `js/nucleo/config-users.js:420-560` (permBase + `_acessar` / `_visualizar` / `_editar`).

| Tabela | Leitura | Escrita |
|---|---|---|
| `processos_contra` | padrão (a fila usa para a tag) | `sub_jur_geral_processo_contra_editar` (insert/delete); update também `sub_jur_geral_configuracoes_editar` |
| `processos_contra_motivos` | padrão | `sub_jur_geral_processo_contra_editar` ou `sub_jur_geral_configuracoes_editar` |
| `boletos_honorarios` | `sub_fin_cr_relatorios_acessar` ou `_visualizar` | insert: padrão (todo operador que gera boleto); sem update/delete |
| `boletos_pagamentos` | `sub_fin_cr_relatorios_acessar` ou `_visualizar` | `sub_fin_cr_relatorios_acessar` (o relatório grava o cache ao abrir) |
| `reneg_liberacao` | padrão | insert: padrão (só `status='pendente'`); update/delete: `privado.eh_admin()` |
| `registro_cadastro`, `registro_cadastro_linhas` | `sub_rel_geral_registro_acessar` ou `_visualizar` | `sub_rel_geral_registro_editar` |
| demais tabelas | padrão `usuario_ativo()` | padrão `usuario_ativo()` (delete só onde o app apaga) |

**Revisar**: a tela Registro hoje não confere `_editar` antes de enviar o arquivo (registro.js:132) — quem só tem `_acessar` vai
passar a receber erro. `custas_judiciais`, notas, NEX, reneg e docs de assinatura ficaram no padrão porque são gravados da ficha do
cliente por vários perfis (operador, advogado, jurídico) sem chave única; `Pagar reembolso` confere `sub_fin_cr_pagar_reembolso_editar`
só na tela (pagar-reembolso.js:99).

## Realtime

`customer_notes` (app.js:8504), `jud_notes` (app.js:8668), `reneg_liberacao` (app.js:22017). As duas de notas estão com
`replica identity full` para o filtro `customer_id=eq.X` também receber deletes. O listener global de `jud_notes_shards`
(app.js:8531) está desligado (`if (false && …)`).

---

## sienge_customers → `sienge_customers`

Cópia do cadastro de clientes do Sienge. Doc id = `String(customer.id)`.

| Campo | Coluna | Transformação |
|---|---|---|
| doc id / `id` (int) | `id` | texto |
| `name` | `name` | |
| `personType`, `clientType`, `foreigner` | `person_type`, `client_type`, `foreigner` | `foreigner` fica "N"/"S" como no Sienge |
| `cpf`, `cnpj`, `internationalId`, `email` | idem snake | |
| `numberIdentityCard`, `issuingBody`, `issueDateIdentityCard` | `number_identity_card`, `issuing_body`, `issue_date_identity_card` | data → `date` |
| `birthDate`, `birthPlace`, `nationality`, `sex` | idem | `birth_date` date |
| `civilStatus`, `matrimonialRegime`, `marriageDate` | idem | `marriage_date` date |
| `motherName`, `fatherName`, `profession`, `mailingAddress`, `socialName` | idem | |
| `licenseNumber`, `licenseIssuingBody`, `licenseIssueDate` | idem | date |
| `phones`, `addresses`, `contacts`, `procurators`, `subTypes`, `familyIncome` | idem (jsonb, default `[]`) | só exibidos em bloco |
| `spouse` | `spouse` jsonb | |
| `createdAt`, `modifiedAt` | `created_at`, `modified_at` | `date` (datas do Sienge, não do Integra) |
| `modifiedAtDateTime` | `modified_at_date_time` | timestamptz, hora de SP |
| `is_subjudice`, `subjudice_entry_date`, `subjudice_exit_date` | idem | ausente → `false` / null |
| campos de PJ (`fantasyName`, `stateRegistrationNumber`, `cityRegistrationNumber`, `cnaeNumber`, `agents`, `shareCapital`, `site`, `contactName`, `creaNumber`, `technicalManager`, `establishmentDate`, `activityId`, `activityDescription`, `governmentEntity*`, `note`), `licenseIssueDate` nulo etc. | `extra` | < 3% dos docs |

- Decisão: doc pequeno (≤ 2,6 KB), colunas tipadas.
- Uso: app.js:837 (`getDocs` da coleção inteira para a busca de clientes); sienge-api.js:4649 (`where("is_subjudice","==",true)`) e
  4664/4680 (`setDoc merge` da marca de sub judice); marketing-budget.js:1650 (`getDoc` por id); api/_lib/sync-customers.js:93-94
  (`where('id','==',…) limit 1`) e 125 (`setDoc merge`). Sem listener/transação.
- Fase 3: o cron `sync-customers` grava o objeto cru do Sienge → precisa da função de mapeamento camelCase → colunas (o resto em `extra`).
- Importador: upsert por `id`; `is_subjudice` ausente = `false`.

## sienge_defaulters_history → `sienge_defaulters_history`

Cache diário dos títulos vencidos (até 976 KB por doc). **Cache regenerável**: uma linha por documento, conteúdo em `data jsonb`.
Motivo: o código só monta o bloco inteiro (lê ficha + `chunks` blocos e concatena) e filtra em memória; o Sienge regenera tudo todo dia
(morning-warmup). Manter os ids facilita a troca mecânica.

| Id do doc | `tipo` | `date` | `indice` |
|---|---|---|---|
| `AAAA-MM-DD` | `ficha` | do id | null |
| `AAAA-MM-DD_chunk_N` | `bloco` | do id | N |
| `AAAA-MM-DD_pronta` | `pronta` | do id | null |
| `AAAA-MM-DD_pronta_N` | `pronta_bloco` | do id | N |
| `AAAA-MM-DD_warmup_<empresa>_<lote>` | `warmup` | do id | lote |
| `AAAA-MM-DD_income_N` | `income` | do id | N |
| `_warmup_state`, `_cfin_state`, `_cfin_meta` | `estado` | campo `date` se houver | null |

| Campo | Coluna | Transformação |
|---|---|---|
| `data` (texto JSON) | `data` jsonb | `JSON.parse` |
| `chunks`, `count`, `rev`, `cacheRev` | `chunks`, `count`, `rev`, `cache_rev` | integer |
| `timestampStr`, `atFull` | `timestamp_str`, `at_full` | texto |
| `paidMap`, `paidInstallmentIds` (texto JSON) | `paid_map`, `paid_installment_ids` | `JSON.parse` → jsonb |
| `companyIds` | `company_ids` jsonb | |
| `companyId`, `batchIndex`, `idx` | `company_id`, `indice` | |
| `warmupDone` | `warmup_done` | |
| `batimentoPedidoEm` | `batimento_pedido_em` | timestamptz |
| `createdAt` (Timestamp ou ISO) | `created_at` | timestamptz |
| docs `estado` | todo o conteúdo em `extra` | (`_cfin_meta.chunks` é array, não cabe em `chunks int`) |

- Uso: sienge-api.js:473, 803-805, 892-899, 2453-2462 (leitura dos blocos), 2570-2581 (gravação), 2761 (`updateDoc` paidMap);
  estoque-comercial.js:989, 1613 (`setDoc merge` batimentoPedidoEm); compras-controle-financeiro.js:861, 874 (`_cfin_meta` e blocos);
  api/_lib/morning-warmup.js:739-747, 855-863, 1491, 1594, 1647, 1669, 1700-1714 (cron, inclusive `deleteDoc`);
  api/_lib/estoque-batimento.js:76-86, 220-227; api/_lib/painel-diario.js:209-214. Sem listener/transação.
- Fase 3: tirar o `JSON.parse(snap.data().data)` (já vem jsonb); o delete fica só no servidor (service role).
- Importador: **só os últimos ~7 dias** fazem sentido (é cache); dias antigos podem ser descartados — decisão do dono. Docs `estado`
  podem ser ignorados (o cron recria).

## inadimplencia_snapshots → `inadimplencia_snapshots`

Um doc por dia (`id` = `AAAA-MM-DD`), ≤ 14 KB. Colunas tipadas.

| Campo | Coluna | Transformação |
|---|---|---|
| `date` | `date` | date |
| `total_value`, `avg_ticket`, `subjudice_value`, `sprint_value` | idem | numeric(15,2) |
| `total_count`, `total_customers`, `subjudice_count`, `subjudice_customers`, `recovered_count`, `new_count`, `source_count`, `sprint_clients`, `sprint_titles`, `sprint_avg_delay` | idem | integer |
| `is_week_start`, `is_week_end`, `is_month_close` | idem | boolean (4 docs têm 0/1) |
| `subjudice_detail` | jsonb | |
| `data_json` | jsonb | 4 docs têm texto JSON → `JSON.parse` |
| `saved_at`, `sprint_saved_at` | timestamptz | |
| `sprint_origem` | texto | |
| `created_at` (4 docs) | `extra` | e `criado_em` |

- Uso: dashboard-inadimplencia.js:63-64 e home-dashboard.js:1083-1084 e app.js:59571-59572 (`orderBy("date","asc")`);
  dashboard-inadimplencia.js:273 (`getDoc`+`setDoc merge` sprint); app.js:59520 (`setDoc merge` sub judice);
  sienge-api.js:4596; api/_lib/morning-warmup.js:662. Leitura+gravação "não sobrescrever se menor" é feita no cliente (sem transação).

## Notas de cobrança: customer_notes_shards + customer_notes → `customer_notes`

**Atual**: `customer_notes_shards` (20 docs `chunk_0..chunk_19`, cada um `{ <customerId>: [notas] }`; o shard é
`soma dos charCodes do id % 20`, app.js:7999). Leitura inicial app.js:8289; gravação app.js:8393-8430 (`runTransaction` por cliente),
8444-8475 (gravação em massa); listener app.js:8504 (doc do shard do cliente aberto); auditoria app.js:4697; limpezas app.js:38373, 38497.
**Legado**: `customer_notes/<customerId> { notes: [...] }` — só é escrito pelo botão de sincronização total (app.js:56787) e lido na
limpeza do título 4868 (app.js:38377). Uma linha por nota; o shard é esquecido.

| Campo da nota | Coluna | Transformação |
|---|---|---|
| chave do mapa no shard / doc id do legado | `customer_id` | texto como está (amostra: só numéricos) |
| `id` (87% têm, uuid) | `id` | sem id → `'leg_' + sha1(customer_id + '|' + occurrenceIdentity)` (24 hex) |
| `date` | `date` | timestamptz |
| `author`, `text`, `canal`, `iniciativa`, `reminder`, `status` | idem | `text` ausente → `''` |
| `promiseStatus`, `promiseDate`, `promiseStatusAt` | `promise_status`, `promise_date` (date), `promise_status_at` | |
| `promisedInstallments` (strings "DD/MM/AAAA - R$ x") | `promised_installments` text[] | |
| `saleId`, `unitId`, `contractId`, `receivableBillId` | idem | número → texto |
| `pinned` | `pinned` | ausente → false |
| `webroBaixa`, `reuniaoSemanalTerceirizada`, `checkPayment`, `nexLocked`, `colenciPix` | idem snake | boolean |
| `checkPaymentDate`, `boletoDueDate`, `colenciPrazo` | idem | date |
| `nexId`, `customerName`, `unitLabel`, `origem` | idem | |
| `valorAtualizado` | `valor_atualizado` | numeric(15,2) |
| `descontoEncargosPct` | `desconto_encargos_pct` | numeric |
| `attachments` | jsonb | |
| `pastTexts` | `past_texts` text[] | |
| `lastEdit` | `last_edit` jsonb | |
| `updatedAt` | `updated_at` | timestamptz |
| `lastErrata`, `systemUpdatedStatus`, outros | `extra` | |

**Dedupe do importador** (mesma regra do `window.mergeOccurrenceLists`, app.js:8025):
1. Para cada cliente, juntar a lista do shard **primeiro** e depois a do legado `customer_notes`.
2. Identidade = `id` se existir, senão `[date, author, canal||fase, promiseDate||prazo, text[0..80]].join('|')`; descartar identidade
   vazia (`'||||'`).
3. Mesma identidade: fica a de carimbo maior (`promiseStatusAt || updatedAt || lastEdit.date`), mesclando campos
   (`Object.assign(antiga, nova)`); empate = fica a primeira (shard).
4. Na amostra: 6.260 notas em shards (777 sem id, 2 identidades repetidas no mesmo cliente); legado tinha 205, 200 já nos shards
   → só 5 entram pelo legado. Nenhum id repetido entre clientes; se aparecer, registrar e manter o primeiro.
5. **Decisão do dono**: o app esconde notas com texto exatamente "TESTE" e os boletos de teste do título 4868/cliente 5187
   (`isTitulo4868BoletoOccurrence`, app.js:38254). Sugestão: não importar essas (contar e registrar).
- Fase 3: com `id` gerado na carga, `occurrenceIdentity` passa a usar o id; o cache local antigo (`crm_moura_notes`) deve ser
  descartado na virada para não duplicar.

## Notas judiciais: jud_notes_shards + customer_jud_notes_shards + jud_notes → `jud_notes`

**Atual**: `jud_notes_shards` e `customer_jud_notes_shards` (mesmo sharding, sempre gravadas juntas — app.js:8641-8649; na amostra
as 115 chaves são idênticas). Leitura: app.js:8293 (`customer_jud_notes_shards`) e 8296 (`jud_notes_shards`), mescladas;
listener app.js:8668 (shard do cliente aberto em `jud_notes_shards`). **Legado**: `jud_notes/<customerId> { notes }` (só o botão
de sincronização, app.js:56805).

| Campo | Coluna | Transformação |
|---|---|---|
| chave do mapa / doc id | `customer_id` | |
| `id` (100% têm, `jud_<epoch>`) | `id` | |
| `date`, `author`, `text`, `type`, `fase` | idem | |
| `faseId` | `fase_id` | |
| `prazo` | `prazo` | date (`""` → null) |
| `pinned` | `pinned` | |
| `semAlteracao`, `etapaInicio` | `sem_alteracao`, `etapa_inicio` (timestamptz) | |
| `lastEdit`, `agreementAttachment`, `replies` | jsonb | |

Dedupe: mesma regra de cima, ordem `customer_jud_notes_shards` → `jud_notes_shards` → `jud_notes` (legado; na amostra 1 nota do
legado não está nos shards e entra). Carimbo = `lastEdit.date`.

## processos_judiciais → `processos_judiciais`

Doc id = customerId. `customerId` → `customer_id`, `numero`, `updatedAt` → `updated_at`. Uso: app.js:53241 (`setDoc merge`),
53261 (`getDoc`). Padrão de RLS.

## processos_contra → `processos_contra` (coleção vazia; desenhada pelo código)

Gravação em processo-contra.js:1956: `parteTipo, parteId, parteNome, parteRotulo, customerId, companyId, companyName, autorTipo,
poloEmpresa, autorNome, reuNome, valorCausa, processo, motivo, motivoId, anexos[{name,url,type,size,path}], createdAt, createdBy`
→ mesmas colunas em snake_case (`valor_causa` numeric(15,2); `customerId ''` → null; `created_at` timestamptz).
Leitura: processo-contra.js:1419 (coleção inteira, ordena por createdAt no cliente), fluxos-processo.js:125, app.js:12197 (tags da fila);
`setDoc merge {motivo}` em fluxos-processo.js:792; delete processo-contra.js:1995. Chave: `sub_jur_geral_processo_contra_editar`
(processo-contra.js:67). Anexos ficam no Storage (`processos_contra/<id>/…`), só a lista vai para jsonb.

## processos_contra_motivos → `processos_contra_motivos`

Era um doc `lista` com `itens: [{id, nome}]` e `updatedAt`. Agora **uma linha por motivo**: `id`, `nome`, `ordem` = posição no array;
`updatedAt` → `atualizado_em` de todas. Uso: processo-contra.js:1631 (grava a lista inteira → RPC `salvar_processos_contra_motivos`),
1641 (lê). O `id` do motivo é o id do fluxo em `config/fluxos_processo` (área núcleo/config) — sem FK.

## custas_judiciais → `custas_judiciais`

Id `<customerId>_<saleId>_<epoch>`. Campos: `customerId, saleId, customerName, data (date), descricao, tipos (text[]), valor,
guias/comprovantes/anexos (jsonb), companyId, companyName, costCenterId, unitName, processo, billId, documentNumber, notes, dueDate (date),
liberatedAt, liberatedBy, reemPago, reemConferidoEm, pagoEm (date), createdAt, createdBy, updatedAt, updatedBy` → snake_case.
`billId ''` mantém `''` (o app usa "vazio = ainda não liberado"; índice parcial ignora vazio).
Uso: custas-judiciais.js:288-295 (`where customerId == && saleId ==`), 583, 774 (`setDoc merge`), 811 (delete);
pagar-reembolso.js:191, 206, 377, 1026, 1083; lib/reembolso-batimento.js:97 (coleção inteira), 122 (marca pago). Sem transação.

## boletos_honorarios → `boletos_honorarios`

Um doc por boleto gerado (`<billId>_<epoch>`), ≤ 1,6 KB. Campos 1:1 em snake_case (`customerDoc` → `customer_doc`,
`boletoDueDate` date, `generatedAt` timestamptz, `generatedDate` date, percentuais numeric). `parcelas` e `totais` ficam jsonb
(lidos inteiros com o registro; o relatório soma no cliente). Uso: relatorio-honorarios.js:220 (`setDoc`, chamado de app.js:32047),
233 (`where competencia ==`).

## boletos_pagamentos → `boletos_pagamentos`

Id = `recId` com `/` → `_`. `recId → rec_id`, `competencia`, `customerId`, `billId`, `allPaid`, `checkedAt` (timestamptz),
`checkedDate` (date), `parcelas` jsonb. Uso: relatorio-honorarios.js:356 (`where competencia ==`), 377 (`setDoc`). Sem FK para
`boletos_honorarios` (recId também vem de boletos reconstruídos de `auditoria_logs`).

## boletos_baixa_banco → `boletos_baixa_banco`

Id automático (`addDoc`). Campos já em snake_case; `vencimento "DD/MM/AAAA"` → date; `parcelas`, `parcelas_numero` → text[];
`valor` numeric(15,2); `informado_em` timestamptz; `comprovante` = caminho no Storage. Uso: boletos-baixa.js:52 (`where titulo ==`),
385 (`addDoc`).

## nex_letters → `nex_letters`

Doc `<customerId>_<titulo>` com `items[]` (cartas; até 185 KB por causa do `html`). **Uma linha por carta** — o código filtra item a
item (por título, status, nexLocked, purga) e o histórico junta cartas de vários títulos. Mesma carta pode estar em mais de um doc do
cliente (13 repetições na amostra, o app replica a versão nova), por isso PK sintética e `unique (doc_id, item_id)`.

| Origem | Coluna | Transformação |
|---|---|---|
| doc id | `doc_id` | |
| doc `customerId` | `customer_id` | |
| doc `saleId` | `sale_id` | |
| item `titulo` (ou doc `titulo`) | `titulo` | |
| item `id` | `item_id` | |
| item `customerName`, `letterType`, `unitLabel`, `author`, `status`, `tracking` | idem snake | |
| item `date`, `lostPayIso`, `deliveredAt` | date | `""` → null |
| item `zeroPaid` | `zero_paid` | |
| item `arDigital` | `ar_digital` jsonb | |
| item `html` | `html` | texto |
| item `createdAt` | `created_at` | |
| doc `updatedAt` (epoch ms) | `atualizado_em` | |

Uso: app.js:38213-38224 (purga: lê tudo, regrava/ apaga), 38715 (`where customerId ==`), 38724 (`getDoc`), 38788 (`setDoc`/`deleteDoc`
→ RPC `salvar_nex_letters`), 39292 (lê tudo para hidratar). As notas de cobrança ligam pela coluna `customer_notes.nex_id`.

## reneg_propostas → `reneg_propostas`

Id `<customerId>_<saleId>` (app.js:23488). Campos 1:1 snake_case: `sinalValue`, `installmentValue` numeric(15,2); `sinalPct` numeric;
`sinalDue`, `expiraEm`, `firstDueDate` date; `expiradaEm`, `concluidaEm`, `sinalPagoEm`, `createdAt` timestamptz;
`selectedBillIds` text[]; `reparcelamento` jsonb; `codigoAuth` texto (id em `documentos_autenticados`, outra área).
Uso: app.js:23637 (lê tudo), 23654 (delete de teste), 23668 (marca expirada), 23784, 23906, 23947, 23956, 23974 (`setDoc merge`).

## reneg_liberacao → `reneg_liberacao` (coleção vazia; desenhada pelo código)

Objeto montado em app.js:21855-21879 e gravado em 21935; decisão em 21951 (`updateDoc status/decididoEm/decididoPor`);
**listener** `onSnapshot` da coleção em app.js:22017 → realtime. Colunas em snake_case; `criadoEm` (epoch ms) → `criado_em`
(coluna padrão), `decididoEm` → `decidido_em`; valores em numeric(15,2); `contratos` jsonb. Só o administrador decide
(`crmAdministradorReal`, app.js:21891) → RLS `eh_admin()` no update.

## relacionamento_docs_assinatura → `relacionamento_docs_assinatura`

Id automático (`addDoc`). Campos 1:1 snake_case (`tipoLabel` → `tipo_label`, `centroId` → `centro_id`, `pdfUrl` → `pdf_url`,
`userId` → `user_id` texto legado de `config/crm_users`, `createdAt`/`lancadoEm` timestamptz, `lancadoPor`).
Uso: doc-assinatura.js:118 (`addDoc`), 165 e 775 (`updateDoc`), 421 (delete), 441 e 941 (lê tudo);
lib/distrato-followup-core.js:301 (lê tudo), 320 (marca lançado pelo batimento das 7h). `pdfUrl` aponta para o Firebase Storage
(a migração do Storage é de outra etapa).

## registro_cadastro → `registro_cadastro` + `registro_cadastro_linhas`

Era `atual` (ficha: `arquivo, quando, por, unidades, partes`) + `atual_0..N` com **pedaços de um texto JSON** (até 675 KB cada).
Decisão: **uma linha por unidade** (12.847 na amostra) em `registro_cadastro_linhas`, porque a tela cruza unidade a unidade com o
estoque. Ficha: `id='atual'`, `arquivo`, `quando` (timestamptz), `por`, `unidades`; `partes` some.
Linhas: `empresaId → empresa_id`, `empresa`, `obraId → obra_id`, `obra`, `unidade`, `letra`, `ordem` = posição no array; outras chaves
→ `extra`. Importador: concatenar `atual_0..atual_{partes-1}`.dados na ordem, `JSON.parse`, inserir. Uso: registro.js:44-54 (lê),
75-79 (grava; ficha por último → RPC `substituir_registro_cadastro`).

## webro_repasse_pendente → `webro_repasse_pendente`

Id = título saneado. `titulo`, `customerId → customer_id`, `cliente`, `unidade`, `operador`, `baixa` (date), `vistoEm → visto_em` (date).
Uso: recebimentos-webro.js:1187 (lê ids), 1206 (`setDoc`), 1217 (`deleteDoc`), 1252 (leitura filtrando `vistoEm >= corte` no cliente;
índice em `visto_em` para a Fase 3 filtrar no banco).

---

## Pendências / revisar com o dono

1. Chave `_editar` da tela Registro (ver acima) e se `custas_judiciais`/notas devem exigir chave (ex.: `sub_fin_cr_sub_judice_editar`).
2. Notas "TESTE"/título 4868 — importar ou não.
3. `sienge_defaulters_history`: quantos dias de cache importar.
4. `boletos_honorarios.totais`/`parcelas` ficaram jsonb (relatório soma no cliente); se o relatório for para SQL, tipar.
5. `foreigner` do Sienge ficou texto "N"/"S" (não virou boolean) para o espelho bater com a API.
6. Anexos (`attachments`, `anexos`, `guias`, `comprovantes`, `pdfUrl`, `comprovante`) continuam apontando para o Firebase Storage.
