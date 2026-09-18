# 数据库迁移 SQL

请在 Supabase Dashboard 的 SQL Editor 中运行以下 SQL：

1. 打开 https://supabase.com/dashboard/project/dbcgapvkagvisqzamoyo
2. 点击左侧菜单的 "SQL Editor"
3. 点击 "New query"
4. 复制粘贴以下 SQL 并点击 "Run"

---

## ① 跨设备收藏读取函数（待执行，收藏同步缺它就只在本机生效）

创建 `get_saved_article_ids`，让网站能按同步码读回该设备组的收藏。
写入用的 `set_article_saved` 已经在库里，缺的只是读取这一半：
收藏在本机正常，但换设备打开同步链接时读不回来，浏览器控制台会报 `PGRST202`。

```sql
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
```

> 完整文件见 `supabase/migrations/20260810090000_add_cross_device_saved_article_read.sql`。

该函数只按给定同步码返回对应的文章 ID，不开放 `user_saved_articles` 整表读权限。
执行后刷新网站，控制台不再报 `PGRST202` 即为成功。

---

## ② 每周研究速览表（已执行，若是新库需先执行）

创建 `weekly_digests` 表，用于存放每周自动生成的「本周速览」。

```sql
create table if not exists public.weekly_digests (
    id            uuid primary key default gen_random_uuid(),
    week_start    date not null unique,
    week_end      date not null,
    summary_zh    text not null,
    summary_en    text,
    highlights    jsonb default '[]'::jsonb,
    article_ids   jsonb default '[]'::jsonb,
    article_count integer default 0,
    created_at    timestamptz default now()
);

create index if not exists idx_weekly_digests_week_start
    on public.weekly_digests(week_start desc);

alter table public.weekly_digests enable row level security;

-- 抓取脚本与前端共用 anon key，需对 anon 开放读 + 写
revoke all on table public.weekly_digests from anon, authenticated;
grant select, insert, update on table public.weekly_digests to anon;

create policy "weekly digests readable and writable by anon"
    on public.weekly_digests
    for all
    to anon
    using (true)
    with check (true);
```

> 完整文件见 `scripts/migrate_add_weekly_digests.sql`。

执行后即可开始生成速览（本地运行 `python3 scripts/generate_digest.py`，或由 `.github/workflows/weekly_digest.yml` 每周自动执行）。

---

## ③ 引用数字段（历史迁移，若已执行可跳过）

```sql
-- 新增引用数字段
ALTER TABLE articles ADD COLUMN IF NOT EXISTS cited_by_count INTEGER DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS topic_tags JSONB DEFAULT '[]';

-- 引用数索引（排序用）
CREATE INDEX IF NOT EXISTS idx_articles_cited ON articles(cited_by_count DESC);
-- 主题标签索引（GIN，支持 @> 查询）
CREATE INDEX IF NOT EXISTS idx_articles_topic_tags ON articles USING GIN(topic_tags);
```

运行完成后，刷新浏览器即可看到网站内容。

---

## 清理历史无关数据（policy + research_practice）

如果你希望历史数据也符合最新规则（学前相关 OR AI+教育相关），请在 Supabase SQL Editor 运行：

- 文件：`scripts/cleanup_irrelevant_policy_practice.sql`

执行顺序建议：

1. 先执行文件里的第 1 段（预览删除数量）
2. 再执行第 2 段（抽样检查记录）
3. 最后执行第 3 段（事务删除），确认后 `COMMIT`，否则 `ROLLBACK`
