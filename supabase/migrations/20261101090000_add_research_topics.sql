-- Topic research (/research): each sync code (device_id, shared with bookmarks)
-- can save up to 30 topics. Each topic stores its search result and review as one jsonb.
-- The table is closed to anon; access only through the three functions below.
-- Kept ASCII-only so it pastes cleanly into the Supabase SQL Editor.

create table if not exists public.user_research_topics (
    device_id uuid not null,
    topic text not null check (char_length(topic) between 1 and 80),
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (device_id, topic)
);

alter table public.user_research_topics enable row level security;
revoke all on table public.user_research_topics from anon, authenticated;

-- Read: all topics for this sync code, newest first
create or replace function public.get_research_topics(p_device_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'topic', t.topic,
                'created_at', t.created_at,
                'updated_at', t.updated_at,
                'data', t.data
            )
            order by t.updated_at desc
        ),
        '[]'::jsonb
    )
    from public.user_research_topics as t
    where t.device_id = p_device_id;
$$;

-- Write: insert or replace one topic (max 30 per sync code, max ~400 KB each)
create or replace function public.save_research_topic(
    p_device_id uuid,
    p_topic text,
    p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_topic text := btrim(p_topic);
begin
    if clean_topic is null or char_length(clean_topic) not between 1 and 80 then
        raise invalid_parameter_value using message = 'topic must be 1-80 characters';
    end if;
    if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 400000 then
        raise invalid_parameter_value using message = 'data must be an object under 400 KB';
    end if;

    if not exists (
        select 1 from public.user_research_topics
        where device_id = p_device_id and topic = clean_topic
    ) and (select count(*) from public.user_research_topics where device_id = p_device_id) >= 30 then
        raise check_violation using message = 'too many research topics';
    end if;

    insert into public.user_research_topics (device_id, topic, data)
    values (p_device_id, clean_topic, p_data)
    on conflict (device_id, topic) do update
        set data = excluded.data,
            updated_at = now();
end;
$$;

-- Delete one topic
create or replace function public.remove_research_topic(p_device_id uuid, p_topic text)
returns void
language sql
security definer
set search_path = ''
as $$
    delete from public.user_research_topics
    where device_id = p_device_id and topic = btrim(p_topic);
$$;

revoke all on function public.get_research_topics(uuid) from public;
revoke all on function public.save_research_topic(uuid, text, jsonb) from public;
revoke all on function public.remove_research_topic(uuid, text) from public;
grant execute on function public.get_research_topics(uuid) to anon, authenticated;
grant execute on function public.save_research_topic(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.remove_research_topic(uuid, text) to anon, authenticated;

-- Make PostgREST see the new functions right away (avoids PGRST202)
notify pgrst, 'reload schema';

-- Check: should return 3 rows, all with anon_can_call = true
select p.proname as function_name,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_research_topics', 'save_research_topic', 'remove_research_topic')
order by p.proname;
