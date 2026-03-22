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
