-- Fase 2 · Área cobrança / clientes / relacionamento / jurídico.
-- Mapa campo -> coluna e notas para o importador: docs/mapa-tabelas/cobranca-juridico.md
-- Depende de 202611191200_usuarios_e_acesso.sql (schema privado, tocar_atualizado_em, usuario_ativo,
-- eh_admin, tem_permissao). Referências a entidades de outras áreas são colunas text, sem FK.

-- =====================================================================================
-- Funções de apoio (schema privado)
-- =====================================================================================

-- Carimbo de versão de uma ocorrência, igual ao window.occurrenceStamp do app:
-- promiseStatusAt || updatedAt || lastEdit.date; sem nada (ou texto inválido) = -infinity.
create or replace function privado.carimbo_nota(
  p_promise_status_at timestamptz,
  p_updated_at        timestamptz,
  p_last_edit         jsonb
) returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p_promise_status_at is not null then return p_promise_status_at; end if;
  if p_updated_at is not null then return p_updated_at; end if;
  begin
    return coalesce(nullif(p_last_edit ->> 'date', '')::timestamptz, '-infinity'::timestamptz);
  exception when others then
    return '-infinity'::timestamptz;
  end;
end $$;

revoke all on function privado.carimbo_nota(timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function privado.carimbo_nota(timestamptz, timestamptz, jsonb) to authenticated, service_role;

-- =====================================================================================
-- Clientes (espelho do Sienge)
-- =====================================================================================

-- sienge_customers: cadastro de clientes copiado do Sienge (api/_lib/sync-customers.js) + marca de sub judice.
create table public.sienge_customers (
  id                         text primary key,            -- id do cliente no Sienge (doc id = String(id))
  name                       text not null,
  person_type                text,                        -- "Física" / "Jurídica"
  client_type                text,
  foreigner                  text,                        -- "N"/"S" como vem do Sienge
  cpf                        text,
  cnpj                       text,
  international_id           text,
  email                      text,
  number_identity_card       text,
  issuing_body               text,
  issue_date_identity_card   date,
  birth_date                 date,
  birth_place                text,
  nationality                text,
  sex                        text,
  civil_status               text,
  matrimonial_regime         text,
  marriage_date              date,
  mother_name                text,
  father_name                text,
  profession                 text,
  mailing_address            text,
  social_name                text,
  license_number             text,
  license_issuing_body       text,
  license_issue_date         date,
  phones                     jsonb not null default '[]'::jsonb,
  addresses                  jsonb not null default '[]'::jsonb,
  contacts                   jsonb not null default '[]'::jsonb,
  procurators                jsonb not null default '[]'::jsonb,
  sub_types                  jsonb not null default '[]'::jsonb,
  family_income              jsonb not null default '[]'::jsonb,
  spouse                     jsonb,
  created_at                 date,                        -- data de cadastro no Sienge
  modified_at                date,
  modified_at_date_time      timestamptz,                 -- "AAAA-MM-DD HH:MM:SS.mmm" (hora de São Paulo)
  is_subjudice               boolean not null default false,
  subjudice_entry_date       timestamptz,
  subjudice_exit_date        timestamptz,
  extra                      jsonb not null default '{}'::jsonb,  -- campos de PJ (cnaeNumber, agents, note...) e raros
  criado_em                  timestamptz not null default now(),
  atualizado_em              timestamptz not null default now()
);
create index sienge_customers_cpf_idx on public.sienge_customers (cpf);
create index sienge_customers_cnpj_idx on public.sienge_customers (cnpj) where cnpj is not null;
create index sienge_customers_subjudice_idx on public.sienge_customers (id) where is_subjudice;
create index sienge_customers_modified_at_idx on public.sienge_customers (modified_at);

-- =====================================================================================
-- Cobrança: cache diário da carteira inadimplente e histórico
-- =====================================================================================

-- sienge_defaulters_history: cache regenerável do dia (títulos vencidos do Sienge), dividido em blocos.
-- Uma linha por documento do Firestore: "<dia>" (ficha), "<dia>_chunk_<n>", "<dia>_pronta", "<dia>_pronta_<n>",
-- "<dia>_warmup_<empresa>_<lote>", "<dia>_income_<n>" e os estados do cron ("_warmup_state", "_cfin_state", "_cfin_meta").
create table public.sienge_defaulters_history (
  id                     text primary key,
  date                   date,                 -- dia do cache (campo date ou prefixo do id)
  tipo                   text not null check (tipo in ('ficha', 'bloco', 'pronta', 'pronta_bloco', 'warmup', 'income', 'estado')),
  indice                 integer,              -- n do bloco (chunk/pronta/income) ou lote do warmup
  data                   jsonb,                -- conteúdo do bloco (no Firestore era texto JSON)
  chunks                 integer,              -- ficha/pronta: quantos blocos
  count                  integer,              -- pronta: quantos títulos
  rev                    integer,              -- pronta: FILA_PRONTA_REV
  cache_rev              integer,              -- ficha: DEFAULTERS_CACHE_REV
  timestamp_str          text,
  at_full                text,
  paid_map               jsonb,                -- era texto JSON: [[billId, dias], ...]
  paid_installment_ids   jsonb,                -- era texto JSON
  company_ids            jsonb,
  company_id             text,                 -- warmup
  warmup_done            boolean,
  batimento_pedido_em    timestamptz,
  created_at             timestamptz,
  extra                  jsonb not null default '{}'::jsonb,  -- estados do cron vão inteiros aqui
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index sienge_defaulters_history_date_idx on public.sienge_defaulters_history (date, tipo, indice);

-- inadimplencia_snapshots: posição diária da carteira (um doc por dia, id = AAAA-MM-DD).
create table public.inadimplencia_snapshots (
  id                   text primary key,       -- AAAA-MM-DD
  date                 date not null,
  total_value          numeric(15,2),
  total_count          integer,
  total_customers      integer,
  avg_ticket           numeric(15,2),
  subjudice_value      numeric(15,2),
  subjudice_count      integer,
  subjudice_customers  integer,
  subjudice_detail     jsonb,                  -- { clients: [...], cost_centers: [...] }
  recovered_count      integer,
  new_count            integer,
  is_week_start        boolean,
  is_week_end          boolean,
  is_month_close       boolean,
  data_json            jsonb,                  -- detalhe por empresa/centro/operador (às vezes era texto JSON)
  source_count         integer,
  saved_at             timestamptz,
  sprint_clients       integer,
  sprint_titles        integer,
  sprint_value         numeric(15,2),
  sprint_avg_delay     integer,
  sprint_saved_at      timestamptz,
  sprint_origem        text,
  extra                jsonb not null default '{}'::jsonb,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
create index inadimplencia_snapshots_date_idx on public.inadimplencia_snapshots (date);

-- =====================================================================================
-- Ocorrências (notas) de cobrança e etapas judiciais: uma linha por nota
-- =====================================================================================

-- customer_notes: ocorrências de cobrança. Origem atual: customer_notes_shards (chunk_N -> { <cliente>: [notas] });
-- legado: customer_notes/<cliente> { notes: [...] }.
create table public.customer_notes (
  id                            text primary key,   -- id da nota (uuid do app) ou id gerado na carga para notas sem id
  customer_id                   text not null,      -- chave do cliente no shard
  date                          timestamptz not null,
  author                        text,
  text                          text not null default '',
  canal                         text,
  iniciativa                    text,
  reminder                      text,
  status                        text,               -- "Cancelada" (filtro do histórico)
  promise_status                text,
  promise_date                  date,
  promise_status_at             timestamptz,
  promised_installments         text[] not null default '{}',
  sale_id                       text,
  unit_id                       text,
  contract_id                   text,
  receivable_bill_id            text,
  pinned                        boolean not null default false,
  webro_baixa                   boolean,
  reuniao_semanal_terceirizada  boolean,
  check_payment                 boolean,
  check_payment_date            date,
  boleto_due_date               date,
  nex_locked                    boolean,
  nex_id                        text,
  colenci_pix                   boolean,
  colenci_prazo                 date,
  customer_name                 text,
  unit_label                    text,
  valor_atualizado              numeric(15,2),
  desconto_encargos_pct         numeric,
  origem                        text,
  attachments                   jsonb not null default '[]'::jsonb,
  past_texts                    text[] not null default '{}',
  last_edit                     jsonb,              -- { author, date }
  updated_at                    timestamptz,
  extra                         jsonb not null default '{}'::jsonb,  -- lastErrata, systemUpdatedStatus, raros
  criado_em                     timestamptz not null default now(),
  atualizado_em                 timestamptz not null default now()
);
create index customer_notes_customer_idx on public.customer_notes (customer_id, date);
create index customer_notes_sale_idx on public.customer_notes (sale_id);
create index customer_notes_promise_date_idx on public.customer_notes (promise_date) where promise_date is not null;
create index customer_notes_check_payment_idx on public.customer_notes (check_payment_date) where check_payment;
create index customer_notes_nex_idx on public.customer_notes (nex_id) where nex_id is not null;
create index customer_notes_date_idx on public.customer_notes (date);
-- Realtime por cliente (filtro customer_id) precisa da linha antiga inteira nos deletes.
alter table public.customer_notes replica identity full;

-- jud_notes: etapas/ocorrências judiciais. Origem atual: jud_notes_shards e customer_jud_notes_shards (cópias
-- gravadas juntas); legado: jud_notes/<cliente> { notes: [...] }.
create table public.jud_notes (
  id                    text primary key,        -- "jud_<epoch>"
  customer_id           text not null,
  date                  timestamptz not null,
  author                text,
  text                  text not null default '',
  type                  text,                    -- "Judicial"
  fase                  text,
  fase_id               text,
  prazo                 date,
  pinned                boolean not null default false,
  sem_alteracao         boolean,
  etapa_inicio          timestamptz,
  last_edit             jsonb,
  agreement_attachment  jsonb,
  replies               jsonb,
  extra                 jsonb not null default '{}'::jsonb,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index jud_notes_customer_idx on public.jud_notes (customer_id, date);
create index jud_notes_prazo_idx on public.jud_notes (prazo) where prazo is not null;
create index jud_notes_fase_id_idx on public.jud_notes (fase_id) where fase_id is not null;
alter table public.jud_notes replica identity full;

-- =====================================================================================
-- Jurídico
-- =====================================================================================

-- processos_judiciais: número do processo do cliente (doc id = customerId).
create table public.processos_judiciais (
  id             text primary key,           -- customerId
  customer_id    text not null,
  numero         text,
  updated_at     timestamptz,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index processos_judiciais_customer_idx on public.processos_judiciais (customer_id);

-- processos_contra_motivos: catálogo de motivos (era o doc "lista" com itens[]). Um motivo por linha.
create table public.processos_contra_motivos (
  id             text primary key,           -- id do motivo ("atraso-obra"...), = fluxo em config/fluxos_processo
  nome           text not null,
  ordem          integer not null default 0,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- processos_contra: processos movidos contra a empresa ou pela empresa (js/juridico/processo-contra.js).
create table public.processos_contra (
  id             text primary key,           -- "pc_<epoch>"
  parte_tipo     text,                       -- cliente / credor / prefeitura / terceiro / empresa
  parte_id       text,
  parte_nome     text,
  parte_rotulo   text,
  customer_id    text,                       -- só quando parte_tipo = cliente ('' no Firestore vira null)
  company_id     text,
  company_name   text,
  autor_tipo     text,                       -- empresa / cliente
  polo_empresa   text,                       -- autor / reu
  autor_nome     text,
  reu_nome       text,
  valor_causa    numeric(15,2),
  processo       text,
  motivo         text,
  motivo_id      text,                       -- sem FK: o nome do motivo é gravado junto (histórico)
  anexos         jsonb not null default '[]'::jsonb,   -- [{ name, url, type, size, path }]
  created_at     timestamptz,
  created_by     text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index processos_contra_customer_idx on public.processos_contra (customer_id) where customer_id is not null;
create index processos_contra_motivo_idx on public.processos_contra (motivo_id);
create index processos_contra_created_at_idx on public.processos_contra (created_at desc);

-- custas_judiciais: custas pagas no processo e o reembolso (Pagar reembolso / batimento das 7h).
create table public.custas_judiciais (
  id                 text primary key,       -- "<customerId>_<saleId>_<epoch>"
  customer_id        text not null,
  sale_id            text not null,
  customer_name      text,
  data               date,                   -- data de pagamento das custas
  descricao          text,
  tipos              text[] not null default '{}',
  valor              numeric(15,2),
  guias              jsonb not null default '[]'::jsonb,
  comprovantes       jsonb not null default '[]'::jsonb,
  anexos             jsonb not null default '[]'::jsonb,
  company_id         text,
  company_name       text,
  cost_center_id     text,
  unit_name          text,
  processo           text,
  bill_id            text,                   -- título a pagar do reembolso no Sienge ('' = ainda não liberado)
  document_number    text,
  notes              text,
  due_date           date,
  liberated_at       timestamptz,
  liberated_by       text,
  reem_pago          boolean,
  reem_conferido_em  timestamptz,
  pago_em            date,
  created_at         timestamptz,
  created_by         text,
  updated_at         timestamptz,
  updated_by         text,
  extra              jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index custas_judiciais_cliente_titulo_idx on public.custas_judiciais (customer_id, sale_id);
create index custas_judiciais_bill_idx on public.custas_judiciais (bill_id) where bill_id is not null and bill_id <> '';

-- =====================================================================================
-- Boletos (honorários, pagamentos conferidos, baixa no banco)
-- =====================================================================================

-- boletos_honorarios: um registro por boleto gerado (relatório de honorários).
create table public.boletos_honorarios (
  id                text primary key,        -- "<billId>_<epoch>"
  key               text,                    -- "billId|parcelas|vencimento|geração"
  competencia       text not null,           -- "AAAA-MM"
  generated_at      timestamptz,
  generated_date    date,
  source            text,
  author            text,
  author_email      text,
  author_profile    text,
  terceirizado      boolean not null default false,
  company_id        text,
  company_name      text,
  enterprise_id     text,
  enterprise_name   text,
  unit_id           text,
  unit_name         text,
  customer_id       text,
  customer_name     text,
  customer_doc      text,
  bill_id           text,
  contract_number   text,
  boleto_due_date   date,
  fine_pct          numeric,
  interest_pct      numeric,
  honorarios_pct    numeric,
  taxa              numeric,
  parcelas          jsonb not null default '[]'::jsonb,   -- lida inteira com o registro
  totais            jsonb not null default '{}'::jsonb,   -- { valorOriginal, multa, juros, honorarios }
  extra             jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index boletos_honorarios_competencia_idx on public.boletos_honorarios (competencia);
create index boletos_honorarios_customer_idx on public.boletos_honorarios (customer_id);
create index boletos_honorarios_bill_idx on public.boletos_honorarios (bill_id);

-- boletos_pagamentos: cache da conferência de pagamento de cada boleto (id = recId com "/" -> "_").
-- Sem FK para boletos_honorarios: recId também vem de boletos reconstruídos da auditoria.
create table public.boletos_pagamentos (
  id             text primary key,
  rec_id         text not null,
  competencia    text not null,
  customer_id    text,
  bill_id        text,
  all_paid       boolean,
  checked_at     timestamptz,
  checked_date   date,
  parcelas       jsonb not null default '[]'::jsonb,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index boletos_pagamentos_competencia_idx on public.boletos_pagamentos (competencia);
create index boletos_pagamentos_rec_idx on public.boletos_pagamentos (rec_id);

-- boletos_baixa_banco: baixa de boleto no banco com comprovante (id automático do addDoc).
create table public.boletos_baixa_banco (
  id                   text primary key default gen_random_uuid()::text,
  titulo               text not null,
  customer_id          text,
  parcelas             text[] not null default '{}',     -- installmentId
  parcelas_numero      text[] not null default '{}',
  linha                text,                             -- linha digitável
  nosso_numero         text,
  valor                numeric(15,2),
  vencimento           date,                             -- era "DD/MM/AAAA"
  conferido_por        text,
  comprovante          text,                             -- caminho no Storage
  comprovante_nome     text,
  informado_por_email  text,
  informado_por_nome   text,
  informado_em         timestamptz,
  extra                jsonb not null default '{}'::jsonb,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
create index boletos_baixa_banco_titulo_idx on public.boletos_baixa_banco (titulo);
create index boletos_baixa_banco_customer_idx on public.boletos_baixa_banco (customer_id);

-- =====================================================================================
-- NEX (cartas de notificação extrajudicial): uma linha por carta
-- =====================================================================================

-- nex_letters: era um doc por "<customerId>_<titulo>" com items[] (cartas). A mesma carta pode aparecer em mais
-- de um título do cliente (o app replica a carta atualizada), por isso a chave é (doc_id, item_id).
create table public.nex_letters (
  id             bigint generated always as identity primary key,
  doc_id         text not null,              -- id do doc de origem: "<customerId>_<titulo>"
  item_id        text not null,              -- "nex_<epoch>_<n>"
  customer_id    text not null,
  sale_id        text,                       -- saleId do doc
  titulo         text,                       -- titulo do item (ou do doc)
  customer_name  text,
  letter_type    text,
  unit_label     text,
  date           date,
  author         text,
  status         text,
  tracking       text,
  zero_paid      boolean,
  lost_pay_iso   date,
  delivered_at   date,
  ar_digital     jsonb,
  html           text,
  created_at     timestamptz,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (doc_id, item_id)
);
create index nex_letters_customer_idx on public.nex_letters (customer_id);
create index nex_letters_item_idx on public.nex_letters (item_id);
create index nex_letters_tracking_idx on public.nex_letters (tracking) where tracking is not null;

-- =====================================================================================
-- Renegociação
-- =====================================================================================

-- reneg_propostas: proposta de acordo aguardando sinal (id = "<customerId>_<saleId>").
create table public.reneg_propostas (
  id                 text primary key,
  customer_id        text not null,
  sale_id            text not null,
  customer_name      text,
  status             text not null default 'ativa',   -- ativa / expirada / concluida
  cenario            text,
  payment_method     text,
  sinal_pct          numeric,
  sinal_value        numeric(15,2),
  sinal_due          date,
  sinal_pago         boolean not null default false,
  sinal_pago_em      timestamptz,
  expira_em          date,
  expirada_em        timestamptz,
  concluida_em       timestamptz,
  inst_qty           integer,
  installment_value  numeric(15,2),
  first_due_date     date,
  selected_bill_ids  text[] not null default '{}',
  codigo_auth        text,                             -- id em documentos_autenticados (outra área)
  reparcelamento     jsonb,
  created_at         timestamptz,
  created_by         text,
  created_by_email   text,
  extra              jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index reneg_propostas_customer_idx on public.reneg_propostas (customer_id, sale_id);
create index reneg_propostas_status_idx on public.reneg_propostas (status);

-- reneg_liberacao: pedido do operador para o administrador liberar uma modalidade de acordo (vazia hoje).
-- criadoEm (epoch ms) vai para a coluna padrão criado_em.
create table public.reneg_liberacao (
  id               text primary key,          -- "p<epoch>"
  status           text not null default 'pendente' check (status in ('pendente', 'liberada', 'recusada')),
  customer_id      text,
  cliente          text,
  titulo           text,
  unidade          text,
  modalidade       text,
  modalidade_nome  text,
  pmp              integer,
  contratos        jsonb not null default '[]'::jsonb,
  pago             numeric(15,2),
  pct_pago         numeric,
  saldo_devedor    numeric(15,2),
  construcao       text,
  acordos          integer,
  pagas_qtd        integer,
  pagas_valor      numeric(15,2),
  vencidas_qtd     integer,
  vencidas_valor   numeric(15,2),
  a_vencer_qtd     integer,
  a_vencer_valor   numeric(15,2),
  justificativa    text,
  operador         text,
  decidido_em      timestamptz,
  decidido_por     text,
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index reneg_liberacao_status_idx on public.reneg_liberacao (status, criado_em desc);
create index reneg_liberacao_titulo_idx on public.reneg_liberacao (titulo);

-- =====================================================================================
-- Relacionamento
-- =====================================================================================

-- relacionamento_docs_assinatura: documentos gerados que aguardam assinatura/lançamento (id do addDoc).
create table public.relacionamento_docs_assinatura (
  id             text primary key default gen_random_uuid()::text,
  tipo           text not null,              -- distrato / cessao / aditamento / ...
  tipo_label     text,
  status         text not null default 'aguardando',   -- aguardando / lancado
  cliente        text,
  titulo         text,
  unidade        text,
  arquivo        text,
  centro_id      text,
  centro_nome    text,
  titular_id     text,
  titular_nome   text,
  cedente_nome   text,
  cessionario    text,
  plano          text,                       -- "parcela:data:valor|..." (cessão/aditamento)
  pdf_url        text,
  user_id        text,                       -- id legado do usuário (config/crm_users)
  user_name      text,
  user_email     text,
  created_at     timestamptz,
  lancado_em     timestamptz,
  lancado_por    text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index relacionamento_docs_assinatura_status_idx on public.relacionamento_docs_assinatura (status, tipo);
create index relacionamento_docs_assinatura_titulo_idx on public.relacionamento_docs_assinatura (titulo);

-- registro_cadastro: último arquivo de unidades enviado na tela Registro (era "atual" + partes "atual_N" com
-- pedaços de um texto JSON). Agora: a ficha em registro_cadastro e uma linha por unidade na tabela filha.
create table public.registro_cadastro (
  id             text primary key,           -- "atual"
  arquivo        text,
  quando         timestamptz,
  por            text,
  unidades       integer,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table public.registro_cadastro_linhas (
  id             bigint generated always as identity primary key,
  registro_id    text not null references public.registro_cadastro (id) on delete cascade,
  ordem          integer not null,
  empresa_id     text,
  empresa        text,
  obra_id        text,
  obra           text,
  unidade        text,
  letra          text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index registro_cadastro_linhas_registro_idx on public.registro_cadastro_linhas (registro_id, ordem);
create index registro_cadastro_linhas_obra_idx on public.registro_cadastro_linhas (obra_id, unidade);

-- webro_repasse_pendente: títulos com baixa Webro sem repasse (aviso para a pagadoria). id = título saneado.
create table public.webro_repasse_pendente (
  id             text primary key,
  titulo         text not null,
  customer_id    text,
  cliente        text,
  unidade        text,
  operador       text,
  baixa          date,
  visto_em       date,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index webro_repasse_pendente_visto_em_idx on public.webro_repasse_pendente (visto_em);

-- =====================================================================================
-- Triggers de atualizado_em
-- =====================================================================================
create trigger sienge_customers_atualizado_em before update on public.sienge_customers
  for each row execute function privado.tocar_atualizado_em();
create trigger sienge_defaulters_history_atualizado_em before update on public.sienge_defaulters_history
  for each row execute function privado.tocar_atualizado_em();
create trigger inadimplencia_snapshots_atualizado_em before update on public.inadimplencia_snapshots
  for each row execute function privado.tocar_atualizado_em();
create trigger customer_notes_atualizado_em before update on public.customer_notes
  for each row execute function privado.tocar_atualizado_em();
create trigger jud_notes_atualizado_em before update on public.jud_notes
  for each row execute function privado.tocar_atualizado_em();
create trigger processos_judiciais_atualizado_em before update on public.processos_judiciais
  for each row execute function privado.tocar_atualizado_em();
create trigger processos_contra_motivos_atualizado_em before update on public.processos_contra_motivos
  for each row execute function privado.tocar_atualizado_em();
create trigger processos_contra_atualizado_em before update on public.processos_contra
  for each row execute function privado.tocar_atualizado_em();
create trigger custas_judiciais_atualizado_em before update on public.custas_judiciais
  for each row execute function privado.tocar_atualizado_em();
create trigger boletos_honorarios_atualizado_em before update on public.boletos_honorarios
  for each row execute function privado.tocar_atualizado_em();
create trigger boletos_pagamentos_atualizado_em before update on public.boletos_pagamentos
  for each row execute function privado.tocar_atualizado_em();
create trigger boletos_baixa_banco_atualizado_em before update on public.boletos_baixa_banco
  for each row execute function privado.tocar_atualizado_em();
create trigger nex_letters_atualizado_em before update on public.nex_letters
  for each row execute function privado.tocar_atualizado_em();
create trigger reneg_propostas_atualizado_em before update on public.reneg_propostas
  for each row execute function privado.tocar_atualizado_em();
create trigger reneg_liberacao_atualizado_em before update on public.reneg_liberacao
  for each row execute function privado.tocar_atualizado_em();
create trigger relacionamento_docs_assinatura_atualizado_em before update on public.relacionamento_docs_assinatura
  for each row execute function privado.tocar_atualizado_em();
create trigger registro_cadastro_atualizado_em before update on public.registro_cadastro
  for each row execute function privado.tocar_atualizado_em();
create trigger registro_cadastro_linhas_atualizado_em before update on public.registro_cadastro_linhas
  for each row execute function privado.tocar_atualizado_em();
create trigger webro_repasse_pendente_atualizado_em before update on public.webro_repasse_pendente
  for each row execute function privado.tocar_atualizado_em();

-- =====================================================================================
-- RLS
-- =====================================================================================
alter table public.sienge_customers               enable row level security;
alter table public.sienge_defaulters_history      enable row level security;
alter table public.inadimplencia_snapshots        enable row level security;
alter table public.customer_notes                 enable row level security;
alter table public.jud_notes                      enable row level security;
alter table public.processos_judiciais            enable row level security;
alter table public.processos_contra_motivos       enable row level security;
alter table public.processos_contra               enable row level security;
alter table public.custas_judiciais               enable row level security;
alter table public.boletos_honorarios             enable row level security;
alter table public.boletos_pagamentos             enable row level security;
alter table public.boletos_baixa_banco            enable row level security;
alter table public.nex_letters                    enable row level security;
alter table public.reneg_propostas                enable row level security;
alter table public.reneg_liberacao                enable row level security;
alter table public.relacionamento_docs_assinatura enable row level security;
alter table public.registro_cadastro              enable row level security;
alter table public.registro_cadastro_linhas       enable row level security;
alter table public.webro_repasse_pendente         enable row level security;

revoke all on
  public.sienge_customers, public.sienge_defaulters_history, public.inadimplencia_snapshots,
  public.customer_notes, public.jud_notes, public.processos_judiciais, public.processos_contra_motivos,
  public.processos_contra, public.custas_judiciais, public.boletos_honorarios, public.boletos_pagamentos,
  public.boletos_baixa_banco, public.nex_letters, public.reneg_propostas, public.reneg_liberacao,
  public.relacionamento_docs_assinatura, public.registro_cadastro, public.registro_cadastro_linhas,
  public.webro_repasse_pendente
from anon;

-- --- Padrão (usuário ativo) em leitura e escrita -------------------------------------------------
-- Telas sem chave única de permissão (ficha do cliente, fila, agenda, sub judice, crons pelo cliente).

-- sienge_customers: sem delete pelo app (só o servidor).
create policy "sienge_customers: ativos leem" on public.sienge_customers
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "sienge_customers: ativos inserem" on public.sienge_customers
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "sienge_customers: ativos alteram" on public.sienge_customers
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- sienge_defaulters_history: o navegador grava o cache do dia; só o cron apaga (service role).
create policy "sienge_defaulters_history: ativos leem" on public.sienge_defaulters_history
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "sienge_defaulters_history: ativos inserem" on public.sienge_defaulters_history
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "sienge_defaulters_history: ativos alteram" on public.sienge_defaulters_history
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- inadimplencia_snapshots: gravado ao carregar a fila / mapa jurídico; sem delete.
create policy "inadimplencia_snapshots: ativos leem" on public.inadimplencia_snapshots
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "inadimplencia_snapshots: ativos inserem" on public.inadimplencia_snapshots
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "inadimplencia_snapshots: ativos alteram" on public.inadimplencia_snapshots
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- customer_notes / jud_notes / nex_letters: ocorrências da ficha do cliente (vários perfis gravam).
create policy "customer_notes: ativos leem" on public.customer_notes
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "customer_notes: ativos inserem" on public.customer_notes
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "customer_notes: ativos alteram" on public.customer_notes
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "customer_notes: ativos apagam" on public.customer_notes
  for delete to authenticated using ((select privado.usuario_ativo()));

create policy "jud_notes: ativos leem" on public.jud_notes
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "jud_notes: ativos inserem" on public.jud_notes
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "jud_notes: ativos alteram" on public.jud_notes
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "jud_notes: ativos apagam" on public.jud_notes
  for delete to authenticated using ((select privado.usuario_ativo()));

create policy "nex_letters: ativos leem" on public.nex_letters
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "nex_letters: ativos inserem" on public.nex_letters
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "nex_letters: ativos alteram" on public.nex_letters
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "nex_letters: ativos apagam" on public.nex_letters
  for delete to authenticated using ((select privado.usuario_ativo()));

-- processos_judiciais: número do processo na ficha do cliente; sem delete.
create policy "processos_judiciais: ativos leem" on public.processos_judiciais
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "processos_judiciais: ativos inserem" on public.processos_judiciais
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "processos_judiciais: ativos alteram" on public.processos_judiciais
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- custas_judiciais: aba de custas da ficha (sem chave) + Pagar reembolso (sub_fin_cr_pagar_reembolso_editar).
create policy "custas_judiciais: ativos leem" on public.custas_judiciais
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "custas_judiciais: ativos inserem" on public.custas_judiciais
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "custas_judiciais: ativos alteram" on public.custas_judiciais
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "custas_judiciais: ativos apagam" on public.custas_judiciais
  for delete to authenticated using ((select privado.usuario_ativo()));

-- boletos_baixa_banco: registro do operador na ficha; sem update/delete no app.
create policy "boletos_baixa_banco: ativos leem" on public.boletos_baixa_banco
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "boletos_baixa_banco: ativos inserem" on public.boletos_baixa_banco
  for insert to authenticated with check ((select privado.usuario_ativo()));

-- reneg_propostas: simulador de renegociação na ficha.
create policy "reneg_propostas: ativos leem" on public.reneg_propostas
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "reneg_propostas: ativos inserem" on public.reneg_propostas
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "reneg_propostas: ativos alteram" on public.reneg_propostas
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "reneg_propostas: ativos apagam" on public.reneg_propostas
  for delete to authenticated using ((select privado.usuario_ativo()));

-- relacionamento_docs_assinatura: gravado por quem gera o documento (várias telas).
create policy "relacionamento_docs_assinatura: ativos leem" on public.relacionamento_docs_assinatura
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "relacionamento_docs_assinatura: ativos inserem" on public.relacionamento_docs_assinatura
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "relacionamento_docs_assinatura: ativos alteram" on public.relacionamento_docs_assinatura
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "relacionamento_docs_assinatura: ativos apagam" on public.relacionamento_docs_assinatura
  for delete to authenticated using ((select privado.usuario_ativo()));

-- webro_repasse_pendente: quem tem a fila carregada publica; a pagadoria lê.
create policy "webro_repasse_pendente: ativos leem" on public.webro_repasse_pendente
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "webro_repasse_pendente: ativos inserem" on public.webro_repasse_pendente
  for insert to authenticated with check ((select privado.usuario_ativo()));
create policy "webro_repasse_pendente: ativos alteram" on public.webro_repasse_pendente
  for update to authenticated using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "webro_repasse_pendente: ativos apagam" on public.webro_repasse_pendente
  for delete to authenticated using ((select privado.usuario_ativo()));

-- --- Com chave de permissão --------------------------------------------------------------------

-- processos_contra: a fila lê (tag "processo contra"); abrir/excluir exige sub_jur_geral_processo_contra_editar;
-- renomear o motivo (Fluxos do processo) também é permitido a sub_jur_geral_configuracoes_editar.
create policy "processos_contra: ativos leem" on public.processos_contra
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "processos_contra: editor insere" on public.processos_contra
  for insert to authenticated with check ((select privado.tem_permissao('sub_jur_geral_processo_contra_editar')));
create policy "processos_contra: editor altera" on public.processos_contra
  for update to authenticated
  using ((select privado.tem_permissao('sub_jur_geral_processo_contra_editar'))
         or (select privado.tem_permissao('sub_jur_geral_configuracoes_editar')))
  with check ((select privado.tem_permissao('sub_jur_geral_processo_contra_editar'))
         or (select privado.tem_permissao('sub_jur_geral_configuracoes_editar')));
create policy "processos_contra: editor apaga" on public.processos_contra
  for delete to authenticated using ((select privado.tem_permissao('sub_jur_geral_processo_contra_editar')));

create policy "processos_contra_motivos: ativos leem" on public.processos_contra_motivos
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "processos_contra_motivos: editor grava" on public.processos_contra_motivos
  for all to authenticated
  using ((select privado.tem_permissao('sub_jur_geral_processo_contra_editar'))
         or (select privado.tem_permissao('sub_jur_geral_configuracoes_editar')))
  with check ((select privado.tem_permissao('sub_jur_geral_processo_contra_editar'))
         or (select privado.tem_permissao('sub_jur_geral_configuracoes_editar')));

-- boletos_honorarios: qualquer operador que gera boleto grava o registro; só o relatório (Cobrança > Relatórios) lê.
create policy "boletos_honorarios: relatorio le" on public.boletos_honorarios
  for select to authenticated
  using ((select privado.tem_permissao('sub_fin_cr_relatorios_acessar'))
         or (select privado.tem_permissao('sub_fin_cr_relatorios_visualizar')));
create policy "boletos_honorarios: ativos inserem" on public.boletos_honorarios
  for insert to authenticated with check ((select privado.usuario_ativo()));

-- boletos_pagamentos: cache gravado pelo próprio relatório ao abrir (quem acessa o relatório lê e grava).
create policy "boletos_pagamentos: relatorio le" on public.boletos_pagamentos
  for select to authenticated
  using ((select privado.tem_permissao('sub_fin_cr_relatorios_acessar'))
         or (select privado.tem_permissao('sub_fin_cr_relatorios_visualizar')));
create policy "boletos_pagamentos: relatorio insere" on public.boletos_pagamentos
  for insert to authenticated with check ((select privado.tem_permissao('sub_fin_cr_relatorios_acessar')));
create policy "boletos_pagamentos: relatorio altera" on public.boletos_pagamentos
  for update to authenticated
  using ((select privado.tem_permissao('sub_fin_cr_relatorios_acessar')))
  with check ((select privado.tem_permissao('sub_fin_cr_relatorios_acessar')));

-- reneg_liberacao: operador pede (insert); só o administrador decide (update) ou apaga.
create policy "reneg_liberacao: ativos leem" on public.reneg_liberacao
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "reneg_liberacao: ativos pedem" on public.reneg_liberacao
  for insert to authenticated with check ((select privado.usuario_ativo()) and status = 'pendente');
create policy "reneg_liberacao: admin decide" on public.reneg_liberacao
  for update to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy "reneg_liberacao: admin apaga" on public.reneg_liberacao
  for delete to authenticated using ((select privado.eh_admin()));

-- registro_cadastro (+ linhas): tela Relacionamento > Registro.
create policy "registro_cadastro: tela le" on public.registro_cadastro
  for select to authenticated
  using ((select privado.tem_permissao('sub_rel_geral_registro_acessar'))
         or (select privado.tem_permissao('sub_rel_geral_registro_visualizar')));
create policy "registro_cadastro: editor grava" on public.registro_cadastro
  for all to authenticated
  using ((select privado.tem_permissao('sub_rel_geral_registro_editar')))
  with check ((select privado.tem_permissao('sub_rel_geral_registro_editar')));
create policy "registro_cadastro_linhas: tela le" on public.registro_cadastro_linhas
  for select to authenticated
  using ((select privado.tem_permissao('sub_rel_geral_registro_acessar'))
         or (select privado.tem_permissao('sub_rel_geral_registro_visualizar')));
create policy "registro_cadastro_linhas: editor grava" on public.registro_cadastro_linhas
  for all to authenticated
  using ((select privado.tem_permissao('sub_rel_geral_registro_editar')))
  with check ((select privado.tem_permissao('sub_rel_geral_registro_editar')));

-- =====================================================================================
-- Realtime (onSnapshot no código)
-- =====================================================================================
alter publication supabase_realtime add table public.customer_notes;   -- app.js:8504 (ocorrências do cliente aberto)
alter publication supabase_realtime add table public.jud_notes;        -- app.js:8668 (etapas judiciais do cliente aberto)
alter publication supabase_realtime add table public.reneg_liberacao;  -- app.js:22017 (pedidos de liberação)

-- =====================================================================================
-- RPC (substituem runTransaction e gravações "lista inteira" que precisam ser atômicas)
-- As listas p_notas / p_itens vêm com as chaves já em snake_case (nomes das colunas).
-- =====================================================================================

-- Salva ocorrências de um cliente: apaga as de p_remover e faz upsert das enviadas. Em conflito, só substitui
-- se a versão enviada for igual ou mais nova (privado.carimbo_nota), como o mergeOccurrenceLists do app.
-- Nota que já pertence a outro cliente não é movida. Devolve a lista completa do cliente.
create or replace function public.salvar_notas_cliente(
  p_customer_id text,
  p_notas       jsonb default '[]'::jsonb,
  p_remover     text[] default '{}'::text[]
) returns setof public.customer_notes
language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(p_customer_id, '') = '' then
    raise exception 'salvar_notas_cliente: customer_id obrigatório';
  end if;
  p_remover := coalesce(p_remover, '{}'::text[]);

  if cardinality(p_remover) > 0 then
    delete from public.customer_notes n
    where n.customer_id = p_customer_id and n.id = any (p_remover);
  end if;

  with entrada as (
    select r.*, coalesce(nullif(r.id, ''), gen_random_uuid()::text) as nid
    from jsonb_populate_recordset(null::public.customer_notes, coalesce(p_notas, '[]'::jsonb)) r
  ), unicos as (
    select distinct on (e.nid) e.*
    from entrada e
    where e.nid <> all (p_remover)
    order by e.nid, privado.carimbo_nota(e.promise_status_at, e.updated_at, e.last_edit) desc
  )
  insert into public.customer_notes as n (
    id, customer_id, date, author, text, canal, iniciativa, reminder, status, promise_status, promise_date,
    promise_status_at, promised_installments, sale_id, unit_id, contract_id, receivable_bill_id, pinned,
    webro_baixa, reuniao_semanal_terceirizada, check_payment, check_payment_date, boleto_due_date, nex_locked,
    nex_id, colenci_pix, colenci_prazo, customer_name, unit_label, valor_atualizado, desconto_encargos_pct,
    origem, attachments, past_texts, last_edit, updated_at, extra
  )
  select
    u.nid, p_customer_id, coalesce(u.date, now()), u.author, coalesce(u.text, ''), u.canal, u.iniciativa,
    u.reminder, u.status, u.promise_status, u.promise_date, u.promise_status_at,
    coalesce(u.promised_installments, '{}'::text[]), u.sale_id, u.unit_id, u.contract_id, u.receivable_bill_id,
    coalesce(u.pinned, false), u.webro_baixa, u.reuniao_semanal_terceirizada, u.check_payment,
    u.check_payment_date, u.boleto_due_date, u.nex_locked, u.nex_id, u.colenci_pix, u.colenci_prazo,
    u.customer_name, u.unit_label, u.valor_atualizado, u.desconto_encargos_pct, u.origem,
    coalesce(u.attachments, '[]'::jsonb), coalesce(u.past_texts, '{}'::text[]), u.last_edit, u.updated_at,
    coalesce(u.extra, '{}'::jsonb)
  from unicos u
  on conflict (id) do update set
    date = excluded.date, author = excluded.author, text = excluded.text, canal = excluded.canal,
    iniciativa = excluded.iniciativa, reminder = excluded.reminder, status = excluded.status,
    promise_status = excluded.promise_status, promise_date = excluded.promise_date,
    promise_status_at = excluded.promise_status_at, promised_installments = excluded.promised_installments,
    sale_id = excluded.sale_id, unit_id = excluded.unit_id, contract_id = excluded.contract_id,
    receivable_bill_id = excluded.receivable_bill_id, pinned = excluded.pinned,
    webro_baixa = excluded.webro_baixa, reuniao_semanal_terceirizada = excluded.reuniao_semanal_terceirizada,
    check_payment = excluded.check_payment, check_payment_date = excluded.check_payment_date,
    boleto_due_date = excluded.boleto_due_date, nex_locked = excluded.nex_locked, nex_id = excluded.nex_id,
    colenci_pix = excluded.colenci_pix, colenci_prazo = excluded.colenci_prazo,
    customer_name = excluded.customer_name, unit_label = excluded.unit_label,
    valor_atualizado = excluded.valor_atualizado, desconto_encargos_pct = excluded.desconto_encargos_pct,
    origem = excluded.origem, attachments = excluded.attachments, past_texts = excluded.past_texts,
    last_edit = excluded.last_edit, updated_at = excluded.updated_at, extra = excluded.extra
  where n.customer_id = excluded.customer_id
    and privado.carimbo_nota(excluded.promise_status_at, excluded.updated_at, excluded.last_edit)
        >= privado.carimbo_nota(n.promise_status_at, n.updated_at, n.last_edit);

  return query
    select n.* from public.customer_notes n
    where n.customer_id = p_customer_id
    order by n.date;
end $$;

-- Mesmo contrato para as etapas judiciais (carimbo = lastEdit.date).
create or replace function public.salvar_notas_juridicas(
  p_customer_id text,
  p_notas       jsonb default '[]'::jsonb,
  p_remover     text[] default '{}'::text[]
) returns setof public.jud_notes
language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(p_customer_id, '') = '' then
    raise exception 'salvar_notas_juridicas: customer_id obrigatório';
  end if;
  p_remover := coalesce(p_remover, '{}'::text[]);

  if cardinality(p_remover) > 0 then
    delete from public.jud_notes n
    where n.customer_id = p_customer_id and n.id = any (p_remover);
  end if;

  with entrada as (
    select r.*, coalesce(nullif(r.id, ''), 'jud_' || gen_random_uuid()::text) as nid
    from jsonb_populate_recordset(null::public.jud_notes, coalesce(p_notas, '[]'::jsonb)) r
  ), unicos as (
    select distinct on (e.nid) e.*
    from entrada e
    where e.nid <> all (p_remover)
    order by e.nid, privado.carimbo_nota(null, null, e.last_edit) desc
  )
  insert into public.jud_notes as n (
    id, customer_id, date, author, text, type, fase, fase_id, prazo, pinned, sem_alteracao, etapa_inicio,
    last_edit, agreement_attachment, replies, extra
  )
  select
    u.nid, p_customer_id, coalesce(u.date, now()), u.author, coalesce(u.text, ''), u.type, u.fase, u.fase_id,
    u.prazo, coalesce(u.pinned, false), u.sem_alteracao, u.etapa_inicio, u.last_edit, u.agreement_attachment,
    u.replies, coalesce(u.extra, '{}'::jsonb)
  from unicos u
  on conflict (id) do update set
    date = excluded.date, author = excluded.author, text = excluded.text, type = excluded.type,
    fase = excluded.fase, fase_id = excluded.fase_id, prazo = excluded.prazo, pinned = excluded.pinned,
    sem_alteracao = excluded.sem_alteracao, etapa_inicio = excluded.etapa_inicio, last_edit = excluded.last_edit,
    agreement_attachment = excluded.agreement_attachment, replies = excluded.replies, extra = excluded.extra
  where n.customer_id = excluded.customer_id
    and privado.carimbo_nota(null, null, excluded.last_edit) >= privado.carimbo_nota(null, null, n.last_edit);

  return query
    select n.* from public.jud_notes n
    where n.customer_id = p_customer_id
    order by n.date;
end $$;

-- Substitui as cartas NEX de um "<customerId>_<titulo>" (o saveNexHistory gravava a lista inteira;
-- lista vazia = apagar o doc). Itens sem item_id são rejeitados.
create or replace function public.salvar_nex_letters(
  p_doc_id      text,
  p_customer_id text,
  p_titulo      text,
  p_itens       jsonb default '[]'::jsonb
) returns setof public.nex_letters
language plpgsql security invoker set search_path = '' as $$
declare
  v_ids text[];
begin
  if coalesce(p_doc_id, '') = '' or coalesce(p_customer_id, '') = '' then
    raise exception 'salvar_nex_letters: doc_id e customer_id obrigatórios';
  end if;
  select coalesce(array_agg(e ->> 'item_id'), '{}'::text[])
    into v_ids
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;
  if array_position(v_ids, null) is not null or array_position(v_ids, '') is not null then
    raise exception 'salvar_nex_letters: todo item precisa de item_id';
  end if;

  delete from public.nex_letters l
  where l.doc_id = p_doc_id and l.item_id <> all (v_ids);

  insert into public.nex_letters as l (
    doc_id, item_id, customer_id, sale_id, titulo, customer_name, letter_type, unit_label, date, author,
    status, tracking, zero_paid, lost_pay_iso, delivered_at, ar_digital, html, created_at, extra
  )
  select distinct on (r.item_id)
    p_doc_id, r.item_id, p_customer_id, coalesce(r.sale_id, p_titulo), coalesce(r.titulo, p_titulo),
    r.customer_name, r.letter_type, r.unit_label, r.date, r.author, r.status, r.tracking, r.zero_paid,
    r.lost_pay_iso, r.delivered_at, r.ar_digital, r.html, r.created_at, coalesce(r.extra, '{}'::jsonb)
  from jsonb_populate_recordset(null::public.nex_letters, coalesce(p_itens, '[]'::jsonb)) r
  order by r.item_id
  on conflict (doc_id, item_id) do update set
    customer_id = excluded.customer_id, sale_id = excluded.sale_id, titulo = excluded.titulo,
    customer_name = excluded.customer_name, letter_type = excluded.letter_type, unit_label = excluded.unit_label,
    date = excluded.date, author = excluded.author, status = excluded.status, tracking = excluded.tracking,
    zero_paid = excluded.zero_paid, lost_pay_iso = excluded.lost_pay_iso, delivered_at = excluded.delivered_at,
    ar_digital = excluded.ar_digital, html = excluded.html, created_at = excluded.created_at,
    extra = excluded.extra;

  return query
    select l.* from public.nex_letters l
    where l.doc_id = p_doc_id
    order by l.created_at;
end $$;

-- Troca o catálogo de motivos inteiro (salvarCatalogo). p_itens = [{ id, nome }] na ordem da tela.
create or replace function public.salvar_processos_contra_motivos(p_itens jsonb)
returns setof public.processos_contra_motivos
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.processos_contra_motivos m
  where m.id <> all (array(
    select trim(e ->> 'id')
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
    where coalesce(trim(e ->> 'id'), '') <> ''
  ));

  insert into public.processos_contra_motivos as m (id, nome, ordem)
  select distinct on (trim(t.e ->> 'id')) trim(t.e ->> 'id'), trim(t.e ->> 'nome'), (t.ord - 1)::integer
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as t(e, ord)
  where coalesce(trim(t.e ->> 'id'), '') <> '' and coalesce(trim(t.e ->> 'nome'), '') <> ''
  order by trim(t.e ->> 'id'), t.ord
  on conflict (id) do update set nome = excluded.nome, ordem = excluded.ordem;

  return query select m.* from public.processos_contra_motivos m order by m.ordem, m.nome;
end $$;

-- Troca o arquivo da tela Registro numa transação só (antes: partes atual_N e a ficha "atual" por último).
-- p_linhas = array do arquivo como o app monta: [{ empresaId, empresa, obraId, obra, unidade, letra, ... }].
create or replace function public.substituir_registro_cadastro(
  p_arquivo text,
  p_quando  timestamptz,
  p_por     text,
  p_linhas  jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_qtd integer;
begin
  if jsonb_typeof(p_linhas) is distinct from 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'substituir_registro_cadastro: arquivo sem linhas';
  end if;
  v_qtd := jsonb_array_length(p_linhas);

  insert into public.registro_cadastro as r (id, arquivo, quando, por, unidades)
  values ('atual', p_arquivo, coalesce(p_quando, now()), p_por, v_qtd)
  on conflict (id) do update set
    arquivo = excluded.arquivo, quando = excluded.quando, por = excluded.por, unidades = excluded.unidades;

  delete from public.registro_cadastro_linhas l where l.registro_id = 'atual';

  insert into public.registro_cadastro_linhas (registro_id, ordem, empresa_id, empresa, obra_id, obra, unidade, letra, extra)
  select 'atual', t.ord::integer, t.e ->> 'empresaId', t.e ->> 'empresa', t.e ->> 'obraId', t.e ->> 'obra',
         t.e ->> 'unidade', t.e ->> 'letra',
         t.e - array['empresaId', 'empresa', 'obraId', 'obra', 'unidade', 'letra']
  from jsonb_array_elements(p_linhas) with ordinality as t(e, ord);

  return v_qtd;
end $$;

revoke all on function public.salvar_notas_cliente(text, jsonb, text[]) from public, anon;
revoke all on function public.salvar_notas_juridicas(text, jsonb, text[]) from public, anon;
revoke all on function public.salvar_nex_letters(text, text, text, jsonb) from public, anon;
revoke all on function public.salvar_processos_contra_motivos(jsonb) from public, anon;
revoke all on function public.substituir_registro_cadastro(text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.salvar_notas_cliente(text, jsonb, text[]) to authenticated, service_role;
grant execute on function public.salvar_notas_juridicas(text, jsonb, text[]) to authenticated, service_role;
grant execute on function public.salvar_nex_letters(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.salvar_processos_contra_motivos(jsonb) to authenticated, service_role;
grant execute on function public.substituir_registro_cadastro(text, timestamptz, text, jsonb) to authenticated, service_role;
