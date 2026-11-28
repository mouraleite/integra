# Mapa de tabelas — Núcleo / Sistema / Configuração

Migration: `supabase/migrations/202611191300_nucleo.sql`. Convenções: `supabase/CONVENCOES.md`.
Amostra usada: `integra-export/inventario-amostra` (até 200 docs por coleção). Referências `arquivo:linha` são do
branch `migracao-supabase` em 19/11/2026.

Regras gerais do importador (Fase 4) para esta área:
- **Datas**: texto ISO → `timestamptz`; epoch ms (número ou texto numérico) → `to_timestamp(ms/1000.0)`;
  `0`, `""` e `null` → `null`. `AAAA-MM-DD` → `date`. Timestamp do Firestore (`{__tipo:"timestamp", iso}`) → `iso`.
- **Booleanos 0/1** → `boolean`.
- Todo campo não listado no mapa vai para `extra` (nada se perde).
- `criado_em`: quando a origem tem `createdAt`/`em`/`enviadoEm`, usar esse valor; senão `now()`.
- Chaves de `config/global` são **strings com JSON dentro** (espelho do `localStorage`). O importador faz
  `JSON.parse`; se falhar, grava a string como JSON string (`to_jsonb(texto)`). No front (Fase 3) o helper de
  configuração devolve `JSON.stringify(valor)` onde o código ainda espera string no `localStorage`.

## Tabelas criadas

| Tabela | Origem | Realtime | RLS (leitura / escrita) |
|---|---|---|---|
| `configuracoes` | `config/global` (chaves restantes), `config/<doc>` restantes, `settings/*`, `config_stages/*` | sim | ativo / ativo (excluir: admin) |
| `centros_custo` | `config/centros_custo.byId` + `global.crm_centros_custo_custom` | — | ativo / `sub_cfg_apoio_centro_custo_editar` |
| `empresas` | `global.crm_empresas_custom` | — | ativo / `sub_cfg_apoio_empresas_editar` |
| `condicoes_pagamento` | `config/condicoes_pagamento.byId` + `global.crm_moura_condicoes_pagamento` | — | ativo / `sub_com_geral_condicoes_pagamento_editar` |
| `motivos_cancelamento` | `global.crm_cancelamento_motivos.catalogo` | — | ativo / `sub_cfg_apoio_motivos_cancelamento_editar` |
| `preambulos` | `global.crm_moura_preambles_list` | — | ativo / `sub_cfg_apoio_preambulos_editar` |
| `cartorios` | `global.crm_moura_cartorios_list` | — | ativo / ativo (revisar) |
| `fluxos_processo` | `config/fluxos_processo.fluxos[]` | — | ativo / `sub_jur_geral_configuracoes_editar` |
| `central_email_templates` | `config/central_email.templates[]` | — | ativo / ativo (revisar) |
| `central_email_envios` | `central_email_envios` | — | ativo / só servidor |
| `obra_vgv` | `config/obra_vgv.obras` | — | ativo / ativo |
| `parcerias` | `config/partner_parametrizations.list` | — | ativo / ativo (revisar) |
| `tags` | `tags` | — | ativo / `sub_cfg_apoio_tags_editar` |
| `anexos_tag_memory` | `anexos_tag_memory` | — | ativo / ativo |
| `anexos_mapa` | `anexos_mapa/<cc>.byKey` (uma linha por envio) | — | ativo / ativo |
| `auditoria_logs` | `auditoria_logs` | — | `sub_seg_geral_auditoria_visualizar` (+ ativo p/ `BOLETO_GERADO`) / ativo só inclui |
| `auditoria_login_relatorios` | `auditoria_login_relatorios` | — | `..._auditoria_login_visualizar` / `..._auditoria_login_editar` |
| `auditoria_login_linhas` | `auditoria_login_partes` (shards → uma linha por acesso) | — | idem |
| `usuarios_online` | `usuarios_online` | sim | própria linha ou `sub_seg_geral_usuarios_online_visualizar` / própria linha |
| `api_consumo` | `api_consumo` (+ RPC `incrementar_api_consumo`) | — | ativo / ativo (via RPC) |
| `ambientes_dev` | `ambientes_dev/<email>.ambientes` (uma linha por bolha) | — | dono (e-mail) ou admin / dono |
| `alertas_ciente` | `alertas_ciente/<alerta>` (uma linha por ciente) | — | dono (e-mail) ou admin / dono |
| `suporte_chamados` | `suporte_chamados` | sim | autor ou suporte / autor ou suporte |
| `documentos_autenticados` | `documentos_autenticados` | — | ativo / ativo (excluir: admin) |
| `agenda_personal_notes` | `agenda_personal_notes` | sim | dono, "TODOS", compartilhado comigo, admin |
| `agenda_recurring_notes` | `agenda_recurring_notes` | sim | idem |
| `sienge_sync_state` | `sienge_sync_state` | — | só servidor (sem política) |
| `kmz_coordinates` | `kmz_coordinates` | — | ativo / `sub_cfg_apoio_upload_kmz_editar` |

"ativo" = `(select privado.usuario_ativo())`. "admin" = `privado.eh_admin()`. Chaves de permissão conferidas nos
`crm_perms_*` reais de `config/global`.

## RPCs

| Função | Substitui | Uso |
|---|---|---|
| `public.incrementar_api_consumo(p_data date, p_delta jsonb)` | `increment()` aninhado em `ApiUsage.flush` (`js/nucleo/sienge-api.js:1083-1143`) | `p_delta` = mesmo objeto que hoje vai ao `setDoc`, mas com números puros no lugar de `increment(n)`. Números somam, objetos fundem, rótulos (`label`, `kind`, `path`) são substituídos. Usa `privado.jsonb_somar`. |
| `public.gravar_configuracoes(p_valores jsonb)` | `setDoc(config/global, {k1, k2...}, {merge:true})` de várias chaves | `forceUploadLocalConfig` (`app.js:56554`), `commitCrmGlobalConfig` (`app.js:6789`): upsert de todas as chaves numa transação. |
| `public.mesclar_configuracao(p_chave text, p_parcial jsonb)` | `setDoc(config/global, {chave: {k: v}}, {merge:true})` em chaves-mapa | ex.: `crm_plano_reembolsaveis` (`js/financeiro/plano-financeiro.js:61`). Fusão rasa atômica, devolve o valor final. |
| `public.trocar_configuracao(p_chave text, p_valor jsonb, p_esperado timestamptz)` | `runTransaction` em `config/global` que lê, funde no JS e grava uma chave | Ler `valor, atualizado_em`; fundir no JS como hoje; chamar com `p_esperado = atualizado_em` lido (null se a chave não existia). Retorno `null` = conflito → reler e repetir. Casos: `app.js:6982` (`crm_engenharia_caucao_liberados_v1`), `js/nucleo/empresas.js:814` (agora vira upsert em `empresas`), `js/engenharia/verificar-construcao.js:345` (`crm_moura_vistoria_send_days_config` + `crm_moura_vistoria_recurrence_days`: usar `gravar_configuracoes` após a fusão, ou duas trocas), `lib/caucao-batimento.js:171` e `:289` (servidor; fila de avisos e trava). |

Todas `security invoker`, `search_path = ''`, `grant execute` a `authenticated` e `service_role`.
Transações de `app.js:6494`, `6548`, `6621` (perfis, permissões, usuários) são da Fase 1 (`perfis`/`usuarios`), fora desta área.

---

## 1. `config/global` (~955 KB, 81 chaves) → várias tabelas + `configuracoes`

Hoje é um espelho do `localStorage`: `SYNC_KEYS` (`js/nucleo/app.js:55169`) + todos os `crm_perms_*`, baixado em
`syncGlobalConfigFromFirebase` (`app.js:55964`, `getDocs(collection("config"))`) e enviado inteiro em
`forceUploadLocalConfig` (`app.js:56554`). Leitura cacheada em `crmLerConfigGlobal` (`app.js:6365`).
**Listener**: `onSnapshot(doc(config/global))` em `js/engenharia/verificar-construcao.js:986` (só olha
`crm_obras_andamento`) → `configuracoes` está no realtime; na Fase 3 assinar com filtro `chave=eq.crm_obras_andamento`.

Decisão de "doc grande": o documento some; **uma linha por chave** em `configuracoes` (a maior, `crm_moura_profiles`,
vai para `perfis`). Com isso nenhuma gravação precisa mais reescrever 1 MB.

| Chave | Destino | Observação / área dona |
|---|---|---|
| `crm_users`, `removedEmails` | `usuarios` (Fase 1) | já importado por `ferramentas/migracao/importar-usuarios.js`; não importar aqui |
| `crm_moura_profiles`, `crm_moura_profiles_removed` | `perfis` (Fase 1) | idem |
| `crm_perms_<id>` | `perfis.permissoes` (Fase 1) | idem |
| `crm_perms_bak_<id>` | **descartar** | cópias de segurança antigas das permissões; se o dono quiser guardar: `configuracoes` com a mesma chave |
| `crm_centros_custo_custom` | `centros_custo` | ver §2 |
| `crm_empresas_custom` | `empresas` | ver §3 |
| `crm_moura_condicoes_pagamento` | `condicoes_pagamento` | ver §4 (mesmo conteúdo de `config/condicoes_pagamento`) |
| `crm_cancelamento_motivos` | `motivos_cancelamento` | ver §5 |
| `crm_moura_preambles_list` | `preambulos` | ver §6 |
| `crm_moura_cartorios_list` | `cartorios` | ver §7 |
| `crm_moura_financiamentos_proc` (39 KB) | `configuracoes` | **cobrança**: mapa `<customerId>:<contractId>` → processo de financiamento. É registro de negócio, não configuração; recomendo a área de cobrança normalizar em tabela própria. Merge em `forceUploadLocalConfig` (`crmFinanciamentosMesclar`) |
| `crm_compromissario_cessao_v1` (43 KB) | `configuracoes` | **cobrança/relacionamento**: registros mensais de cessão por empresa (`records[]`). Também é registro; recomendo tabela na área dona |
| `crm_compromissario_configs` | `configuracoes` | compromissário (prefeituras/associações) |
| `crm_engenharia_caucao_liberados_v1`, `crm_engenharia_caucao_avisos_v1`, `crm_engenharia_caucao_prorrogacao_v1` | `configuracoes` | **engenharia**. `liberados` e `avisos` são lidos/gravados também pelo servidor (`lib/caucao-batimento.js:170-171`, `:289`, `:307`) com transação → `trocar_configuracao`. Candidatos a tabela na área de engenharia |
| `crm_engenharia_acompanhamento_obra`, `crm_obras_andamento`, `crm_obras_andamento_meta` | `configuracoes` | **engenharia**; `crm_obras_andamento` tem listener (acima) |
| `crm_moura_vistoria_send_days_config`, `crm_moura_vistoria_recurrence_days` | `configuracoes` | engenharia; `verificar-construcao.js:303`, `:345` |
| `crm_plano_visoes_v2`, `crm_plano_impostos`, `crm_plano_reembolsaveis`, `crm_impostos_custom` | `configuracoes` | **financeiro** (`js/financeiro/plano-financeiro.js:41`, `:61`, `:1266`, `:1276`). `crm_plano_reembolsaveis` é o único valor que já está como objeto (não string) |
| `crm_compras_prazo_lancamento_v1`, `crm_comissao_nfs_v1` | `configuracoes` | financeiro/comercial |
| `crm_honorarios_internos_pct` | `configuracoes` | cobrança (`js/cobranca/relatorio-honorarios.js:1973`) |
| `crm_moura_rules`, `crm_moura_rules_params`, `crm_moura_negotiation_rules`, `crm_moura_regras_negociacao`, `crm_moura_alcada_desconto`, `crm_moura_alcada_distrato`, `crm_moura_cartao_taxas`, `crm_moura_judiciais`, `crm_moura_timeline_nodes`, `crm_moura_timeline_acoes`, `crm_moura_timeline_gatilhos`, `crm_nex_due_days_config`, `crm_moura_valor_padrao_m2` | `configuracoes` | **cobrança** (regras, alçadas, régua). `crm_moura_alcada_distrato` também gravado em `js/cobranca/alcada-distrato.js:226` |
| `crm_moura_financiamento`, `crm_moura_financiamento_at`, `crm_moura_financiamento_excluidas` | `configuracoes` | cobrança (etapas do financiamento, `app.js:45254`) |
| `crm_indexadores_ativos` | `configuracoes` | núcleo (tela Indexadores) |
| `crm_centros_custo_tipos` | `configuracoes` | núcleo (lista de tipos para o select) |
| `crm_documentos_vistos`, `crm_documentos_ciencia` | `configuracoes` | núcleo (`js/nucleo/documentos-sienge.js`); `byId` de tipos de documento do Sienge já vistos |

Valor de `configuracoes.valor`: o JSON interpretado (ex.: `crm_moura_vistoria_recurrence_days` = `"90"` vira `90`).
`atualizado_por`: `null` na carga; depois as RPCs gravam o e-mail do JWT (ou `'servidor'`).

## 2. `centros_custo` (de `config/centros_custo` 233 KB e `global.crm_centros_custo_custom` 110 KB)

Os dois guardam o mesmo mapa `{<cc_id>: {...}}` (286 itens, idênticos na amostra). Código: `persistCentrosCustoCustomToFirebase`
(`app.js:55680-55747`) lê os dois, funde por `updatedAt` e grava os dois; leitura no login `app.js:55964`
(`centrosCustoCloud`). Decisão: o código busca item a item por `cc_id` (`customOf(id)` em
`js/financeiro/gerar-pagamento.js:527`, `caixa-diario.js:1199`) → **uma linha por centro de custo**.

| Campo | Coluna | Transformação |
|---|---|---|
| chave do mapa / `cc_id` | `id` | texto (alguns `cc_id` são número) |
| `tipo_cc` | `tipo_cc` | |
| `perc_ml`, `perc_terrenista` | idem | numeric |
| `imposto_pago_empresa`, `clausula_suspensiva_ativa`, `incorporacao_lotes_proprios` | idem | boolean |
| `valor_vgv` | `valor_vgv` | numeric(15,2) |
| `clausula_suspensiva_dias` | idem | integer |
| `incorporacao_lotes_tipo`, `registro_imovel`, `indexador_padrao`, `associacao_nome` | idem | `""` mantém `""` |
| `incorporacao_lotes_excecao` | idem | jsonb `[{id,name}]` |
| `conta_parceria` | `conta_parceria` | jsonb `{banco, agencia, numero, id, nome}` (cópia de `cc_conta_parceria`, área financeiro) |
| `conta_parceria_at` | `conta_parceria_at` | epoch ms → timestamptz |
| `updatedAt` | `updated_at` | epoch ms → timestamptz; `0` → null |
| `socios_7`, `frota_9`, `morada_ipes_aberto` | `extra` | < 20% |

Importador: fundir `config/centros_custo.byId` com `global.crm_centros_custo_custom` (por item, vence o `updatedAt` maior;
`conta_parceria` vence o `conta_parceria_at` maior), igual a `mergeCentrosCustoCustom`.
Fase 3: `forceUploadLocalConfig` chama a gravação para qualquer usuário (`app.js:56575`); com a RLS só quem tem
`sub_cfg_apoio_centro_custo_editar` grava — gravar só as linhas alteradas e só com a permissão.

## 3. `empresas` (de `global.crm_empresas_custom`, 39 empresas)

Código: `js/nucleo/empresas.js:811-822` (`runTransaction` só para fundir → vira upsert por linha), merge em
`forceUploadLocalConfig`. Campos → colunas de mesmo nome em snake_case: `company_id` (integer), `nome_usual`,
`percentual_mldu`, `percentual_mldu_edited`, `percentual_liquido_mldu`, `percentual_liquido_mldu_edited`,
`consolidacao_padrao`, `gerida_pelo_grupo`, `cobranca_interna`, `nova_empresa`, `gestao_elenco`, `spe_socios`,
`holding_interna` (0/1 → boolean), `updatedAt` → `updated_at`. `nome_usual_edited` (13%) → `extra`. `id` = chave do mapa.
Atenção: nome `empresas` pode colidir com outra área (financeiro/fiscal) se alguém criar a lista de empresas do Sienge
com o mesmo nome — combinar antes de aplicar.

## 4. `condicoes_pagamento` (de `config/condicoes_pagamento` e `global.crm_moura_condicoes_pagamento`)

`byId` {código → `{boletoSienge, parcelaWebro, repasseAdvogado, updatedAt}`}, 10 itens. Código:
`js/nucleo/condicoes-pagamento.js:163`, `:173`, `:285-286`; `app.js:56711`. Colunas: `boleto_sienge`, `parcela_webro`,
`repasse_advogado` (boolean), `updated_at` (epoch ms). `updatedAt` do topo do documento: descartar.
Importador: fundir as duas origens por item (vence `updatedAt` maior). Área dona da tela: comercial (permissão
`sub_com_geral_condicoes_pagamento_editar`).

## 5. `motivos_cancelamento` (de `global.crm_cancelamento_motivos`)

`{catalogo: [{codigo, nome}], em}`. Código: `app.js:9367-9420` (`cancelMotivosGravar` / `cancelMotivosSincronizar`).
`codigo` → `id`; `nome`; posição no array → `ordem`. `em` → `atualizado_em` de todas as linhas.
Fase 3: `cancelMotivosSincronizar` regrava o catálogo-padrão para qualquer usuário; com a RLS só quem tem
`sub_cfg_apoio_motivos_cancelamento_editar` consegue (o código já trata a falha).

## 6. `preambulos` (de `global.crm_moura_preambles_list`, 14 itens)

`id` (número → texto), `text` → `texto`, `responsibles` → `responsaveis`, `status`, `empresaId` → `empresa_id`,
`centrosCustoIds` (números) → `centros_custo_ids text[]`, `deleted` → `excluido`, `updatedAt` → `updated_at`.
Itens com `deleted: true` (só `id/deleted/updatedAt`) são lápides do merge: importar como `excluido = true`.
Sincronização: `app.js:55985` (`syncPreamblesFromCloud`).

## 7. `cartorios` (de `global.crm_moura_cartorios_list`)

`[{nome, deleted, updatedAt}]`, sem id. `nome` (único), `deleted` → `excluido`, `updatedAt` → `updated_at`,
posição → `ordem`; `id` gerado. Permissão: não achei chave própria (tela de Documentos Padrões?) → padrão, revisar.

## 8. `config/central_email` → `central_email_templates`; `central_email_envios`

Templates: `js/nucleo/central-email.js:265-289` (normalização), `:304` (leitura), `:328` (gravação do array inteiro);
servidor lê em `api/_lib/central-email-enviar.js:223`. Colunas: `id`, `nome`, `assunto`, `corpo`, `tag` (numeric, id
da etapa da régua), `diasVencido` → `dias_vencido`, `destino` (`fixo`/`contrato`), `para`, `cc`, `status`
(`pendente`/`aprovado`), `ativo`, `criadoPorEmail/Nome` → `criado_por_email/nome`, `aprovadoEm` → `aprovado_em`
(`""` → null), `avisoCriador` → `aviso_criador`. Fase 3: gravar = upsert dos templates + delete dos removidos.

Envios (coleção vazia na amostra; desenhada pelo código): id `idEnvio(dia, templateId, customerId, titulo)`
(`central-email-enviar.js:208`), campos `dia` (date), `templateId`, `customerId`, `titulo`, `status`, `em`, `para`,
`cc`, `extrato`, `erro`. Gravado só pelo servidor (`:238`, `:258`, `:267` — hoje via REST do Firestore; trocar por
`lib/supabase-admin.js`). Lido na tela com `where("dia","==",hoje)` (`central-email.js:714`) → índice em `dia`.

## 9. Demais documentos de `config/*` → `configuracoes` (chave `config/<id>`)

| Documento | Tamanho | Código | Área dona / nota |
|---|---:|---|---|
| `antecipacoes_batimento` | 0,1 KB | `lib/antecipacoes-batimento.js:34` (servidor) | financeiro; estado do cron |
| `reembolso_batimento` | 0,1 KB | `lib/reembolso-batimento.js:32` (servidor) | financeiro; estado do cron |
| `ctb_equiv` | 2,7 KB | `js/contabil/contabil-equiv.js:378`, `:400` | contábil (financeiro/fiscal). `vinculos[]`, `lancados{}`, `empresas{}` — candidato a tabela na área dona |
| `depara_parceiro` | 0,6 KB | `js/contabil/contabil-depara.js:97`, `:394` | contábil |
| `escala_home_office` | 0,7 KB | `js/nucleo/escala-home-office.js:378`, `:405` | núcleo; `{ajustes{dia:pessoa}, ferias{pessoa:[...]}}` lido em bloco |
| `estrutura_societaria` | 6,5 KB | `js/contabil/societario.js:411`, `:462` | contábil; grafo exibido em bloco |
| `fluxos_processo` | 6 KB | `js/juridico/fluxos-processo.js:241`, `:330` | **vira tabela** `fluxos_processo` (§10); `excluidos` e `seq` vão para `configuracoes` chave `config/fluxos_processo` = `{excluidos, seq}` |
| `gp_conferencia` | 64 KB | `js/financeiro/gerar-pagamento.js:2573`, `:2600` | financeiro; mapas `lotes` (114) e `padroes` (328) podados a 800 no front, fundidos por chave. Mantido em bloco; recomendo a área financeira levar para tabela se crescer |
| `obra_vgv` | 32 KB | `js/nucleo/sienge-api.js:1935`, `:1957` | **vira tabela** `obra_vgv` (§11) |
| `partner_parametrizations` | 83 KB | `js/financeiro/parametrizacao-parceiro.js:1214`, `:1241`; `pagar-reembolso.js:658` | **vira tabela** `parcerias` (§12), área financeiro |
| `reintegracao_posse` | 0,1 KB | `js/juridico/reintegracao-posse.js:200`, `:221` | jurídico; `fichas{customerId: {...}}` — candidato a tabela no jurídico |
| `repactuacao_planilha` | 0,8 KB | `js/cobranca/repactuacao-lote.js:1126`, `:1170` | cobrança; URLs do Storage do Firebase (migrar arquivos junto) |
| `vistoria_recorrencia` | — (não está na amostra) | `js/engenharia/verificar-construcao.js:298`, `:336` | engenharia |
| `followup_cnd` | — (não está na amostra) | `js/fiscal/followup-cnd.js:241`, `:261` | fiscal |
| `crm_users`, `back_office_perms` | — | — | Fase 1, fora desta carga |

`valor` = o documento inteiro como está (mapas já são objetos). Timestamps dentro do JSON ficam como vieram (epoch ms).

## 10. `fluxos_processo` (de `config/fluxos_processo.fluxos[]`) — área cobrança/jurídico

Colunas: `id`, `nome`, `nomeEm` → `nome_em` (epoch), `oficial`, `responsavelNome/Email/Sienge` →
`responsavel_nome/email/sienge`, `supervisorNome/Email` → `supervisor_nome/email`, `etapas` (jsonb, árvore exibida
em bloco: `{id, parentId, nome, descricao, explicacao, dias, order}`), `createdAt` → `created_at`, `updatedAt` →
`updated_at`. Fase 3: o merge por `seq`/`excluidos` (`fluxos-processo.js:230-330`) pode virar upsert por linha +
delete real. Permissão de escrita: `sub_jur_geral_configuracoes_editar` (Jurídico > Configurações, mesma chave da migration do jurídico).

## 11. `obra_vgv` (de `config/obra_vgv.obras`, 285 obras) — cache regenerável

Mapa `{id: {id, nome, vgv, lancamento, at}}` gravado com merge por chave (`sienge-api.js:1957`). Uma linha por obra:
`vgv` numeric(15,2) (hoje quase tudo `null`), `lancamento` → date (`""` → null), `at` epoch → timestamptz.
`atualizadoEm` do topo: descartar. Pode ser recalculado do Sienge.

## 12. `parcerias` (de `config/partner_parametrizations.list`, string JSON, 12 parceiros) — área financeiro

Colunas: `id`, `companyId` → `company_id`, `companyName`, `partnerName`, `kind`, `obraCode` → `obra_code`,
`defaultPartnerShare` → `default_partner_share`, `contaTerrenista`, `contaDistribuicao`, `sociosSeed`,
`createdAt` → `created_at`, `creditor` (jsonb), `obras` (jsonb, estrutura aninhada exibida/editada em bloco),
`costCenters` → `cost_centers` (jsonb), `socios` (jsonb); posição no array → `ordem`. O código lê a lista inteira e
regrava inteira (`persist`) → Fase 3: upsert de todas + delete das removidas.

## 13. `settings` → `configuracoes` (chave `settings/<id>`)

| Documento | Código | Nota |
|---|---|---|
| `docpadrao_carta`, `_distrato`, `_escritura`, `_quitacao`, `_reneg`, `_suspensao`, `_terceiros`, `_vencimento` (e `_permuta`, se existir) | `app.js:46269` (grava), `:46497` (lê), `:47268`; `js/cobranca/relacionamento.js:341` | modelos de documento; valor = doc inteiro (`{"doc-carta-assunto": ..., ...}`). Permissão da tela: `sub_cfg_apoio_doc_padrao_editar` (não aplicada: tabela genérica) |
| `subjudice_integra` | `app.js:57870`, `:57894` | jurídico; `clients{"<cliente>-<venda>": {...}}` regravado inteiro. Candidato a tabela no jurídico |
| `whatsapp_alerts` | `app.js:57385`, `:57411` | cobrança |
| `boleto_teste_purged_titulo_4868_v4/_v5`, `nex_removed_titulo_12753`, `nex_cleared_all_20260828`, `nex_purged_2026-08-27` | `app.js:38414`, `:38444`, `:38534`, `:38661` | marcas de limpezas únicas já feitas; importar para o código não refazer a limpeza |

## 14. `config_stages/construction` → `configuracoes` chave `config_stages/construction`

Coleção vazia na amostra. `js/engenharia/construcao.js:15`, `:32`: `{stages: [...]}` lido e gravado inteiro. Área engenharia.

---

## 15. `tags` (49 docs)

Código: `js/nucleo/config-tags.js:46`, `:247-251` (update/addDoc), `:272` (deleteDoc), `:445`, `:672` (addDoc ao aprovar
solicitação); `js/cobranca/anexos.js:3980`. Colunas: `name`, `destino`, `status`, `created_by`, `is_default` (1 →
true, ausente → false), `solicitacao_id`. Campos alternativos lidos pelo front (`nome`, `tag`) → `extra` se aparecerem.
`id` mantido (numérico como texto ou id automático). Sem listener (o `onSnapshot` de `config-tags.js:538` é em `tag_solicitacoes`).
RLS: grava quem tem `sub_cfg_apoio_tags_editar` — inclusive a aprovação de solicitação (conferir se quem aprova tem essa chave).

## 16. `anexos_tag_memory` (200+ docs)

Código: `js/cobranca/anexos.js:627` (lê tudo), `:644` (setDoc merge), pontuação em `:986-988` (usa `rejected`,
`confirmed`, `hits` → ficam como colunas mesmo raros). Colunas: `tag`, `originalName` → `original_name`, `pending`,
`phraseKey` → `phrase_key`, `colors` → `text[]`, `phrases` → `text[]`, `aspect` numeric, `learnedAt` → `learned_at`,
`confirmed`, `rejected`, `hits`, `updatedAt` → `updated_at`. O campo `id` dentro do doc = id do doc (não duplicar).

## 17. `anexos_mapa` (26 docs, 522 envios) — doc por empreendimento → uma linha por envio

Código: `js/cobranca/anexos.js:541` (lê o mapa do cc), `:600-614` (lê, acrescenta item, regrava o mapa),
`:2624`; `app.js:4720` (lê todos para a auditoria); servidor `lib/distrato-followup-core.js:169` (procura DISTRATO
por título/unidade — busca item a item, por isso uma linha por envio).
`id` = `<enterpriseId>_<chave>`; `enterprise_id` = id do doc; `chave` = chave do `byKey` (`<contractId>_<TAG>`).
Colunas: `contractId` → `contract_id` (texto), `contractNumber`, `tag`, `destination`, `fileName`, `description`,
`unitId`, `unitName`, `sentBy` (60%), `sentAt` → `sent_at`, `source`, `copiaIntegra`, `storagePath` (caminho no
Storage do Firebase: migrar arquivos `anexos_termos/...`). `updatedAt` do doc: descartar (usar `sent_at`).
Fase 3: `anexosSaveMapaEnvio` vira upsert de uma linha (onConflict `enterprise_id,chave`), mantendo a regra de herdar
`storage_path` do registro anterior.

## 18. `auditoria_logs` (200+ docs)

Código: gravação `js/nucleo/sienge-api.js:616` (`setDoc` por id), servidor `lib/caucao-batimento.js:164`; leitura
`sienge-api.js:701` (`orderBy("timestamp","desc"), limit(400)`), `js/cobranca/relatorio-honorarios.js:244`
(`where("action","==","BOLETO_GERADO")`). Índices: `timestamp desc` e `(action, timestamp desc)`.
Colunas: `timestamp` (coluna `"timestamp"`), **`user` → `user_name`** (palavra reservada), `userEmail` → `user_email`,
`action`, `module`, `status`, `summary`, `customerId`, `customerLabel`, `enterpriseId`, `enterpriseName`, `unitId`,
`unitName`, `titleId`, `endpoint`, `method`, `details` (jsonb; pode vir `{truncated, preview}`).
Somente inclusão (sem política de update/delete). Coleção grande em produção: importar em lotes.

## 19. `auditoria_login_relatorios` + `auditoria_login_partes` → `auditoria_login_relatorios` + `auditoria_login_linhas`

Código: `js/nucleo/auditoria-login.js:190-191` (lê tudo), `:272` (grava partes de 2.500 linhas), `:274` (relatório),
`:301-305` (apaga partes por `where("relatorioId")` e o relatório). A tela filtra acesso a acesso (por período, usuário,
departamento) → **shards somem, uma linha por acesso**.
Relatório: `arquivo`, `periodoDe/Ate` → `periodo_de/ate` (date), `total`, `usuarios`, `bloqueios`, `partes`,
`enviadoPor`, `enviadoPorEmail`, `enviadoEm`.
Linhas: cada parte `{relatorioId, n, linhas: "<JSON>"}`; `JSON.parse(linhas)` dá tuplas
`[usuario, ip, ok(0/1), entrada "AAAA-MM-DD HH:MM", saida|"" , modo, motivo]` (`compactar`/`expandir`,
`auditoria-login.js:170-176`). → `usuario`, `ip`, `sucesso`, `entrada`/`saida` (hora local do Sienge:
interpretar como `America/Sao_Paulo`; `""` → null), `modo`, `motivo`, `ordem = n*2500 + i`.
Apagar relatório: `delete` do relatório (FK `on delete cascade` leva as linhas). A deduplicação entre relatórios
(`chave = a.slice(0,5)`) continua no front.

## 20. `usuarios_online` (53 docs) — realtime

Código: `js/nucleo/usuarios-online.js:145`/`:206` (doc `presenceId`: e-mail, ou `e-mail__<sessão>` no login
compartilhado de advogados), `:146` (lê as sessões gravadas), `:164`, `:213` (setDoc merge), `:277` (**onSnapshot**
da coleção inteira). Colunas: `email`, `name`, `contaEmail` → `conta_email`, `contaName`, `profile`, `online`,
`since`/`lastSeen`/`lastUse`/`logoutAt` (epoch ms → timestamptz), `lastSeenAt` (serverTimestamp → timestamptz),
`tab`, `tabLabel`, `agent`, `sessoes` (jsonb, últimas 80, exibidas em bloco).
Fase 3: o front faz conta com ms (`seenAt`, `isOnline`) — converter com `Date.parse`. `serverTimestamp()` → omitir e
usar `atualizado_em` (trigger) ou `now()`.
RLS: grava a própria linha se `email` **ou** `conta_email` = e-mail do JWT (cobre login compartilhado e "atuando como").

## 21. `api_consumo` (52 docs) — contadores → RPC

Código: `js/nucleo/sienge-api.js:920` (constantes), `:1083-1147` (`flush` com `increment` aninhado e `setDoc merge`),
`:1191` (`loadDays`: lê o doc de cada um dos últimos N dias). Id = dia `AAAA-MM-DD`.
Colunas: `date`, `rest`, `bulk`, `actors`/`apis`/`users` (jsonb), `updatedAt` → `updated_at`.
**Importador**: vários docs têm campos com ponto no nome no topo (`"apis._units.rest": 29`, `"users._sistema.label"`)
— gravados por update com caminho. Aplicar a mesma regra de `ApiUsage.nestDottedFields` (`sienge-api.js:1160`) antes
de gravar: aninhar na ordem dos campos do doc (o último vence).
Fase 3: `flush` chama `rpc('incrementar_api_consumo', {p_data, p_delta})` com os números puros.
RLS: leitura liberada a ativos (o upsert da RPC exige ler a linha); a tela continua protegida pelo menu
(`sub_seg_geral_consumo_api_visualizar`).

## 22. `ambientes_dev` (6 docs) → uma linha por (e-mail, bolha)

Código: `js/nucleo/aviso-develop.js:280` (setDoc merge `{email, ambientes: {<chave>: Date.now()}}`), `:291` (lê o
próprio doc). Importador: para cada doc, cada par do mapa `ambientes` vira linha `(email, ambiente, acessado_em)`.
Fase 3: upsert onConflict `email,ambiente`. (O `where("ambiente")` de `:835` é na coleção de solicitações, não aqui.)

## 23. `alertas_ciente` (1 doc) → uma linha por ciente

Código: `js/nucleo/alerta-ponto.js:80` (lê `alertas_ciente/ponto_israel`), `:94` (merge `{<tipo>_<dia>: "ciente"}`).
Importador: id do doc → `alerta`; cada campo `<tipo>_<AAAA-MM-DD>` com valor `"ciente"` → `tipo`, `dia`;
`usuario_email` = `israel@mouraleite.com.br` (o alerta é só dessa conta, `alerta-ponto.js:56-60`).

## 24. `suporte_chamados` (106 docs) — realtime

Código: `js/nucleo/suporte.js:690` (**onSnapshot** da coleção inteira para o contador de não lidos), `:1037` (addDoc),
`:1041`, `:1216`, `:1472`, `:1525` (updateDoc), `:1134` (lê tudo e ordena por `updatedAt`), `:1316`.
Colunas: `tipo`, `status` (`pendente`/`em_atendimento`/`atendido`), `modulo`, `subitem`, `subitemLabel`, `aba`,
`abaLabel`, `localPath`, `descricao`, `imagens` (jsonb `[{url,...}]`, URLs do Storage do Firebase — migrar arquivos
`suporte/<id>/...`), `mensagens` (jsonb `[{papel, autorNome, autorEmail, at, texto, imagens}]`, exibidas em bloco),
`userId`, `userName`, `userEmail`, `createdByAdmin`, `arquivadoAt` (`null` explícito → null), `arquivadoPor`,
`responsavelEmail/Nome/Em` (2%, mantidos como coluna: atribuição recém-criada), `createdAt`, `updatedAt`.
RLS: autor (`user_email` = JWT) ou quem tem `mod_suporte`/`sub_suporte_geral_chamados_acessar` (mesma regra de
`isAdmin()` em `suporte.js:267-273`). Com a RLS o listener de cada usuário só recebe os próprios chamados.

## 25. `documentos_autenticados` (25 docs)

Código: gravação `app.js:24102` (acordo, merge), `js/cobranca/cessao-direitos.js:3101` (cessão), `app.js:23952`
(`substituido`), `:24432` (`reparcelamentoEnviado`); leitura por código `app.js:24396`, `js/cobranca/anexos.js:4209`.
Colunas: `codigo` (= id), `tipo`, `tipoNome`, `hash`, `titulo`, `unidade`, `cliente`, `arquivo`, `em`,
`reparcelamento` (jsonb), `reparcelamentoEnviado/Em`, `substituido`. Sem exclusão no código.

## 26. `agenda_personal_notes` (34 docs) e `agenda_recurring_notes` (vazia) — realtime

Código: listeners `app.js:8557` e `:8587` (**onSnapshot** das coleções inteiras, `docChanges`), gravação
`app.js:8700`, `:8704` (setDoc merge de **todas** as chaves do localStorage), `:34816`, `:35112`, `:56817`, `:56827`.
Id do doc = `<NOME DO DONO>_<AAAA-MM-DD>`; dono `TODOS`/`Todos` = lembrete para todos; cada nota pode ter
`sharedWith: [emails]`. Decisão: uma linha por doc com `notes` jsonb (o front trabalha com o mapa `{id: notes[]}` e a
lista é pequena); compartilhamento resolvido na RLS por `notes @> [{"sharedWith":[email]}]` (índice GIN).
Colunas: `id` (mantido), `dono` (prefixo antes do 1º `_`), `data` (resto; date se válido), `usuario_id`
(importador resolve `dono` primeiro em `usuarios.sienge_user` — é o nome usado no prefixo, ex. `LUCELIA JUSTO` —
e depois em `usuarios.nome`, os dois sem acento/maiúsculas; `TODOS` → null), `notes`.
Atenção importador: na amostra há donos com nomes divergentes do cadastro (`LUCELIA JUSTO` × `LUCELIA SALVADOR JUSTO`,
`MICHELLE PEREIRA` × `MICHELLE PEREIRA YAMASHIRO`) — listar os não resolvidos; sem `usuario_id` só o admin vê.
Fase 3: gravar só as chaves do próprio usuário/TODOS/compartilhadas (hoje grava todas; com RLS as alheias falham e um
upsert em lote cairia inteiro); preencher `usuario_id = auth.uid()` ao criar.

## 27. `sienge_sync_state` (1 doc) — só servidor

`api/_lib/sync-creditors.js:25-26` (`creditors`), `:86` (lê), `:91` (grava), trava em `:194-229`. Colunas: `lock`,
`running`, `phase`, `date` (date), **`offset` → `posicao`** (palavra reservada), `total`, `gravados`, `removidos`,
`done`, `erro`, `finishedAt`, `updatedAt`. RLS sem política (service role).

## 28. `kmz_coordinates` (9 docs na amostra) — cache regenerável

Código: upload `app.js:48125-48155` (doc `<empId>` com `placemarks`/`quadras`; se passar de 1 MB, quadras vão para
`<empId>_quadras` e o pai guarda `quadrasDoc`), leitura `app.js:48175-48180`, `:48593-48596`, `:50281`, `:16548`,
`js/engenharia/vistoria.js:231`, lista `app.js:48865` (ignora ids que não são 4-6 dígitos), exclusão `:48906`.
Decisão: **uma linha por empreendimento**, `placemarks`/`quadras` em jsonb (até ~400 KB): o código lê o bloco e procura
o lote no array por nome normalizado; o conteúdo é regerável a partir de `kmz/<id>.kmz` no Storage.
Colunas: `empreendimento_id`, `placemarks`, `quadras`, `count`, `quadraCount` → `quadra_count`, `updatedAt`.
Importador: doc `<id>_quadras` → juntar `quadras` na linha `<id>` (descartar `quadrasDoc`). Docs com id automático e
`{empreendimento_id, coordinates, lot_name}` (4 na amostra) são formato antigo ignorado pela lista: **não importar**
(guardar no relatório do importador).

---

## Pontos para o dono revisar

1. `configuracoes` aceita gravação de qualquer usuário ativo (muitas telas gravam chaves diferentes). Se quiser,
   dá para restringir por prefixo/chave numa segunda etapa.
2. Chaves de `config/global` que são registros de negócio e deveriam virar tabela na área dona:
   `crm_moura_financiamentos_proc`, `crm_compromissario_cessao_v1` (cobrança), `crm_engenharia_caucao_*` (engenharia),
   `gp_conferencia`, `ctb_equiv` (financeiro/contábil), `subjudice_integra`, `reintegracao_posse` (jurídico).
3. Permissões não identificadas (ficou o padrão): `cartorios`, `central_email_templates`,
   `parcerias`, `obra_vgv`, `documentos_autenticados`, `anexos_*`.
4. Possível colisão de nomes com outras áreas: `empresas`, `centros_custo`, `parcerias`.
5. `crm_perms_bak_*` descartadas.
