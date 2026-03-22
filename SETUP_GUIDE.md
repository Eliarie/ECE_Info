# 网站设置指南

## 当前状态
✅ 前端代码已更新（支持引用数排序、主题分类、收藏功能）
✅ 开发服务器已启动：http://localhost:3001

## 需要完成的步骤

### 1. 运行数据库迁移（添加新字段）

在 Supabase Dashboard 的 SQL Editor 中运行以下 SQL：

```sql
-- 新增引用数字段
ALTER TABLE articles ADD COLUMN IF NOT EXISTS cited_by_count INTEGER DEFAULT 0;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS topic_tags JSONB DEFAULT '[]';

-- 引用数索引（排序用）
CREATE INDEX IF NOT EXISTS idx_articles_cited ON articles(cited_by_count DESC);
-- 主题标签索引（GIN，支持 @> 查询）
CREATE INDEX IF NOT EXISTS idx_articles_topic_tags ON articles USING GIN(topic_tags);
```

### 2. 创建 .env 文件

在项目根目录创建 `.env` 文件，填写以下内容：

```bash
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_KEY=你的anon-key
DEEPSEEK_API_KEY=你的deepseek-api-key
OPENALEX_EMAIL=你的邮箱@example.com  # 可选
```

### 3. 运行回填脚本

在项目根目录运行以下命令：

```bash
# 为现有文章添加主题标签（使用 DeepSeek AI 分类）
python scripts/retag.py

# 回填 2026 年的引用数据（从 OpenAlex 获取引用数）
python scripts/backfill_2026.py
```

### 4. 刷新浏览器

打开 http://localhost:3001 查看效果

## 新功能说明

- **主题分类**：左侧边栏按主题分类显示文章
- **引用数排序**：文章按引用数从高到低排序
- **收藏功能**：点击文章右上角书签图标收藏
- **搜索过滤**：支持标题、摘要搜索和来源过滤
- **分页显示**：每页显示 8 篇文章

## 注意事项

- 回填脚本可能需要较长时间（取决于文章数量）
- DeepSeek API 会产生费用（用于 AI 主题分类）
- OpenAlex API 免费但有速率限制
