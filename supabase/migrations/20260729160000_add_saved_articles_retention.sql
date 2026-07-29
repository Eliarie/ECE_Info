create table if not exists public.user_saved_articles (
    device_id uuid not null,
    article_id uuid not null references public.articles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (device_id, article_id)
);

create index if not exists idx_user_saved_articles_article_id
    on public.user_saved_articles(article_id);

alter table public.user_saved_articles enable row level security;
revoke all on table public.user_saved_articles from anon, authenticated;

create or replace function public.set_article_saved(
    p_device_id uuid,
    p_article_id uuid,
    p_saved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_saved then
        insert into public.user_saved_articles (device_id, article_id)
        values (p_device_id, p_article_id)
        on conflict do nothing;
    else
        delete from public.user_saved_articles
        where device_id = p_device_id and article_id = p_article_id;
    end if;
end;
$$;

revoke all on function public.set_article_saved(uuid, uuid, boolean) from public;
grant execute on function public.set_article_saved(uuid, uuid, boolean) to anon, authenticated;

create or replace function public.prune_unbookmarked_articles(
    p_retention_days integer default 365,
    p_max_delete integer default 200
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
begin
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

revoke all on function public.prune_unbookmarked_articles(integer, integer) from public;
grant execute on function public.prune_unbookmarked_articles(integer, integer) to service_role;
