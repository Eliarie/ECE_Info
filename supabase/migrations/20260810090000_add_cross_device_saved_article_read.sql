create or replace function public.get_saved_article_ids(p_device_id uuid)
returns table(article_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
    select saved.article_id
    from public.user_saved_articles as saved
    where saved.device_id = p_device_id
    order by saved.created_at desc;
$$;

revoke all on function public.get_saved_article_ids(uuid) from public;
grant execute on function public.get_saved_article_ids(uuid) to anon, authenticated;
