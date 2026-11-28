-- Uma conta Microsoft pode servir a mais de um usuario do Integra (ex.: colenci@ para os advogados).
alter table public.usuarios drop constraint usuarios_login_email_key;
create index usuarios_login_email_idx on public.usuarios (login_email);
