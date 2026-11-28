-- Mapa vazio no patch zera o campo, como o setDoc merge do Firestore.
create or replace function privado.jsonb_fundir_profundo(a jsonb, b jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' and b <> '{}'::jsonb then (
      select coalesce(jsonb_object_agg(k, case
               when a ? k and b ? k then privado.jsonb_fundir_profundo(a -> k, b -> k)
               when b ? k then b -> k
               else a -> k end), '{}'::jsonb)
      from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) chaves)
    else b
  end;
$$;
