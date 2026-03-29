# 数据库迁移 SQL

请在 Supabase Dashboard 的 SQL Editor 中运行以下 SQL：

1. 打开 https://supabase.com/dashboard/project/dbcgapvkagvisqzamoyo
2. 点击左侧菜单的 "SQL Editor"
3. 点击 "New query"
4. 复制粘贴以下 SQL 并点击 "Run"

```sql
-- 新增引用数字段
ALTER TABLE articles ADD COLUMN IF NOT EXISTS cited_by_count INTEGER DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS topic_tags JSONB DEFAULT '[]';

-- 引用数索引（排序用）
CREATE INDEX IF NOT EXISTS idx_articles_cited ON articles(cited_by_count DESC);
-- 主题标签索引（GIN，支持 @> 查询）
CREATE INDEX IF NOT EXISTS idx_articles_topic_tags ON articles USING GIN(topic_tags);
```

运行完成后，刷新浏览器访问 http://localhost:3001 即可看到网站内容。

---

## 清理历史无关数据（policy + research_practice）

如果你希望历史数据也符合最新规则（学前相关 OR AI+教育相关），请在 Supabase SQL Editor 运行：

- 文件：`scripts/cleanup_irrelevant_policy_practice.sql`

执行顺序建议：

1. 先执行文件里的第 1 段（预览删除数量）
2. 再执行第 2 段（抽样检查记录）
3. 最后执行第 3 段（事务删除），确认后 `COMMIT`，否则 `ROLLBACK`
