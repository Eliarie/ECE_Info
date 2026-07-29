create extension if not exists pgcrypto with schema extensions;

create or replace function public.prune_unbookmarked_articles(
    p_retention_days integer,
    p_max_delete integer,
    p_cleanup_token text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    deleted_count integer;
    retention_days integer := greatest(30, least(coalesce(p_retention_days, 365), 3650));
    delete_limit integer := greatest(1, least(coalesce(p_max_delete, 200), 1000));
    expected_hash bytea := decode(
        '8419dd098c6f5411bc3c565e36fabd6f1382b7736776e372f5ccbbde085e16b4',
        'hex'
    );
begin
    if p_cleanup_token is null
       or extensions.digest(p_cleanup_token, 'sha256') <> expected_hash then
        raise insufficient_privilege using message = 'invalid cleanup credential';
    end if;

    with candidates as (
        select article.id
        from public.articles as article
        where coalesce(article.published_at, article.fetched_at)
                  < now() - make_interval(days => retention_days)
          and not exists (
              select 1
              from public.user_saved_articles as saved
              where saved.article_id = article.id
          )
        order by coalesce(article.published_at, article.fetched_at) asc
        limit delete_limit
    ), deleted as (
        delete from public.articles as article
        using candidates
        where article.id = candidates.id
        returning article.id
    )
    select count(*)::integer into deleted_count from deleted;

    return deleted_count;
end;
$$;

revoke all on function public.prune_unbookmarked_articles(integer, integer, text)
    from public, authenticated, service_role;
grant execute on function public.prune_unbookmarked_articles(integer, integer, text)
    to anon;
