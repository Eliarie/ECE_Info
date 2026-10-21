# 数据库迁移 SQL

请在 Supabase Dashboard 的 SQL Editor 中运行以下 SQL：

1. 打开 https://supabase.com/dashboard/project/dbcgapvkagvisqzamoyo
2. 点击左侧菜单的 "SQL Editor"
3. 点击 "New query"
4. 复制粘贴以下 SQL 并点击 "Run"

---

## ① 跨设备收藏读取函数（已执行，2026-10-21 确认库里已有）

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

## ①-2 兴趣速览存档（待执行，不执行则兴趣只保存在本机浏览器）

首页可以订阅多个兴趣，每个兴趣按周存档生成的速览，并与收藏共用同一个同步码跨设备同步。
新建 `user_interests`、`user_interest_digests` 两张表和
`get_user_interests` / `save_interest_digest` / `remove_user_interest` 三个函数。

打开 `supabase/migrations/20261019090000_add_user_interest_digests.sql`，全选复制，粘贴到 SQL Editor 运行即可（可重复执行）。

两张表不开放直接读写，只能经这三个函数按同步码访问；每个同步码最多 30 个兴趣。
执行前已在本机生成的兴趣速览，会在下次打开网站时自动补传上去。
执行后刷新网站，控制台不再报 `get_user_interests` 的 `PGRST202` 即为成功。

---

## ①-3 每周任务自动补兴趣速览（待执行，需先执行 ①-2）

不执行时，兴趣速览只在某台设备打开首页时才生成，没打开的那几周存档会空着。
执行后，每周一的「每周研究速览」任务写完本周速览，会顺带给每个订阅中的兴趣生成本周概览：
同一个兴趣文本只调用一次模型，再写给所有订阅它的同步码；已经有本周概览的订阅跳过，单个兴趣失败不影响其他。

GitHub Actions 用的是 anon key，碰不到兴趣表，所以新加两个只认任务口令的函数
`list_interest_digest_targets` / `save_interest_digest_for_devices`（和旧文献放流的口令做法一样，库里只存口令的 sha256）。
口令明文已生成在本机 `.env` 的 `INTEREST_DIGEST_JOB_TOKEN`（`.env` 不进 git）。

1. 打开 `supabase/migrations/20261019120000_add_interest_digest_job_rpcs.sql`，全选复制，粘贴到 SQL Editor 运行（可重复执行）。
2. 把口令存进 GitHub Secret（在仓库根目录运行，不会打印口令）：

   ```bash
   printf '%s' "$(grep '^INTEREST_DIGEST_JOB_TOKEN=' .env | cut -d= -f2-)" | gh secret set INTEREST_DIGEST_JOB_TOKEN --repo Eliarie/ECE_Info
   ```

3. 演练确认（只读，不调用模型、不写库）：GitHub → Actions →「每周研究速览」→ Run workflow，勾选 `dry_run` 和 `interests_only`。
   日志出现「订阅中的兴趣 N 个：待生成 …」即为成功；仓库公开，日志里只显示编号和数量，不显示兴趣原文和同步码。
   本机也可以演练（会显示兴趣原文）：`set -a && source .env && set +a && python3 scripts/generate_digest.py --interests-only --dry-run`

想立刻给最新一期补齐：Run workflow 只勾选 `interests_only`。
如果口令丢了或想换：重新生成一个，把迁移文件里两处 sha256 换成新口令的哈希，重跑第 1、2 步。

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
