-- Fase 2 · Área financeiro / tesouraria / pagadoria / fiscal / contábil / marketing.
-- Mapa campo a campo, decisões de documentos grandes e notas do importador:
--   docs/mapa-tabelas/financeiro-fiscal-marketing.md
-- Depende de 202611191200_usuarios_e_acesso.sql (schema privado, tocar_atualizado_em, usuario_ativo,
-- tem_permissao). Entidades de outras áreas (empresa, centro de custo, cliente, unidade, título do Sienge)
-- são referenciadas por colunas text, sem FK entre áreas.

-- =====================================================================================================
-- 0. Funções de apoio (schema privado, prefixo fin_ para não colidir com as outras áreas)
-- =====================================================================================================

-- A tela do Integra libera a leitura com qualquer uma das três chaves (_acessar, _visualizar, _editar);
-- ver js/nucleo/app.js:7753. fin_pode_ver('sub_fin_cp_rydoo') reproduz essa regra.
create or replace function privado.fin_pode_ver(base text)
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.tem_permissao(base || '_acessar')
      or privado.tem_permissao(base || '_visualizar')
      or privado.tem_permissao(base || '_editar');
$$;

-- Conversões tolerantes usadas pelas RPCs (o front manda os mesmos objetos que gravava no Firestore).
create or replace function privado.fin_num(v text)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when v is null or btrim(v) = '' then null
    when btrim(v) ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then btrim(v)::numeric
    else null
  end;
$$;

create or replace function privado.fin_int(v text)
returns integer language sql immutable set search_path = '' as $$
  select round(privado.fin_num(v))::integer;
$$;

-- 'AAAA-MM-DD...' ou 'DD/MM/AAAA' -> date; vazio ou inválido -> null.
create or replace function privado.fin_data(v text)
returns date language sql stable set search_path = '' as $$
  select case
    when v is null or btrim(v) = '' then null
    when v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(v, 10)::date
    when v ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' then to_date(left(v, 10), 'DD/MM/YYYY')
    else null
  end;
$$;

-- epoch em ms (número) ou ISO -> timestamptz.
create or replace function privado.fin_ts(v text)
returns timestamptz language sql stable set search_path = '' as $$
  select case
    when v is null or btrim(v) = '' then null
    when btrim(v) ~ '^[0-9]{11,}(\.[0-9]+)?$' then to_timestamp(btrim(v)::numeric / 1000)
    when v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then v::timestamptz
    else null
  end;
$$;

create or replace function privado.fin_arr(v jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end;
$$;

revoke all on function privado.fin_pode_ver(text), privado.fin_num(text), privado.fin_int(text),
  privado.fin_data(text), privado.fin_ts(text), privado.fin_arr(jsonb)
  from public, anon;
grant execute on function privado.fin_pode_ver(text), privado.fin_num(text), privado.fin_int(text),
  privado.fin_data(text), privado.fin_ts(text), privado.fin_arr(jsonb)
  to authenticated, service_role;

-- =====================================================================================================
-- 1. Caixa diário (tesouraria)
-- =====================================================================================================

-- caixa_diario_config/saldo_inicial.contas + .tipos: um registro por conta bancária ("<empresa>|<conta>").
create table public.caixa_diario_config_contas (
  id             text primary key,                 -- chave do mapa: "<empresa>|<conta>"
  company_id     text not null,
  conta          text not null,
  incluida       boolean,                          -- contas[chave]; null = padrão (entra no caixa)
  tipo           text,                             -- tipos[chave]: corrente, investimento, mutuo...
  atualizado_por text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index caixa_diario_config_contas_company_idx on public.caixa_diario_config_contas (company_id);

-- caixa_diario_config/saldo_inicial.empreendimentosExcluidos: lista de centros de custo fora do caixa, por empresa.
create table public.caixa_diario_config_cc_excluidos (
  id               text primary key,               -- código da empresa (chave do mapa)
  empreendimentos  text[] not null default '{}'::text[],
  atualizado_por   text,
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- Movimentos bancários do Sienge até 2025-12 (base histórica, nunca relida da API).
-- Cabeçalho por empresa/mês ("<empresa>_<AAAA-MM>") e o marcador "<empresa>_base".
create table public.caixa_movimentos (
  id            text primary key,
  company_id    text not null,
  ym            text check (ym ~ '^[0-9]{4}-[0-9]{2}$'),   -- null no marcador _base
  n             integer,
  em            timestamptz,
  ate           text check (ate ~ '^[0-9]{4}-[0-9]{2}$'),  -- só no marcador _base ("2025-12")
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index caixa_movimentos_company_ym_idx on public.caixa_movimentos (company_id, ym);

create table public.caixa_movimentos_itens (
  id                  bigint generated always as identity primary key,
  caixa_movimentos_id text not null references public.caixa_movimentos(id) on delete cascade,
  company_id          text not null,
  ym                  text not null,
  ordem               integer not null,
  data                date,                       -- bankMovementDate || paymentDate || date
  centros_custo       text[] not null default '{}'::text[],  -- costCenterId + financialCategories[].costCenterId
  dados               jsonb not null,              -- objeto do Sienge, intacto
  extra               jsonb not null default '{}'::jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index caixa_movimentos_itens_pai_idx on public.caixa_movimentos_itens (caixa_movimentos_id);
create index caixa_movimentos_itens_company_data_idx on public.caixa_movimentos_itens (company_id, data);
create index caixa_movimentos_itens_cc_idx on public.caixa_movimentos_itens using gin (centros_custo);

-- Foto diária da posição financeira das unidades (uma linha por unidade por dia).
-- Nomes curtos = chaves das linhas no Firestore (lib/caixa-snapshot.js).
create table public.caixa_posicao (
  id            bigint generated always as identity primary key,
  d             date not null,        -- data da foto (doc.date)
  uid           text,                 -- unidade (Sienge)
  un            text,                 -- nome da unidade
  cc            text,                 -- empreendimento / centro de custo
  cn            text,                 -- nome do empreendimento
  cid           text,                 -- cliente (Sienge)
  cpf           text,                 -- documento do cliente, só dígitos
  nome          text,                 -- nome do cliente
  rec           numeric(15,2),        -- recebido
  ven           numeric(15,2),        -- vencidas
  av            numeric(15,2),        -- a vencer
  vp            numeric(15,2),        -- saldo devedor presente
  pmp           numeric,              -- prazo médio de pagamento (3 meses)
  st            text,                 -- situação financeira (inadimplente, quitado...)
  parc          jsonb not null default '[]'::jsonb,  -- até 18 parcelas abertas (só exibidas)
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index caixa_posicao_d_idx on public.caixa_posicao (d);
create index caixa_posicao_uid_idx on public.caixa_posicao (uid);
create index caixa_posicao_cid_idx on public.caixa_posicao (cid);

-- Valor a receber por empresa (batimento das 7h ou botão Atualizar).
create table public.caixa_valor_receber (
  id            text primary key,                 -- "emp_<empresa>"
  company_id    text not null unique,
  ini           date,
  fim           date,
  origem        text,                             -- batimento | manual
  por           text,
  falhas        integer not null default 0,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.caixa_valor_receber_itens (
  id                     bigint generated always as identity primary key,
  caixa_valor_receber_id text not null references public.caixa_valor_receber(id) on delete cascade,
  ordem                  integer not null,
  empresa                text,
  company_id             text,
  doc                    text,
  descricao              text,
  titulo                 text,
  parcela                text,
  vencimento             date,
  valor                  numeric(15,2),
  cliente                text,
  cc                     text,
  cc_nome                text,
  extra                  jsonb not null default '{}'::jsonb,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index caixa_valor_receber_itens_pai_idx on public.caixa_valor_receber_itens (caixa_valor_receber_id);
create index caixa_valor_receber_itens_venc_idx on public.caixa_valor_receber_itens (vencimento);

-- caixa_valor_receber/_estado: estado da passada do cron (só servidor).
create table public.caixa_valor_receber_estado (
  id            text primary key default '_estado',
  date          date,
  ini           date,
  fim           date,
  empresas      text[] not null default '{}'::text[],
  ei            integer not null default 0,
  fi            integer not null default 0,
  done          boolean not null default false,
  itens         jsonb not null default '[]'::jsonb,   -- acumulador da empresa em andamento
  falhas        integer not null default 0,
  lock_ate      timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Radar do mês: foto congelada do previsto (lida e exibida em bloco).
create table public.caixa_radar (
  id            text primary key,                 -- "<empresa>-<AAAA-MM>"
  company_id    text not null,
  ym            text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  em            timestamptz,
  receber       jsonb not null default '[]'::jsonb,
  incerto       jsonb not null default '[]'::jsonb,
  pagar         jsonb not null default '[]'::jsonb,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index caixa_radar_company_ym_idx on public.caixa_radar (company_id, ym);

-- =====================================================================================================
-- 2. Contas pagas (Compras › Controle financeiro) e antecipações
-- =====================================================================================================

-- Cabeçalho por empresa/mês ("<empresa>_<AAAA-MM>") e o marcador "_corte" (company_id/ym nulos).
create table public.cfin_pagos (
  id            text primary key,
  company_id    text,
  ym            text check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  n             integer,
  em            timestamptz,
  ate           date,
  fechado       boolean not null default false,
  ym_fechado    text check (ym_fechado ~ '^[0-9]{4}-[0-9]{2}$'),  -- só no _corte
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index cfin_pagos_company_ym_idx on public.cfin_pagos (company_id, ym);

-- Um título/parcela do bulk-data outcome do Sienge por linha. Colunas tipadas para filtro; dados = objeto inteiro.
create table public.cfin_pagos_bills (
  id                          bigint generated always as identity primary key,
  cfin_pagos_id               text not null references public.cfin_pagos(id) on delete cascade,
  company_id                  text not null,
  ym                          text not null,
  ordem                       integer not null,
  bill_id                     text,
  installment_id              integer,
  creditor_id                 text,
  creditor_name               text,
  document_identification_id  text,
  document_number             text,
  due_date                    date,
  issue_date                  date,
  original_amount             numeric(15,2),
  balance_amount              numeric(15,2),
  dados                       jsonb not null,
  extra                       jsonb not null default '{}'::jsonb,
  criado_em                   timestamptz not null default now(),
  atualizado_em               timestamptz not null default now()
);
create index cfin_pagos_bills_pai_idx on public.cfin_pagos_bills (cfin_pagos_id);
create index cfin_pagos_bills_company_ym_idx on public.cfin_pagos_bills (company_id, ym);
create index cfin_pagos_bills_bill_idx on public.cfin_pagos_bills (bill_id);
create index cfin_pagos_bills_due_idx on public.cfin_pagos_bills (due_date);

-- Antecipações: cabeçalho por mês (id = "AAAA-MM") e um evento (título + dia do pagamento) por linha.
create table public.antecipacoes_mes (
  id            text primary key check (id ~ '^[0-9]{4}-[0-9]{2}$'),
  eventos       integer not null default 0,
  fonte         text,                             -- carga-historico | batimento-7h
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.antecipacoes_mes_eventos (
  id                  text primary key,           -- k = "<billId>|<AAAA-MM-DD>"
  antecipacoes_mes_id text not null references public.antecipacoes_mes(id) on delete cascade,
  tit                 text not null,
  data                date not null,              -- dia do pagamento
  emp                 text,
  emp_nome            text,
  cli                 text,
  cli_id              text,
  unid                text,
  cc                  text,
  cc_nome             text,
  doc                 text,
  taxa                numeric,
  tipo_juros          text,
  parcelas            jsonb not null default '[]'::jsonb,  -- [nº, condição, vencimento, dias, VF, VP, pago, desconto]
  vf                  numeric(15,2),
  vp                  numeric(15,2),
  pago                numeric(15,2),
  desc_sienge         numeric(15,2),
  max_dias            integer,
  min_dias            integer,
  juros               numeric(15,2),
  comercial           numeric(15,2),
  desc_total          numeric(15,2),
  np                  integer,
  faixa               text,
  extra               jsonb not null default '{}'::jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index antecipacoes_mes_eventos_mes_idx on public.antecipacoes_mes_eventos (antecipacoes_mes_id);
create index antecipacoes_mes_eventos_data_idx on public.antecipacoes_mes_eventos (data);
create index antecipacoes_mes_eventos_emp_cc_idx on public.antecipacoes_mes_eventos (emp, cc);

-- =====================================================================================================
-- 3. Pagadoria (Gerar pagamento, conta de parceria, credores)
-- =====================================================================================================

create table public.pagamento_lotes (
  id                 text primary key,            -- "L<AAAAMMDD>-<hhmmss>-<conta>-<mmdd>"
  criado_por         text,
  criado_por_email   text,
  total              numeric(15,2),
  conta_key          text,
  conta_id           text,
  conta_nome         text,
  conta_numero       text,
  conta_agencia      text,
  conta_banco        text,
  dia                date,
  empresa_conta      text,
  data_baixa         date,
  cancelado          boolean not null default false,
  cancelado_motivo   text,
  cancelado_em       timestamptz,
  transferencias     jsonb not null default '[]'::jsonb,
  sienge_numero      text,
  sienge_status      text,                        -- pendente | gerado | erro | excluido
  sienge_gerado_em   timestamptz,
  sienge_gerado_por  text,
  sienge_erro        text,
  sienge_historico   jsonb not null default '[]'::jsonb,
  extra              jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),   -- criadoEm
  atualizado_em      timestamptz not null default now()
);
create index pagamento_lotes_dia_idx on public.pagamento_lotes (dia);
create index pagamento_lotes_sienge_numero_idx on public.pagamento_lotes (sienge_numero);

create table public.pagamento_lotes_itens (
  id                  bigint generated always as identity primary key,
  pagamento_lotes_id  text not null references public.pagamento_lotes(id) on delete cascade,
  ordem               integer not null,
  titulo              text not null,
  parcela             text,
  forma               text,
  linha_digitavel     text,
  vencimento          date,
  valor               numeric(15,2),
  valor_bruto         numeric(15,2),
  impostos_retidos    numeric(15,2),
  impostos            text,
  credor_id           text,
  credor              text,
  company_id          text,
  ccs                 text,
  conferencia         text,
  documento           text,
  valida              jsonb,
  extra               jsonb not null default '{}'::jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index pagamento_lotes_itens_pai_idx on public.pagamento_lotes_itens (pagamento_lotes_id);
create index pagamento_lotes_itens_titulo_idx on public.pagamento_lotes_itens (titulo, parcela);

-- Conta bancária da parceria por centro de custo.
create table public.cc_conta_parceria (
  id             text primary key,                -- = cc_id
  cc_id          text not null,
  conta_id       text,
  conta_banco    text,
  conta_nome     text,
  conta_agencia  text,
  conta_numero   text,
  atualizado_por text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()   -- updatedAt (epoch ms)
);
create index cc_conta_parceria_cc_idx on public.cc_conta_parceria (cc_id);

-- Espelho diário dos credores do Sienge (cron sync-creditors).
create table public.sienge_creditors (
  id                         text primary key,    -- creditorId do Sienge
  name                       text not null,
  trade_name                 text,
  cpf                        text,
  cnpj                       text,
  active                     boolean,
  supplier                   boolean,             -- 'S'/'N'
  broker                     boolean,             -- 'S'/'N'
  employee                   boolean,             -- 'S'/'N'
  state_registration_number  text,
  state_registration_type    text,
  payment_type_id            integer,
  tax_regime_id              integer,
  tax_regime                 text,
  tax_classification_id      integer,
  tax_classification         text,
  creation_date              date,
  last_modification_date     date,
  address                    jsonb,
  phones                     jsonb not null default '[]'::jsonb,
  contacts                   jsonb not null default '[]'::jsonb,
  other_contact_methods      jsonb not null default '[]'::jsonb,
  links                      jsonb not null default '[]'::jsonb,
  batimento_date             date,                -- _batimentoDate (limpeza do que saiu do Sienge)
  extra                      jsonb not null default '{}'::jsonb,
  criado_em                  timestamptz not null default now(),
  atualizado_em              timestamptz not null default now()
);
create index sienge_creditors_name_idx on public.sienge_creditors (name);
create index sienge_creditors_cpf_idx on public.sienge_creditors (cpf);
create index sienge_creditors_cnpj_idx on public.sienge_creditors (cnpj);
create index sienge_creditors_batimento_idx on public.sienge_creditors (batimento_date);

-- =====================================================================================================
-- 4. Prestação de contas Ellenco (participações)
-- =====================================================================================================

create table public.participacoes_credores (
  id                      text primary key,       -- encodeURIComponent(credorKey), como no Firestore
  credor_key              text not null unique,
  credor                  text,
  categoria_ml_id         text,
  categoria_ml_sienge_id  text,
  categoria_ml_label      text,
  por                     text,
  em                      timestamptz,
  extra                   jsonb not null default '{}'::jsonb,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);

create table public.participacoes_periods (
  id             text primary key,                -- "<companyId>_<closing>"
  company_id     text not null,
  closing        text not null check (closing ~ '^[0-9]{4}-[0-9]{2}$'),
  file_name      text,
  saldo_total    numeric(15,2),
  pdf_url        text,
  pdf_path       text,
  cache_ver      integer,
  atualizado_por text,                             -- updatedBy
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(), -- updatedAtServer (ou updatedAt)
  unique (company_id, closing)
);

create table public.participacoes_periods_expenses (
  id                       bigint generated always as identity primary key,
  participacoes_periods_id text not null references public.participacoes_periods(id) on delete cascade,
  ordem                    integer not null,
  source_file              text,
  credor                   text,
  categoria                text,
  categoria_id             text,
  valor                    numeric(15,2),
  doc                      text,
  periodo                  text,
  detalhe                  text,
  iso                      date,                    -- data da despesa ("date" DD/MM/AAAA é a mesma data)
  extra                    jsonb not null default '{}'::jsonb,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now()
);
create index participacoes_periods_expenses_pai_idx on public.participacoes_periods_expenses (participacoes_periods_id);
create index participacoes_periods_expenses_credor_idx on public.participacoes_periods_expenses (credor);

-- =====================================================================================================
-- 5. Orçamento / DFC e Resultado de caixa (contábil-gerencial)
-- =====================================================================================================

create table public.dfc_orcamento (
  id            text primary key,                 -- "2027", "2027_v1", "2027_v2"
  file_name     text,
  saved_at      timestamptz,
  year          integer,
  n             integer,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.dfc_orcamento_linhas (
  id               bigint generated always as identity primary key,
  dfc_orcamento_id text not null references public.dfc_orcamento(id) on delete cascade,
  ordem            integer not null,
  e                text,                          -- empresa
  enome            text,                          -- nome da empresa
  cc               text,                          -- centro de custo
  en               text,                          -- nome do centro de custo
  conta            text,                          -- conta do plano financeiro (2.03.02.14)
  cn               text,                          -- nome da conta
  obs              text,
  m                numeric(15,2)[] not null default '{}'::numeric[],  -- 12 meses (jan..dez)
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index dfc_orcamento_linhas_pai_idx on public.dfc_orcamento_linhas (dfc_orcamento_id);
create index dfc_orcamento_linhas_cc_conta_idx on public.dfc_orcamento_linhas (cc, conta);

create table public.dfc_realizado (
  id            text primary key,                 -- "c<empresa>"
  empresa       text not null unique,
  fim           date,
  ate           date,
  v             integer,                          -- versão do formato
  em            timestamptz,
  n             integer,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.dfc_realizado_itens (
  id               bigint generated always as identity primary key,
  dfc_realizado_id text not null references public.dfc_realizado(id) on delete cascade,
  ordem            integer not null,
  gid              text,                          -- grupo do DFC (g_09_02)
  code             text,                          -- categoria financeira
  cc               text,
  i                integer,                       -- índice do mês
  v                numeric(15,2),
  ccn              text,
  cn               text,
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index dfc_realizado_itens_pai_idx on public.dfc_realizado_itens (dfc_realizado_id);

-- Planilhas importadas do resultado de caixa e forecasts: grade aninhada lida inteira -> jsonb.
-- As partes "__pN" do Firestore são juntadas na carga.
create table public.resultado_caixa (
  id            text primary key,                 -- "<slot>_<empresa>" ou "fc-<AAAA-MM>"
  tipo          text,                             -- 'forecast' ou null (arquivo de resultado)
  slot          text,
  empresa       integer,
  rotulo        text,
  nome          text,
  competencia   text check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  em            timestamptz,
  arquivos      text[] not null default '{}'::text[],
  entradas      jsonb not null default '{}'::jsonb,
  contas        jsonb not null default '{}'::jsonb,
  contas_por_cc jsonb not null default '{}'::jsonb,
  planos_json   jsonb not null default '{}'::jsonb,
  nomes         jsonb not null default '{}'::jsonb,
  por_arquivo   jsonb not null default '{}'::jsonb,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index resultado_caixa_tipo_idx on public.resultado_caixa (tipo);
create index resultado_caixa_slot_idx on public.resultado_caixa (slot, empresa);

-- =====================================================================================================
-- 6. Rydoo (reembolso de despesas)
-- =====================================================================================================

create table public.rydoo_arquivos (
  id            text primary key default gen_random_uuid()::text,  -- legado: Date.now()
  file_name     text,
  imported_at   timestamptz,
  linhas        integer,
  chaves        text[] not null default '{}'::text[],
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index rydoo_arquivos_imported_idx on public.rydoo_arquivos (imported_at);

-- rydoo_meta/colaboradores: cache regenerável da lista de colaboradores do Sienge.
create table public.rydoo_meta (
  id            text primary key,                 -- "colaboradores"
  count         integer,
  items         jsonb not null default '[]'::jsonb,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()   -- updatedAt
);

create table public.rydoo_titulos (
  id              text primary key,               -- "<creditorId>_<competência MMAAAA>"
  creditor_id     text,
  competencia     text,                           -- parte final do id
  bill_id         text,
  pessoa          text,
  document_number text,
  notes           text,
  total           numeric(15,2),
  bank_sent       boolean not null default false,
  bank_sent_at    timestamptz,
  email_sent      boolean not null default false,
  email_to        text,                           -- e-mails separados por ", "
  extra           jsonb not null default '{}'::jsonb,
  criado_em       timestamptz not null default now(),   -- createdAt
  atualizado_em   timestamptz not null default now()
);
create index rydoo_titulos_bill_idx on public.rydoo_titulos (bill_id);
create index rydoo_titulos_creditor_idx on public.rydoo_titulos (creditor_id);

-- =====================================================================================================
-- 7. Fiscal (fila de notas)
-- =====================================================================================================

create table public.fiscal_notas_envio (
  id                    text primary key,         -- "NF<epoch><rand>"
  status                text not null default 'pendente',
  pedido                text,
  pedido_api            text,
  empresa               text,
  numero_nota           text,
  serie_nota            text,
  valor_nota            numeric(15,2),
  valor_pedido          numeric(15,2),
  observacao            text,
  fornecedor_id         text,
  fornecedor_doc        text,
  fornecedor_nome       text,
  cc_id                 text,
  cc_nome               text,
  pagamento_forma       text,
  pagamento_data        date,
  pagamento_detalhe     text,
  pagamento_conta       jsonb,
  previsao              jsonb,
  anexos                jsonb not null default '[]'::jsonb,
  historico             jsonb not null default '[]'::jsonb,
  criado_por            text,
  criado_por_email      text,
  criado_por_sienge     text,
  assumido_por          text,
  assumido_por_email    text,
  assumido_em           timestamptz,
  validado_por          text,
  validado_por_email    text,
  validado_em           timestamptz,
  lancado_por           text,
  lancado_por_email     text,
  lancado_em            timestamptz,
  seq_sienge            text,
  bill_id               text,
  motivo_devolucao      text,
  devolucao_tipo        text,
  devolvido_por         text,
  devolvido_por_sienge  text,
  devolvido_em          timestamptz,
  motivos_cancelamento  text[] not null default '{}'::text[],
  extra                 jsonb not null default '{}'::jsonb,
  criado_em             timestamptz not null default now(),   -- criadoEm
  atualizado_em         timestamptz not null default now()    -- atualizadoEm
);
create index fiscal_notas_envio_criado_idx on public.fiscal_notas_envio (criado_em desc);
create index fiscal_notas_envio_status_idx on public.fiscal_notas_envio (status);
create index fiscal_notas_envio_pedido_idx on public.fiscal_notas_envio (pedido);
create index fiscal_notas_envio_fornecedor_idx on public.fiscal_notas_envio (fornecedor_doc);

create table public.fiscal_notas_aprendizado (
  id              text primary key,               -- "AP<epoch><rand>"
  em              timestamptz not null default now(),
  pedido          text,
  fornecedor_id   text,
  fornecedor_doc  text,
  fornecedor_nome text,
  numero_nota     text,
  tipo            text,                           -- carta | cancelamento | ...
  motivos         text[] not null default '{}'::text[],
  carta_linhas    jsonb not null default '[]'::jsonb,
  motivo          text,
  extra           jsonb not null default '{}'::jsonb,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index fiscal_notas_aprendizado_em_idx on public.fiscal_notas_aprendizado (em desc);
create index fiscal_notas_aprendizado_fornecedor_idx on public.fiscal_notas_aprendizado (fornecedor_doc);

-- =====================================================================================================
-- 8. Marketing (budget)
-- =====================================================================================================

create table public.marketing_budgets (
  id               text primary key default gen_random_uuid()::text,  -- legado: id automático do Firestore
  event_name       text,
  company_id       text,
  cost_center_id   text,
  cost_center_name text,
  planned_value    numeric(15,2),
  start_date       date,
  end_date         date,
  status           text,
  notes            text,
  created_by       text,
  expenses         jsonb not null default '[]'::jsonb,   -- despesas do evento (exibidas no bloco do evento)
  extra            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now(),   -- createdAt
  atualizado_em    timestamptz not null default now()    -- updatedAt
);
create index marketing_budgets_cc_idx on public.marketing_budgets (cost_center_id);
create index marketing_budgets_criado_idx on public.marketing_budgets (criado_em desc);

create table public.marketing_budget_config (
  id             text primary key,                -- centro de custo principal, ou "_categorias"
  ccs            text[],
  pct            numeric,
  ids            text[],                          -- só em _categorias
  atualizado_por text,
  extra          jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Cache de 30 min dos títulos do Sienge por centro de custo (regenerável).
create table public.marketing_budget_titulos (
  id            text primary key,                 -- centro de custo
  inicio        date,                             -- start
  fim           date,                             -- end (palavra reservada no Postgres)
  saved_at      timestamptz,
  bills         jsonb not null default '[]'::jsonb,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Cache de vendas/distratos por centro de custo e mês (regenerável).
create table public.marketing_budget_vendas (
  id            text primary key,                 -- "<cc>_<AAAA-MM>"
  cc_id         text not null,
  ym            text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  vendas        jsonb not null default '[]'::jsonb,
  distratos     jsonb not null default '[]'::jsonb,
  saved_at      timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (cc_id, ym)
);

-- =====================================================================================================
-- 9. Mútuo / acerto de despesa
-- =====================================================================================================

create table public.mutuo_execucoes (
  id            text primary key,                 -- "MUTUO_<AAAAMM>" | "ACERTO_<AAAAMM>"
  operacao      text not null,                    -- MUTUO | ACERTO_DESPESA
  competencia   text not null,                    -- AAAAMM
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index mutuo_execucoes_competencia_idx on public.mutuo_execucoes (competencia desc);

-- centros.<chave> do documento: uma nota de débito por centro.
create table public.mutuo_execucoes_centros (
  id                 bigint generated always as identity primary key,
  mutuo_execucoes_id text not null references public.mutuo_execucoes(id) on delete cascade,
  chave              text not null,
  numero             integer,
  valor              numeric(15,2),
  emissao            text,
  descricao          text,
  rotulo             text,
  lancamentos        integer,
  emitido_por        text,
  emitido_em         timestamptz,
  erro_titulo        text,
  pdf_url            text,
  pdf_nome           text,
  xlsx_url           text,
  xlsx_nome          text,
  bill_id            text,
  titulo_duplicado   boolean,
  extra              jsonb not null default '{}'::jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (mutuo_execucoes_id, chave)
);

create table public.mutuo_meta (
  id            text primary key,                 -- "notas_debito"
  ultima        integer not null default 0,
  por           text,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- =====================================================================================================
-- 10. Títulos incompletos (batimento das 7h): foto única "atual", escrita só pelo cron.
-- =====================================================================================================

create table public.titulos_incompletos_batimento (
  id            text primary key,                 -- "atual"
  date          date,
  at            timestamptz,
  total         integer,
  rows          jsonb not null default '[]'::jsonb,
  primeiros     jsonb not null default '{}'::jsonb,  -- "<titulo|venc|doc|tipo|empresa>" -> primeiro dia visto
  done          boolean not null default false,
  lock_ate      timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- =====================================================================================================
-- 11. Triggers de atualizado_em, RLS ligada e nada para anon
-- =====================================================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'caixa_diario_config_contas', 'caixa_diario_config_cc_excluidos',
    'caixa_movimentos', 'caixa_movimentos_itens', 'caixa_posicao',
    'caixa_valor_receber', 'caixa_valor_receber_itens', 'caixa_valor_receber_estado', 'caixa_radar',
    'cfin_pagos', 'cfin_pagos_bills', 'antecipacoes_mes', 'antecipacoes_mes_eventos',
    'pagamento_lotes', 'pagamento_lotes_itens', 'cc_conta_parceria', 'sienge_creditors',
    'participacoes_credores', 'participacoes_periods', 'participacoes_periods_expenses',
    'dfc_orcamento', 'dfc_orcamento_linhas', 'dfc_realizado', 'dfc_realizado_itens', 'resultado_caixa',
    'rydoo_arquivos', 'rydoo_meta', 'rydoo_titulos',
    'fiscal_notas_envio', 'fiscal_notas_aprendizado',
    'marketing_budgets', 'marketing_budget_config', 'marketing_budget_titulos', 'marketing_budget_vendas',
    'mutuo_execucoes', 'mutuo_execucoes_centros', 'mutuo_meta',
    'titulos_incompletos_batimento'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function privado.tocar_atualizado_em()',
      t || '_atualizado_em', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- =====================================================================================================
-- 12. Políticas (RLS). Leitura: privado.fin_pode_ver('<base>') = _acessar | _visualizar | _editar.
--     Gravação: privado.tem_permissao('<base>_editar'), salvo onde anotado.
-- =====================================================================================================

-- Caixa diário: sub_fin_cb_fluxo_caixa_diario
create policy "caixa_diario_config_contas: ler" on public.caixa_diario_config_contas
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')));
create policy "caixa_diario_config_contas: gravar" on public.caixa_diario_config_contas
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_fluxo_caixa_diario_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_fluxo_caixa_diario_editar')));

create policy "caixa_diario_config_cc_excluidos: ler" on public.caixa_diario_config_cc_excluidos
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')));
create policy "caixa_diario_config_cc_excluidos: gravar" on public.caixa_diario_config_cc_excluidos
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_fluxo_caixa_diario_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_fluxo_caixa_diario_editar')));

create policy "caixa_radar: ler" on public.caixa_radar
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')));
create policy "caixa_radar: gravar" on public.caixa_radar
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_fluxo_caixa_diario_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_fluxo_caixa_diario_editar')));

-- Valor a receber: o botão Atualizar é uma releitura do Sienge, não uma edição -> quem vê a tela grava.
create policy "caixa_valor_receber: ler e gravar" on public.caixa_valor_receber
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')))
  with check ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')));
create policy "caixa_valor_receber_itens: ler e gravar" on public.caixa_valor_receber_itens
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')))
  with check ((select privado.fin_pode_ver('sub_fin_cb_fluxo_caixa_diario')));
-- caixa_valor_receber_estado: SÓ SERVIDOR (cron morning-warmup). RLS ligada, sem política.

-- Base de movimentos bancários: cache compartilhado gravado por qualquer tela que use SiengeApiService
-- (js/nucleo/sienge-api.js) -> padrão: usuário ativo.
create policy "caixa_movimentos: ativos" on public.caixa_movimentos
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));
create policy "caixa_movimentos_itens: ativos" on public.caixa_movimentos_itens
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- Posição do caixa: lida pela fila de cobrança e gravada pelo Estoque comercial -> padrão.
create policy "caixa_posicao: ativos" on public.caixa_posicao
  for all to authenticated
  using ((select privado.usuario_ativo())) with check ((select privado.usuario_ativo()));

-- Contas pagas: cache preenchido ao consultar a tela Compras › Controle financeiro.
create policy "cfin_pagos: ler e gravar" on public.cfin_pagos
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_compras_geral_controle_financeiro')))
  with check ((select privado.fin_pode_ver('sub_compras_geral_controle_financeiro')));
create policy "cfin_pagos_bills: ler e gravar" on public.cfin_pagos_bills
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_compras_geral_controle_financeiro')))
  with check ((select privado.fin_pode_ver('sub_compras_geral_controle_financeiro')));

-- Antecipações: leitura pela tela; gravação só pelo servidor (lib/antecipacoes-batimento.js).
create policy "antecipacoes_mes: ler" on public.antecipacoes_mes
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_antec_antecipacoes')));
create policy "antecipacoes_mes_eventos: ler" on public.antecipacoes_mes_eventos
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_antec_antecipacoes')));

-- Gerar pagamento
create policy "pagamento_lotes: ler" on public.pagamento_lotes
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cp_gerar_pagamento')));
create policy "pagamento_lotes: gravar" on public.pagamento_lotes
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cp_gerar_pagamento_editar')))
  with check ((select privado.tem_permissao('sub_fin_cp_gerar_pagamento_editar')));
create policy "pagamento_lotes_itens: ler" on public.pagamento_lotes_itens
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cp_gerar_pagamento')));
create policy "pagamento_lotes_itens: gravar" on public.pagamento_lotes_itens
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cp_gerar_pagamento_editar')))
  with check ((select privado.tem_permissao('sub_fin_cp_gerar_pagamento_editar')));

-- Conta de parceria: lida pelo Gerar pagamento (CentrosCustoState) -> todo ativo lê; grava o cadastro de CC.
create policy "cc_conta_parceria: ler" on public.cc_conta_parceria
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "cc_conta_parceria: gravar" on public.cc_conta_parceria
  for all to authenticated
  using ((select privado.tem_permissao('sub_cfg_apoio_centro_custo_editar')))
  with check ((select privado.tem_permissao('sub_cfg_apoio_centro_custo_editar')));

-- Credores: lidos por compras, jurídico e financeiro; gravados só pelo cron sync-creditors.
create policy "sienge_creditors: ler" on public.sienge_creditors
  for select to authenticated using ((select privado.usuario_ativo()));

-- Prestação de contas Ellenco: sub_part_geral_participacoes
create policy "participacoes_credores: ler" on public.participacoes_credores
  for select to authenticated using ((select privado.fin_pode_ver('sub_part_geral_participacoes')));
create policy "participacoes_credores: gravar" on public.participacoes_credores
  for all to authenticated
  using ((select privado.tem_permissao('sub_part_geral_participacoes_editar')))
  with check ((select privado.tem_permissao('sub_part_geral_participacoes_editar')));
create policy "participacoes_periods: ler" on public.participacoes_periods
  for select to authenticated using ((select privado.fin_pode_ver('sub_part_geral_participacoes')));
create policy "participacoes_periods: gravar" on public.participacoes_periods
  for all to authenticated
  using ((select privado.tem_permissao('sub_part_geral_participacoes_editar')))
  with check ((select privado.tem_permissao('sub_part_geral_participacoes_editar')));
create policy "participacoes_periods_expenses: ler" on public.participacoes_periods_expenses
  for select to authenticated using ((select privado.fin_pode_ver('sub_part_geral_participacoes')));
create policy "participacoes_periods_expenses: gravar" on public.participacoes_periods_expenses
  for all to authenticated
  using ((select privado.tem_permissao('sub_part_geral_participacoes_editar')))
  with check ((select privado.tem_permissao('sub_part_geral_participacoes_editar')));

-- DFC (Orçamento › Novo orçamento): orçamento importado exige _editar; realizado é cache da tela.
create policy "dfc_orcamento: ler" on public.dfc_orcamento
  for select to authenticated using ((select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')));
create policy "dfc_orcamento: gravar" on public.dfc_orcamento
  for all to authenticated
  using ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')))
  with check ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')));
create policy "dfc_orcamento_linhas: ler" on public.dfc_orcamento_linhas
  for select to authenticated using ((select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')));
create policy "dfc_orcamento_linhas: gravar" on public.dfc_orcamento_linhas
  for all to authenticated
  using ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')))
  with check ((select privado.tem_permissao('sub_orc_geral_novo_orcamento_editar')));
create policy "dfc_realizado: ler e gravar" on public.dfc_realizado
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')))
  with check ((select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')));
create policy "dfc_realizado_itens: ler e gravar" on public.dfc_realizado_itens
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')))
  with check ((select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')));

-- Resultado de caixa (forecasts também lidos pelo DFC do orçamento).
create policy "resultado_caixa: ler" on public.resultado_caixa
  for select to authenticated using (
    (select privado.fin_pode_ver('sub_fin_cb_resultado_caixa'))
    or (select privado.fin_pode_ver('sub_orc_geral_novo_orcamento')));
create policy "resultado_caixa: gravar" on public.resultado_caixa
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_resultado_caixa_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_resultado_caixa_editar')));

-- Rydoo: sub_fin_cp_rydoo (rydoo_meta é cache: quem vê a tela grava)
create policy "rydoo_arquivos: ler" on public.rydoo_arquivos
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cp_rydoo')));
create policy "rydoo_arquivos: gravar" on public.rydoo_arquivos
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cp_rydoo_editar')))
  with check ((select privado.tem_permissao('sub_fin_cp_rydoo_editar')));
create policy "rydoo_meta: ler e gravar" on public.rydoo_meta
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_fin_cp_rydoo')))
  with check ((select privado.fin_pode_ver('sub_fin_cp_rydoo')));
create policy "rydoo_titulos: ler" on public.rydoo_titulos
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cp_rydoo')));
create policy "rydoo_titulos: gravar" on public.rydoo_titulos
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cp_rydoo_editar')))
  with check ((select privado.tem_permissao('sub_fin_cp_rydoo_editar')));

-- Fila de notas: lida também por Compras (controle financeiro, previsões) -> todo ativo lê;
-- grava quem envia (enviar_nota) ou quem valida (inserir_nota).
create policy "fiscal_notas_envio: ler" on public.fiscal_notas_envio
  for select to authenticated using ((select privado.usuario_ativo()));
create policy "fiscal_notas_envio: gravar" on public.fiscal_notas_envio
  for all to authenticated
  using ((select privado.tem_permissao('sub_fiscal_geral_enviar_nota_editar'))
      or (select privado.tem_permissao('sub_fiscal_geral_inserir_nota_editar')))
  with check ((select privado.tem_permissao('sub_fiscal_geral_enviar_nota_editar'))
      or (select privado.tem_permissao('sub_fiscal_geral_inserir_nota_editar')));
create policy "fiscal_notas_aprendizado: ler" on public.fiscal_notas_aprendizado
  for select to authenticated using (
    (select privado.fin_pode_ver('sub_fiscal_geral_enviar_nota'))
    or (select privado.fin_pode_ver('sub_fiscal_geral_inserir_nota')));
create policy "fiscal_notas_aprendizado: gravar" on public.fiscal_notas_aprendizado
  for all to authenticated
  using ((select privado.tem_permissao('sub_fiscal_geral_inserir_nota_editar')))
  with check ((select privado.tem_permissao('sub_fiscal_geral_inserir_nota_editar')));

-- Marketing: sub_mkt_geral_budget (config também por sub_mkt_geral_config; caches: quem vê grava)
create policy "marketing_budgets: ler" on public.marketing_budgets
  for select to authenticated using ((select privado.fin_pode_ver('sub_mkt_geral_budget')));
create policy "marketing_budgets: gravar" on public.marketing_budgets
  for all to authenticated
  using ((select privado.tem_permissao('sub_mkt_geral_budget_editar')))
  with check ((select privado.tem_permissao('sub_mkt_geral_budget_editar')));
create policy "marketing_budget_config: ler" on public.marketing_budget_config
  for select to authenticated using (
    (select privado.fin_pode_ver('sub_mkt_geral_budget'))
    or (select privado.fin_pode_ver('sub_mkt_geral_config')));
create policy "marketing_budget_config: gravar" on public.marketing_budget_config
  for all to authenticated
  using ((select privado.tem_permissao('sub_mkt_geral_config_editar'))
      or (select privado.tem_permissao('sub_mkt_geral_budget_editar')))
  with check ((select privado.tem_permissao('sub_mkt_geral_config_editar'))
      or (select privado.tem_permissao('sub_mkt_geral_budget_editar')));
create policy "marketing_budget_titulos: ler e gravar" on public.marketing_budget_titulos
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_mkt_geral_budget')))
  with check ((select privado.fin_pode_ver('sub_mkt_geral_budget')));
create policy "marketing_budget_vendas: ler e gravar" on public.marketing_budget_vendas
  for all to authenticated
  using ((select privado.fin_pode_ver('sub_mkt_geral_budget')))
  with check ((select privado.fin_pode_ver('sub_mkt_geral_budget')));

-- Mútuo: sub_fin_cb_mutuo
create policy "mutuo_execucoes: ler" on public.mutuo_execucoes
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cb_mutuo')));
create policy "mutuo_execucoes: gravar" on public.mutuo_execucoes
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_mutuo_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_mutuo_editar')));
create policy "mutuo_execucoes_centros: ler" on public.mutuo_execucoes_centros
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cb_mutuo')));
create policy "mutuo_execucoes_centros: gravar" on public.mutuo_execucoes_centros
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_mutuo_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_mutuo_editar')));
create policy "mutuo_meta: ler" on public.mutuo_meta
  for select to authenticated using ((select privado.fin_pode_ver('sub_fin_cb_mutuo')));
create policy "mutuo_meta: gravar" on public.mutuo_meta
  for all to authenticated
  using ((select privado.tem_permissao('sub_fin_cb_mutuo_editar')))
  with check ((select privado.tem_permissao('sub_fin_cb_mutuo_editar')));

-- Títulos incompletos: aviso lido por todo usuário ativo; gravado só pelo cron.
create policy "titulos_incompletos_batimento: ler" on public.titulos_incompletos_batimento
  for select to authenticated using ((select privado.usuario_ativo()));

-- =====================================================================================================
-- 13. Realtime (onSnapshot no código)
-- =====================================================================================================

-- js/fiscal/fiscal-enviar-nota.js:160 (fila de notas, compartilhada por Enviar nota / Validar nota / Compras)
alter publication supabase_realtime add table public.fiscal_notas_envio;

-- =====================================================================================================
-- 14. RPCs: regravações "apaga e põe" atômicas (no Firestore eram vários setDoc em sequência)
--     security invoker: a RLS do chamador vale dentro da função.
-- =====================================================================================================

-- Grava um mês da base de movimentos bancários (js/nucleo/sienge-api.js _gravarMesCaixa).
create or replace function public.gravar_caixa_movimentos_mes(p_company_id text, p_ym text, p_movimentos jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_id text := p_company_id || '_' || p_ym;
  v_n  integer;
begin
  if p_ym is null or p_ym !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Mês inválido: %', p_ym;
  end if;
  insert into public.caixa_movimentos (id, company_id, ym, n, em)
  values (v_id, p_company_id, p_ym, jsonb_array_length(privado.fin_arr(p_movimentos)), now())
  on conflict (id) do update set n = excluded.n, em = excluded.em;

  delete from public.caixa_movimentos_itens where caixa_movimentos_id = v_id;
  insert into public.caixa_movimentos_itens (caixa_movimentos_id, company_id, ym, ordem, data, centros_custo, dados)
  select v_id, p_company_id, p_ym, t.o::integer,
         privado.fin_data(coalesce(nullif(t.m->>'bankMovementDate', ''), nullif(t.m->>'paymentDate', ''), t.m->>'date')),
         array(
           select distinct c from (
             select t.m->>'costCenterId' as c
             union all
             select fc->>'costCenterId' from jsonb_array_elements(privado.fin_arr(t.m->'financialCategories')) as fc
           ) s where c is not null and c <> ''
         ),
         t.m
  from jsonb_array_elements(privado.fin_arr(p_movimentos)) with ordinality as t(m, o);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Regrava a foto de um dia (CaixaPosicaoStore.saveFromUnits / estoque-batimento saveCaixaPosicao).
create or replace function public.gravar_caixa_posicao(p_data date, p_linhas jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_n integer;
begin
  delete from public.caixa_posicao where d = p_data;
  insert into public.caixa_posicao (d, uid, un, cc, cn, cid, cpf, nome, rec, ven, av, vp, pmp, st, parc, extra)
  select p_data, r->>'uid', r->>'un', r->>'cc', r->>'cn', r->>'cid', r->>'cpf', r->>'nome',
         privado.fin_num(r->>'rec'), privado.fin_num(r->>'ven'), privado.fin_num(r->>'av'),
         privado.fin_num(r->>'vp'), privado.fin_num(r->>'pmp'), r->>'st', privado.fin_arr(r->'parc'),
         r - array['d','uid','un','cc','cn','cid','cpf','nome','rec','ven','av','vp','pmp','st','parc']
  from jsonb_array_elements(privado.fin_arr(p_linhas)) as r;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Datas com foto gravada, mais recente primeiro (CaixaPosicaoStore.listDates).
create or replace function public.listar_datas_caixa_posicao()
returns setof date language sql stable security invoker set search_path = '' as $$
  select distinct d from public.caixa_posicao order by d desc;
$$;

-- Valor a receber de uma empresa (caixa-diario.js atualizarVr / morning-warmup continuarValorReceber).
-- p_itens: array de itens (ou a string JSON que hoje vai em "itens").
create or replace function public.gravar_caixa_valor_receber(p_registro jsonb, p_itens jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_cid   text := nullif(btrim(p_registro->>'companyId'), '');
  v_id    text;
  v_itens jsonb;
  v_n     integer;
begin
  if v_cid is null then raise exception 'companyId obrigatório.'; end if;
  v_id := 'emp_' || v_cid;
  v_itens := case jsonb_typeof(p_itens)
               when 'array' then p_itens
               when 'string' then (p_itens #>> '{}')::jsonb
               else '[]'::jsonb end;
  insert into public.caixa_valor_receber (id, company_id, ini, fim, origem, por, falhas, extra)
  values (v_id, v_cid, privado.fin_data(p_registro->>'ini'), privado.fin_data(p_registro->>'fim'),
          p_registro->>'origem', p_registro->>'por', coalesce(privado.fin_int(p_registro->>'falhas'), 0),
          p_registro - array['companyId','ini','fim','origem','por','falhas','itens','atualizadoEm'])
  on conflict (id) do update set
    ini = excluded.ini, fim = excluded.fim, origem = excluded.origem, por = excluded.por,
    falhas = excluded.falhas, extra = excluded.extra;

  delete from public.caixa_valor_receber_itens where caixa_valor_receber_id = v_id;
  insert into public.caixa_valor_receber_itens (caixa_valor_receber_id, ordem, empresa, company_id, doc, descricao,
    titulo, parcela, vencimento, valor, cliente, cc, cc_nome, extra)
  select v_id, t.o::integer, t.i->>'empresa', t.i->>'companyId', t.i->>'doc', t.i->>'descricao',
         t.i->>'titulo', t.i->>'parcela', privado.fin_data(t.i->>'vencimento'), privado.fin_num(t.i->>'valor'),
         t.i->>'cliente', t.i->>'cc', t.i->>'ccNome',
         t.i - array['empresa','companyId','doc','descricao','titulo','parcela','vencimento','valor','cliente','cc','ccNome']
  from jsonb_array_elements(privado.fin_arr(v_itens)) with ordinality as t(i, o);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Grava um mês de contas pagas de uma empresa (compras-controle-financeiro.js _gravarMesPago /
-- morning-warmup gravarMesPago).
create or replace function public.gravar_cfin_pagos_mes(p_company_id text, p_ym text, p_bills jsonb,
  p_ate date default null, p_fechado boolean default false)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_id text := coalesce(nullif(p_company_id, ''), 'todas') || '_' || p_ym;
  v_n  integer;
begin
  if p_ym is null or p_ym !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Mês inválido: %', p_ym;
  end if;
  insert into public.cfin_pagos (id, company_id, ym, n, em, ate, fechado)
  values (v_id, coalesce(nullif(p_company_id, ''), 'todas'), p_ym, jsonb_array_length(privado.fin_arr(p_bills)),
          now(), p_ate, coalesce(p_fechado, false))
  on conflict (id) do update set n = excluded.n, em = excluded.em, ate = excluded.ate, fechado = excluded.fechado;

  delete from public.cfin_pagos_bills where cfin_pagos_id = v_id;
  insert into public.cfin_pagos_bills (cfin_pagos_id, company_id, ym, ordem, bill_id, installment_id, creditor_id,
    creditor_name, document_identification_id, document_number, due_date, issue_date, original_amount,
    balance_amount, dados)
  select v_id, coalesce(nullif(t.b->>'companyId', ''), p_company_id, 'todas'), p_ym, t.o::integer,
         t.b->>'billId', privado.fin_int(t.b->>'installmentId'), t.b->>'creditorId', t.b->>'creditorName',
         btrim(t.b->>'documentIdentificationId'), t.b->>'documentNumber',
         privado.fin_data(t.b->>'dueDate'), privado.fin_data(t.b->>'issueDate'),
         privado.fin_num(t.b->>'originalAmount'), privado.fin_num(t.b->>'balanceAmount'), t.b
  from jsonb_array_elements(privado.fin_arr(p_bills)) with ordinality as t(b, o);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Batimento diário das antecipações (lib/antecipacoes-batimento.js): troca os eventos da janela
-- [p_ini, p_fim] pelos que o Sienge devolveu e recalcula o cabeçalho dos meses tocados. Só servidor.
create or replace function public.substituir_antecipacoes_janela(p_ini date, p_fim date, p_eventos jsonb,
  p_fonte text default 'batimento-7h')
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_n integer;
begin
  insert into public.antecipacoes_mes (id, fonte)
  select to_char(g, 'YYYY-MM'), p_fonte
  from generate_series(date_trunc('month', p_ini::timestamp), p_fim::timestamp, interval '1 month') as g
  on conflict (id) do nothing;

  delete from public.antecipacoes_mes_eventos where data between p_ini and p_fim;

  insert into public.antecipacoes_mes (id, fonte)
  select distinct left(e->>'data', 7), p_fonte
  from jsonb_array_elements(privado.fin_arr(p_eventos)) as e
  on conflict (id) do nothing;

  insert into public.antecipacoes_mes_eventos (id, antecipacoes_mes_id, tit, data, emp, emp_nome, cli, cli_id, unid,
    cc, cc_nome, doc, taxa, tipo_juros, parcelas, vf, vp, pago, desc_sienge, max_dias, min_dias, juros, comercial,
    desc_total, np, faixa, extra)
  select e->>'k', left(e->>'data', 7), e->>'tit', privado.fin_data(e->>'data'), e->>'emp', e->>'empNome',
         e->>'cli', e->>'cliId', e->>'unid', e->>'cc', e->>'ccNome', e->>'doc', privado.fin_num(e->>'taxa'),
         e->>'tipoJuros', privado.fin_arr(e->'parcelas'), privado.fin_num(e->>'vf'), privado.fin_num(e->>'vp'),
         privado.fin_num(e->>'pago'), privado.fin_num(e->>'descSienge'), privado.fin_int(e->>'maxDias'),
         privado.fin_int(e->>'minDias'), privado.fin_num(e->>'juros'), privado.fin_num(e->>'comercial'),
         privado.fin_num(e->>'descTotal'), privado.fin_int(e->>'np'), e->>'faixa',
         e - array['k','tit','data','emp','empNome','cli','cliId','unid','cc','ccNome','doc','taxa','tipoJuros',
                   'parcelas','vf','vp','pago','descSienge','maxDias','minDias','juros','comercial','descTotal','np','faixa']
  from jsonb_array_elements(privado.fin_arr(p_eventos)) as e
  on conflict (id) do update set
    antecipacoes_mes_id = excluded.antecipacoes_mes_id, tit = excluded.tit, data = excluded.data,
    emp = excluded.emp, emp_nome = excluded.emp_nome, cli = excluded.cli, cli_id = excluded.cli_id,
    unid = excluded.unid, cc = excluded.cc, cc_nome = excluded.cc_nome, doc = excluded.doc, taxa = excluded.taxa,
    tipo_juros = excluded.tipo_juros, parcelas = excluded.parcelas, vf = excluded.vf, vp = excluded.vp,
    pago = excluded.pago, desc_sienge = excluded.desc_sienge, max_dias = excluded.max_dias,
    min_dias = excluded.min_dias, juros = excluded.juros, comercial = excluded.comercial,
    desc_total = excluded.desc_total, np = excluded.np, faixa = excluded.faixa, extra = excluded.extra;
  get diagnostics v_n = row_count;

  update public.antecipacoes_mes m
     set eventos = (select count(*) from public.antecipacoes_mes_eventos ev where ev.antecipacoes_mes_id = m.id),
         fonte = p_fonte
   where m.id >= to_char(p_ini, 'YYYY-MM') and m.id <= to_char(p_fim, 'YYYY-MM');
  return v_n;
end $$;

-- Salva um lote inteiro (gerar-pagamento.js:3376), trocando os itens.
create or replace function public.salvar_pagamento_lote(p_lote jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_id     text := nullif(btrim(p_lote->>'id'), '');
  v_sienge jsonb := case when jsonb_typeof(p_lote->'sienge') = 'object' then p_lote->'sienge' else '{}'::jsonb end;
  v_conta  jsonb := case when jsonb_typeof(p_lote->'conta') = 'object' then p_lote->'conta' else '{}'::jsonb end;
  v_extra  jsonb;
begin
  if v_id is null then raise exception 'Lote sem id.'; end if;
  v_extra := p_lote - array['id','criadoPor','criadoPorEmail','criadoEm','total','contaKey','conta','dia',
                            'empresaConta','dataBaixa','cancelado','canceladoMotivo','canceladoEm',
                            'transferencias','sienge','itens'];
  if (v_sienge - array['numero','status','geradoEm','geradoPor','erro','historico']) <> '{}'::jsonb then
    v_extra := v_extra || jsonb_build_object('sienge', v_sienge - array['numero','status','geradoEm','geradoPor','erro','historico']);
  end if;

  insert into public.pagamento_lotes (id, criado_por, criado_por_email, criado_em, total, conta_key, conta_id,
    conta_nome, conta_numero, conta_agencia, conta_banco, dia, empresa_conta, data_baixa, cancelado,
    cancelado_motivo, cancelado_em, transferencias, sienge_numero, sienge_status, sienge_gerado_em,
    sienge_gerado_por, sienge_erro, sienge_historico, extra)
  values (v_id, p_lote->>'criadoPor', lower(p_lote->>'criadoPorEmail'),
          coalesce(privado.fin_ts(p_lote->>'criadoEm'), now()), privado.fin_num(p_lote->>'total'),
          p_lote->>'contaKey', v_conta->>'id', v_conta->>'nome', v_conta->>'numero', v_conta->>'agencia',
          v_conta->>'banco', privado.fin_data(p_lote->>'dia'), p_lote->>'empresaConta',
          privado.fin_data(p_lote->>'dataBaixa'), coalesce((p_lote->>'cancelado')::boolean, false),
          p_lote->>'canceladoMotivo', privado.fin_ts(p_lote->>'canceladoEm'), privado.fin_arr(p_lote->'transferencias'),
          nullif(v_sienge->>'numero', ''), v_sienge->>'status', privado.fin_ts(v_sienge->>'geradoEm'),
          v_sienge->>'geradoPor', nullif(v_sienge->>'erro', ''), privado.fin_arr(v_sienge->'historico'), v_extra)
  on conflict (id) do update set
    criado_por = excluded.criado_por, criado_por_email = excluded.criado_por_email, total = excluded.total,
    conta_key = excluded.conta_key, conta_id = excluded.conta_id, conta_nome = excluded.conta_nome,
    conta_numero = excluded.conta_numero, conta_agencia = excluded.conta_agencia, conta_banco = excluded.conta_banco,
    dia = excluded.dia, empresa_conta = excluded.empresa_conta, data_baixa = excluded.data_baixa,
    cancelado = excluded.cancelado, cancelado_motivo = excluded.cancelado_motivo,
    cancelado_em = excluded.cancelado_em, transferencias = excluded.transferencias,
    sienge_numero = excluded.sienge_numero, sienge_status = excluded.sienge_status,
    sienge_gerado_em = excluded.sienge_gerado_em, sienge_gerado_por = excluded.sienge_gerado_por,
    sienge_erro = excluded.sienge_erro, sienge_historico = excluded.sienge_historico, extra = excluded.extra;

  delete from public.pagamento_lotes_itens where pagamento_lotes_id = v_id;
  insert into public.pagamento_lotes_itens (pagamento_lotes_id, ordem, titulo, parcela, forma, linha_digitavel,
    vencimento, valor, valor_bruto, impostos_retidos, impostos, credor_id, credor, company_id, ccs, conferencia,
    documento, valida, extra)
  select v_id, t.o::integer, coalesce(t.i->>'titulo', ''), t.i->>'parcela', t.i->>'forma', t.i->>'linhaDigitavel',
         privado.fin_data(t.i->>'vencimento'), privado.fin_num(t.i->>'valor'), privado.fin_num(t.i->>'valorBruto'),
         privado.fin_num(t.i->>'impostosRetidos'), t.i->>'impostos', t.i->>'credorId', t.i->>'credor',
         t.i->>'companyId', t.i->>'ccs', t.i->>'conferencia', t.i->>'documento', t.i->'valida',
         t.i - array['titulo','parcela','forma','linhaDigitavel','vencimento','valor','valorBruto','impostosRetidos',
                     'impostos','credorId','credor','companyId','ccs','conferencia','documento','valida']
  from jsonb_array_elements(privado.fin_arr(p_lote->'itens')) with ordinality as t(i, o);
  return v_id;
end $$;

-- Salva um período da prestação de contas com as despesas (participacoes.js savePeriodToFirebase).
create or replace function public.salvar_participacoes_period(p_period jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_company text := btrim(coalesce(p_period->>'companyId', ''));
  v_closing text := btrim(coalesce(p_period->>'closing', ''));
  v_id      text;
begin
  if v_company = '' or v_closing = '' then raise exception 'companyId e closing são obrigatórios.'; end if;
  v_id := coalesce(nullif(p_period->>'id', ''), regexp_replace(v_company || '_' || v_closing, '[^A-Za-z0-9_.-]+', '_', 'g'));
  insert into public.participacoes_periods (id, company_id, closing, file_name, saldo_total, pdf_url, pdf_path,
    cache_ver, atualizado_por, extra)
  values (v_id, v_company, v_closing, p_period->>'fileName', privado.fin_num(p_period->>'saldoTotal'),
          p_period->>'pdfUrl', p_period->>'pdfPath', privado.fin_int(p_period->>'cacheVer'), p_period->>'updatedBy',
          p_period - array['id','companyId','closing','fileName','saldoTotal','pdfUrl','pdfPath','cacheVer',
                           'updatedBy','updatedAt','updatedAtServer','expenses'])
  on conflict (id) do update set
    file_name = excluded.file_name, saldo_total = excluded.saldo_total, pdf_url = excluded.pdf_url,
    pdf_path = excluded.pdf_path, cache_ver = excluded.cache_ver, atualizado_por = excluded.atualizado_por,
    extra = excluded.extra;

  if p_period ? 'expenses' then
    delete from public.participacoes_periods_expenses where participacoes_periods_id = v_id;
    insert into public.participacoes_periods_expenses (participacoes_periods_id, ordem, source_file, credor,
      categoria, categoria_id, valor, doc, periodo, detalhe, iso, extra)
    select v_id, t.o::integer, t.x->>'sourceFile', t.x->>'credor', t.x->>'categoria', t.x->>'categoriaId',
           privado.fin_num(t.x->>'valor'), t.x->>'doc', t.x->>'periodo', t.x->>'detalhe',
           coalesce(privado.fin_data(t.x->>'iso'), privado.fin_data(t.x->>'date')),
           t.x - array['sourceFile','credor','categoria','categoriaId','valor','doc','periodo','detalhe','iso','date']
    from jsonb_array_elements(privado.fin_arr(p_period->'expenses')) with ordinality as t(x, o);
  end if;
  return v_id;
end $$;

-- Realizado do DFC de uma empresa (orcamento-dfc.js salvarRealizadoEmpresa). Aceita linhas como objeto
-- {gid, code, cc, i, v, ccn, cn} ou no formato compacto [gid, code, cc, i, v, ccn, cn].
create or replace function public.gravar_dfc_realizado(p_empresa text, p_fim date, p_ate date, p_itens jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_emp text := regexp_replace(coalesce(p_empresa, ''), '[^0-9]', '', 'g');
  v_id  text;
  v_n   integer;
begin
  if v_emp = '' then raise exception 'Empresa inválida: %', p_empresa; end if;
  v_id := 'c' || v_emp;
  insert into public.dfc_realizado (id, empresa, fim, ate, v, em, n)
  values (v_id, v_emp, p_fim, coalesce(p_ate, p_fim), 3, now(), jsonb_array_length(privado.fin_arr(p_itens)))
  on conflict (id) do update set fim = excluded.fim, ate = excluded.ate, v = excluded.v, em = excluded.em, n = excluded.n;

  delete from public.dfc_realizado_itens where dfc_realizado_id = v_id;
  insert into public.dfc_realizado_itens (dfc_realizado_id, ordem, gid, code, cc, i, v, ccn, cn)
  select v_id, t.o::integer,
         case when jsonb_typeof(t.r) = 'array' then t.r->>0 else t.r->>'gid' end,
         case when jsonb_typeof(t.r) = 'array' then t.r->>1 else t.r->>'code' end,
         case when jsonb_typeof(t.r) = 'array' then t.r->>2 else t.r->>'cc' end,
         privado.fin_int(case when jsonb_typeof(t.r) = 'array' then t.r->>3 else t.r->>'i' end),
         privado.fin_num(case when jsonb_typeof(t.r) = 'array' then t.r->>4 else t.r->>'v' end),
         case when jsonb_typeof(t.r) = 'array' then t.r->>5 else t.r->>'ccn' end,
         case when jsonb_typeof(t.r) = 'array' then t.r->>6 else t.r->>'cn' end
  from jsonb_array_elements(privado.fin_arr(p_itens)) with ordinality as t(r, o);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Orçamento importado da planilha (orcamento-dfc.js salvarOrcamentoNuvem).
create or replace function public.gravar_dfc_orcamento(p_id text, p_file_name text, p_saved_at timestamptz,
  p_year integer, p_linhas jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_n integer;
begin
  if coalesce(p_id, '') = '' then raise exception 'Id do orçamento obrigatório.'; end if;
  insert into public.dfc_orcamento (id, file_name, saved_at, year, n)
  values (p_id, p_file_name, coalesce(p_saved_at, now()), p_year, jsonb_array_length(privado.fin_arr(p_linhas)))
  on conflict (id) do update set file_name = excluded.file_name, saved_at = excluded.saved_at,
    year = excluded.year, n = excluded.n;

  delete from public.dfc_orcamento_linhas where dfc_orcamento_id = p_id;
  insert into public.dfc_orcamento_linhas (dfc_orcamento_id, ordem, e, enome, cc, en, conta, cn, obs, m, extra)
  select p_id, t.o::integer, t.l->>'e', t.l->>'enome', t.l->>'cc', t.l->>'en', t.l->>'conta', t.l->>'cn', t.l->>'obs',
         coalesce((select array_agg(privado.fin_num(mm.x) order by mm.k)
                   from jsonb_array_elements_text(privado.fin_arr(t.l->'m')) with ordinality as mm(x, k)),
                  '{}'::numeric[]),
         t.l - array['e','enome','cc','en','conta','cn','obs','m']
  from jsonb_array_elements(privado.fin_arr(p_linhas)) with ordinality as t(l, o);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Numeração das notas de débito do mútuo: só avança (mutuo.js gravarUltimaNd, que lia e gravava sem trava).
create or replace function public.registrar_nota_debito_mutuo(p_numero integer, p_por text default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ultima integer;
begin
  insert into public.mutuo_meta as m (id, ultima, por)
  values ('notas_debito', p_numero, coalesce(p_por, (select auth.jwt() ->> 'email')))
  on conflict (id) do update set
    ultima = greatest(m.ultima, excluded.ultima),
    por = case when excluded.ultima > m.ultima then excluded.por else m.por end
  returning ultima into v_ultima;
  return v_ultima;
end $$;

revoke all on function
  public.gravar_caixa_movimentos_mes(text, text, jsonb),
  public.gravar_caixa_posicao(date, jsonb),
  public.listar_datas_caixa_posicao(),
  public.gravar_caixa_valor_receber(jsonb, jsonb),
  public.gravar_cfin_pagos_mes(text, text, jsonb, date, boolean),
  public.substituir_antecipacoes_janela(date, date, jsonb, text),
  public.salvar_pagamento_lote(jsonb),
  public.salvar_participacoes_period(jsonb),
  public.gravar_dfc_realizado(text, date, date, jsonb),
  public.gravar_dfc_orcamento(text, text, timestamptz, integer, jsonb),
  public.registrar_nota_debito_mutuo(integer, text)
  from public, anon;

grant execute on function
  public.gravar_caixa_movimentos_mes(text, text, jsonb),
  public.gravar_caixa_posicao(date, jsonb),
  public.listar_datas_caixa_posicao(),
  public.gravar_caixa_valor_receber(jsonb, jsonb),
  public.gravar_cfin_pagos_mes(text, text, jsonb, date, boolean),
  public.salvar_pagamento_lote(jsonb),
  public.salvar_participacoes_period(jsonb),
  public.gravar_dfc_realizado(text, date, date, jsonb),
  public.gravar_dfc_orcamento(text, text, timestamptz, integer, jsonb),
  public.registrar_nota_debito_mutuo(integer, text)
  to authenticated, service_role;

-- Só o cron das antecipações.
revoke execute on function public.substituir_antecipacoes_janela(date, date, jsonb, text) from authenticated;
grant execute on function public.substituir_antecipacoes_janela(date, date, jsonb, text) to service_role;
