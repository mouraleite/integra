-- Perfis guardam o id antigo (config/global crm_moura_profiles[].id, ex.: operador_cobrança).
alter table public.perfis add column id_legado text unique;
