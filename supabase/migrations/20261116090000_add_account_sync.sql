-- Account namespaces are random, server-owned, and available only after login.
-- Legacy anonymous namespaces remain usable for gradual, non-destructive import.
begin;
create table public.account_sync_namespaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id uuid not null unique default gen_random_uuid()
);
create table public.account_legacy_imports (
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_device_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (user_id, legacy_device_id)
);
alter table public.account_sync_namespaces enable row level security;
alter table public.account_legacy_imports enable row level security;
revoke all on public.account_sync_namespaces, public.account_legacy_imports from anon, authenticated;

create function public.get_account_sync_id() returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Sign in required'; end if;
  insert into public.account_sync_namespaces(user_id) values (auth.uid())
    on conflict (user_id) do nothing;
  select device_id into result from public.account_sync_namespaces where user_id = auth.uid();
  return result;
end;
$$;
revoke all on function public.get_account_sync_id() from public, anon;
grant execute on function public.get_account_sync_id() to authenticated;

create function public.assert_sync_access(p_device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.account_sync_namespaces
    where device_id = p_device_id and user_id is distinct from auth.uid())
    and coalesce(auth.role(), '') <> 'service_role' then
    raise insufficient_privilege using message = 'This data belongs to another account';
  end if;
end;
$$;
revoke all on function public.assert_sync_access(uuid) from public, anon, authenticated;

alter function public.get_saved_article_ids(uuid) rename to get_saved_article_ids_internal;
revoke all on function public.get_saved_article_ids_internal(uuid) from public, anon, authenticated;
create function public.get_saved_article_ids(p_device_id uuid) returns table(article_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  return query select * from public.get_saved_article_ids_internal(p_device_id);
end;
$$;
revoke all on function public.get_saved_article_ids(uuid) from public;
grant execute on function public.get_saved_article_ids(uuid) to anon, authenticated;

alter function public.set_article_saved(uuid, uuid, boolean) rename to set_article_saved_internal;
revoke all on function public.set_article_saved_internal(uuid, uuid, boolean) from public, anon, authenticated;
create function public.set_article_saved(p_device_id uuid, p_article_id uuid, p_saved boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  perform public.set_article_saved_internal(p_device_id, p_article_id, p_saved);
end;
$$;
revoke all on function public.set_article_saved(uuid, uuid, boolean) from public;
grant execute on function public.set_article_saved(uuid, uuid, boolean) to anon, authenticated;

alter function public.get_user_interests(uuid) rename to get_user_interests_internal;
revoke all on function public.get_user_interests_internal(uuid) from public, anon, authenticated;
create function public.get_user_interests(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  return public.get_user_interests_internal(p_device_id);
end;
$$;
revoke all on function public.get_user_interests(uuid) from public;
grant execute on function public.get_user_interests(uuid) to anon, authenticated;

alter function public.save_interest_digest(uuid, text, date, text, text) rename to save_interest_digest_internal;
revoke all on function public.save_interest_digest_internal(uuid, text, date, text, text) from public, anon, authenticated;
create function public.save_interest_digest(p_device_id uuid, p_interest text, p_week_start date, p_overview_zh text, p_overview_en text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  perform public.save_interest_digest_internal(p_device_id, p_interest, p_week_start, p_overview_zh, p_overview_en);
end;
$$;
revoke all on function public.save_interest_digest(uuid, text, date, text, text) from public;
grant execute on function public.save_interest_digest(uuid, text, date, text, text) to anon, authenticated;

alter function public.remove_user_interest(uuid, text) rename to remove_user_interest_internal;
revoke all on function public.remove_user_interest_internal(uuid, text) from public, anon, authenticated;
create function public.remove_user_interest(p_device_id uuid, p_interest text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  perform public.remove_user_interest_internal(p_device_id, p_interest);
end;
$$;
revoke all on function public.remove_user_interest(uuid, text) from public;
grant execute on function public.remove_user_interest(uuid, text) to anon, authenticated;

alter function public.get_research_topics(uuid) rename to get_research_topics_internal;
revoke all on function public.get_research_topics_internal(uuid) from public, anon, authenticated;
create function public.get_research_topics(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  return public.get_research_topics_internal(p_device_id);
end;
$$;
revoke all on function public.get_research_topics(uuid) from public;
grant execute on function public.get_research_topics(uuid) to anon, authenticated;

alter function public.save_research_topic(uuid, text, jsonb) rename to save_research_topic_internal;
revoke all on function public.save_research_topic_internal(uuid, text, jsonb) from public, anon, authenticated;
create function public.save_research_topic(p_device_id uuid, p_topic text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  perform public.save_research_topic_internal(p_device_id, p_topic, p_data);
end;
$$;
revoke all on function public.save_research_topic(uuid, text, jsonb) from public;
grant execute on function public.save_research_topic(uuid, text, jsonb) to anon, authenticated;

alter function public.remove_research_topic(uuid, text) rename to remove_research_topic_internal;
revoke all on function public.remove_research_topic_internal(uuid, text) from public, anon, authenticated;
create function public.remove_research_topic(p_device_id uuid, p_topic text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_sync_access(p_device_id);
  perform public.remove_research_topic_internal(p_device_id, p_topic);
end;
$$;
revoke all on function public.remove_research_topic(uuid, text) from public;
grant execute on function public.remove_research_topic(uuid, text) to anon, authenticated;

-- Incremental, non-destructive legacy import. Lock this account so concurrent
-- first logins cannot restore stale rows or choose competing namespaces.
create function public.import_legacy_sync(p_device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  previous_import timestamptz;
  import_started timestamptz;
begin
  target := public.get_account_sync_id();
  if target = p_device_id or p_device_id is null then return; end if;
  perform public.assert_sync_access(p_device_id);
  perform 1 from public.account_sync_namespaces where user_id = auth.uid() for update;
  import_started := clock_timestamp();
  select imported_at into previous_import from public.account_legacy_imports
    where user_id = auth.uid() and legacy_device_id = p_device_id;
  insert into public.user_saved_articles(device_id, article_id, created_at)
    select target, article_id, created_at from public.user_saved_articles
    where device_id = p_device_id and (previous_import is null or created_at > previous_import)
    on conflict do nothing;
  insert into public.user_interests(device_id, interest, created_at)
    select target, interest, created_at from public.user_interests
    where device_id = p_device_id and (previous_import is null or created_at > previous_import)
    on conflict do nothing;
  insert into public.user_interest_digests(device_id, interest, week_start, overview_zh, overview_en, created_at)
    select target, interest, week_start, overview_zh, overview_en, created_at
    from public.user_interest_digests d where device_id = p_device_id
      and (previous_import is null or created_at > previous_import)
      and exists (select 1 from public.user_interests i where i.device_id = target and i.interest = d.interest)
    on conflict do nothing;
  insert into public.user_research_topics(device_id, topic, data, created_at, updated_at)
    select target, topic, data, created_at, updated_at from public.user_research_topics
    where device_id = p_device_id and (previous_import is null or updated_at > previous_import)
    on conflict (device_id, topic) do update set data = excluded.data, updated_at = excluded.updated_at
      where excluded.updated_at > public.user_research_topics.updated_at;
  insert into public.account_legacy_imports(user_id, legacy_device_id, imported_at)
    values (auth.uid(), p_device_id, import_started)
    on conflict (user_id, legacy_device_id) do update set imported_at = excluded.imported_at;
end;
$$;
revoke all on function public.import_legacy_sync(uuid) from public, anon;
grant execute on function public.import_legacy_sync(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
