-- Fusão profunda de jsonb (como o setDoc merge do Firestore) e uso no controle do estoque comercial.
create or replace function privado.jsonb_fundir_profundo(a jsonb, b jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then (
      select coalesce(jsonb_object_agg(k, case
               when a ? k and b ? k then privado.jsonb_fundir_profundo(a -> k, b -> k)
               when b ? k then b -> k
               else a -> k end), '{}'::jsonb)
      from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) chaves)
    else b
  end;
$$;
revoke all on function privado.jsonb_fundir_profundo(jsonb, jsonb) from public, anon;
grant execute on function privado.jsonb_fundir_profundo(jsonb, jsonb) to authenticated, service_role;

create or replace function public.mesclar_estoque_comercial_controle(p_id text, p_patch jsonb, p_substituir boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare
  resultado jsonb;
begin
  insert into public.estoque_comercial_controle as c (id, dados)
  values (p_id, coalesce(p_patch, '{}'::jsonb))
  on conflict (id) do update
    set dados = case when p_substituir then excluded.dados
                     else privado.jsonb_fundir_profundo(c.dados, excluded.dados) end
  returning dados into resultado;
  return resultado;
end $$;
