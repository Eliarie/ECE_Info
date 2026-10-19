-- 首页「兴趣速览」：每个同步码（与收藏共用 device_id）可以订阅多个兴趣，
-- 每个兴趣按周存档生成的概览。表本身不开放读写，只能经下面三个函数按同步码访问。

create table if not exists public.user_interests (
    device_id uuid not null,
    interest text not null check (char_length(interest) between 1 and 60),
    created_at timestamptz not null default now(),
    primary key (device_id, interest)
);

create table if not exists public.user_interest_digests (
    device_id uuid not null,
    interest text not null,
    week_start date not null,
    overview_zh text not null check (char_length(overview_zh) <= 8000),
    overview_en text not null default '' check (char_length(overview_en) <= 8000),
    created_at timestamptz not null default now(),
    primary key (device_id, interest, week_start),
    foreign key (device_id, interest)
        references public.user_interests(device_id, interest) on delete cascade
);

alter table public.user_interests enable row level security;
alter table public.user_interest_digests enable row level security;
revoke all on table public.user_interests from anon, authenticated;
revoke all on table public.user_interest_digests from anon, authenticated;

-- 读取：该同步码下的全部兴趣（按订阅先后），每个兴趣带全部往期概览（新的在前）
create or replace function public.get_user_interests(p_device_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'interest', i.interest,
                'created_at', i.created_at,
                'digests', coalesce((
                    select jsonb_agg(
                        jsonb_build_object(
                            'week_start', d.week_start,
                            'overview_zh', d.overview_zh,
                            'overview_en', d.overview_en
                        )
                        order by d.week_start desc
                    )
                    from public.user_interest_digests as d
                    where d.device_id = i.device_id and d.interest = i.interest
                ), '[]'::jsonb)
            )
            order by i.created_at
        ),
        '[]'::jsonb
    )
    from public.user_interests as i
    where i.device_id = p_device_id;
$$;

-- 写入：保存某个兴趣某一周的概览；兴趣不存在时顺带订阅（每个同步码最多 30 个兴趣）
create or replace function public.save_interest_digest(
    p_device_id uuid,
    p_interest text,
    p_week_start date,
    p_overview_zh text,
    p_overview_en text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    clean_interest text := btrim(p_interest);
begin
    if clean_interest is null or char_length(clean_interest) not between 1 and 60 then
        raise invalid_parameter_value using message = 'interest must be 1-60 characters';
    end if;

    if not exists (
        select 1 from public.user_interests
        where device_id = p_device_id and interest = clean_interest
    ) then
        if (select count(*) from public.user_interests where device_id = p_device_id) >= 30 then
            raise check_violation using message = 'too many interests';
        end if;
        insert into public.user_interests (device_id, interest)
        values (p_device_id, clean_interest)
        on conflict do nothing;
    end if;

    insert into public.user_interest_digests (device_id, interest, week_start, overview_zh, overview_en)
    values (p_device_id, clean_interest, p_week_start, p_overview_zh, coalesce(p_overview_en, ''))
    on conflict (device_id, interest, week_start) do update
        set overview_zh = excluded.overview_zh,
            overview_en = excluded.overview_en;
end;
$$;

-- 删除：取消订阅某个兴趣，连同它的全部往期概览
create or replace function public.remove_user_interest(p_device_id uuid, p_interest text)
returns void
language sql
security definer
set search_path = ''
as $$
    delete from public.user_interests
    where device_id = p_device_id and interest = btrim(p_interest);
$$;

revoke all on function public.get_user_interests(uuid) from public;
revoke all on function public.save_interest_digest(uuid, text, date, text, text) from public;
revoke all on function public.remove_user_interest(uuid, text) from public;
grant execute on function public.get_user_interests(uuid) to anon, authenticated;
grant execute on function public.save_interest_digest(uuid, text, date, text, text) to anon, authenticated;
grant execute on function public.remove_user_interest(uuid, text) to anon, authenticated;

-- 让 PostgREST 立即识别新函数，避免执行后仍报 PGRST202
notify pgrst, 'reload schema';
