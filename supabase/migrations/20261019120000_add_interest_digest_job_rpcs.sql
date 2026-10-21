-- 每周速览任务（GitHub Actions，用的是 anon key）给所有订阅的兴趣补上当周概览，
-- 这样没打开网站的那几周也会存档。两张兴趣表对 anon 关闭，这里只开放两个认任务口令的函数。
-- 口令明文存在 GitHub Secret INTEREST_DIGEST_JOB_TOKEN，库里只存它的 sha256。
-- 依赖 20261019090000_add_user_interest_digests.sql。

create extension if not exists pgcrypto with schema extensions;

-- 列出：指定那一周还没有概览的订阅，按兴趣文本分组（同一兴趣只需调用一次模型），待生成多的排前面
create or replace function public.list_interest_digest_targets(
    p_job_token text,
    p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
    expected_hash bytea := decode(
        'bd073b99c92df076c69627efa9422040ddaea04ea3e652944106a6c559b2b67c',
        'hex'
    );
    result jsonb;
begin
    if p_job_token is null
       or extensions.digest(p_job_token, 'sha256') <> expected_hash then
        raise insufficient_privilege using message = 'invalid interest digest job credential';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'interest', grouped.interest,
                'pending_device_ids', to_jsonb(grouped.pending_device_ids),
                'done_count', grouped.done_count
            )
            order by cardinality(grouped.pending_device_ids) desc, grouped.interest
        ),
        '[]'::jsonb
    )
    into result
    from (
        select
            sub.interest,
            coalesce(
                array_agg(sub.device_id order by sub.created_at)
                    filter (where existing.device_id is null),
                '{}'::uuid[]
            ) as pending_device_ids,
            count(existing.device_id)::integer as done_count
        from public.user_interests as sub
        left join public.user_interest_digests as existing
            on existing.device_id = sub.device_id
           and existing.interest = sub.interest
           and existing.week_start = p_week_start
        group by sub.interest
    ) as grouped;

    return result;
end;
$$;

-- 写入：把同一兴趣的概览写给一批同步码。只写仍在订阅的；客户端先生成过的那份保留不覆盖。返回实际写入条数
create or replace function public.save_interest_digest_for_devices(
    p_job_token text,
    p_interest text,
    p_week_start date,
    p_overview_zh text,
    p_overview_en text,
    p_device_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    expected_hash bytea := decode(
        'bd073b99c92df076c69627efa9422040ddaea04ea3e652944106a6c559b2b67c',
        'hex'
    );
    inserted_count integer;
begin
    if p_job_token is null
       or extensions.digest(p_job_token, 'sha256') <> expected_hash then
        raise insufficient_privilege using message = 'invalid interest digest job credential';
    end if;

    if coalesce(btrim(p_overview_zh), '') = '' then
        raise invalid_parameter_value using message = 'overview_zh must not be empty';
    end if;

    -- [短语](编号) 指向该期 weekly_digests.article_ids 的位置，没有这一期就无从对应
    if not exists (select 1 from public.weekly_digests where week_start = p_week_start) then
        raise invalid_parameter_value using message = 'no weekly digest for that week';
    end if;

    insert into public.user_interest_digests (device_id, interest, week_start, overview_zh, overview_en)
    select sub.device_id, sub.interest, p_week_start, p_overview_zh, coalesce(p_overview_en, '')
    from public.user_interests as sub
    where sub.interest = p_interest
      and sub.device_id = any(p_device_ids)
    on conflict (device_id, interest, week_start) do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count;
end;
$$;

revoke all on function public.list_interest_digest_targets(text, date)
    from public, authenticated, service_role;
revoke all on function public.save_interest_digest_for_devices(text, text, date, text, text, uuid[])
    from public, authenticated, service_role;
grant execute on function public.list_interest_digest_targets(text, date)
    to anon;
grant execute on function public.save_interest_digest_for_devices(text, text, date, text, text, uuid[])
    to anon;

notify pgrst, 'reload schema';
