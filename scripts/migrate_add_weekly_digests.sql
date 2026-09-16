-- 每周研究速览（weekly_digests）
-- 在 Supabase Dashboard 的 SQL Editor 中运行此脚本

create table if not exists public.weekly_digests (
    id            uuid primary key default gen_random_uuid(),
    week_start    date not null unique,
    week_end      date not null,
    summary_zh    text not null,
    summary_en    text,
    article_ids   jsonb default '[]'::jsonb,
    article_count integer default 0,
    created_at    timestamptz default now()
);

create index if not exists idx_weekly_digests_week_start
    on public.weekly_digests(week_start desc);

-- 本项目抓取脚本与前端共用 anon key，需对 anon 开放读 + 写；service_role 默认拥有全部权限。
alter table public.weekly_digests enable row level security;

revoke all on table public.weekly_digests from anon, authenticated;
grant select, insert, update on table public.weekly_digests to anon;

create policy "weekly digests readable and writable by anon"
    on public.weekly_digests
    for all
    to anon
    using (true)
    with check (true);
