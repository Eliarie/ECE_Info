# 部署指南

## 一、定时抓取周期

### 当前配置
- **频率**：每天 1 次
- **时间**：北京时间凌晨 2:00（UTC 18:00）
- **内容**：学术期刊 + 政策文件 + AI 翻译

### 推荐的抓取周期

**学术期刊（国际）：**
- **频率**：每天 1 次
- **原因**：学术期刊更新较慢，每天抓取足够
- **最佳时间**：凌晨 2:00（避开高峰期）

**政策文件（国内）：**
- **频率**：每天 1 次
- **原因**：政策更新不频繁，每天检查即可

**翻译任务：**
- **频率**：每天 1 次（跟随抓取任务）
- **原因**：新文章抓取后立即翻译

### 如何修改抓取周期

编辑 `.github/workflows/daily_fetch.yml` 文件：

```yaml
on:
  schedule:
    - cron: '0 18 * * *'  # 每天凌晨2点
    # 其他选项：
    # - cron: '0 */12 * * *'  # 每12小时一次
    # - cron: '0 18 * * 1-5'  # 仅工作日
```

**Cron 表达式说明：**
- `0 18 * * *` - 每天 UTC 18:00（北京时间凌晨 2:00）
- `0 */12 * * *` - 每 12 小时一次
- `0 18 * * 1-5` - 仅工作日（周一到周五）

---

## 二、网站部署方案

### 方案选择：Vercel（推荐）

**优势：**
- ✅ 免费托管 Next.js 应用
- ✅ 自动 HTTPS
- ✅ 全球 CDN 加速
- ✅ 自动部署（推送代码即部署）
- ✅ 支持自定义域名

### 部署步骤

#### 1. 准备工作

**需要的账号：**
- GitHub 账号（已有）
- Vercel 账号（免费注册：https://vercel.com）

**需要购买：**
- 域名（推荐平台）：
  - 国内：阿里云（aliyun.com）、腾讯云（dnspod.cn）
  - 国际：Namecheap（namecheap.com）、GoDaddy（godaddy.com）
- 价格：约 50-100 元/年（.com 域名）

#### 2. 部署到 Vercel

**步骤：**

1. **访问 Vercel**
   - 打开 https://vercel.com
   - 使用 GitHub 账号登录

2. **导入项目**
   - 点击 "Add New Project"
   - 选择你的 GitHub 仓库
   - 选择 `web` 目录作为根目录

3. **配置环境变量**
   在 Vercel 项目设置中添加：
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://dbcgapvkagvisqzamoyo.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=你的密钥
   ```

4. **部署**
   - 点击 "Deploy"
   - 等待 2-3 分钟
   - 获得免费域名：`your-project.vercel.app`

#### 3. 绑定自定义域名

**在域名提供商处：**
1. 登录域名管理后台
2. 添加 DNS 记录：
   ```
   类型: CNAME
   主机记录: www
   记录值: cname.vercel-dns.com
   ```

**在 Vercel 中：**
1. 进入项目设置 → Domains
2. 添加你的域名（如 `www.yourdomain.com`）
3. 等待 DNS 生效（5-30 分钟）

#### 4. 配置 GitHub Secrets

确保 GitHub Actions 能正常运行，需要在 GitHub 仓库设置中添加 Secrets：

1. 进入 GitHub 仓库
2. Settings → Secrets and variables → Actions
3. 添加以下 Secrets：
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `DEEPSEEK_API_KEY`
   - `OPENALEX_EMAIL`

---

## 三、成本估算

### 免费部分
- ✅ Vercel 托管：免费
- ✅ Supabase 数据库：免费（500MB 存储）
- ✅ GitHub Actions：免费（2000 分钟/月）

### 付费部分
- 💰 域名：50-100 元/年
- 💰 DeepSeek API：约 0.001 元/次翻译
  - 每天翻译 10 篇文章 ≈ 0.01 元/天 ≈ 3.6 元/月

**总成本：约 100 元/年**

---

## 四、部署后检查清单

- [ ] 网站可以正常访问
- [ ] 数据正常显示
- [ ] 主题分类功能正常
- [ ] 搜索功能正常
- [ ] 收藏功能正常
- [ ] GitHub Actions 定时任务正常运行
- [ ] 自定义域名已绑定（如果购买了域名）

---

## 五、维护建议

### 日常维护
- 每周检查一次 GitHub Actions 运行日志
- 每月检查一次 Supabase 存储使用情况
- 每月检查一次 DeepSeek API 使用量

### 数据备份
- Supabase 自动备份（免费版保留 7 天）
- 建议每月手动导出一次数据

### 监控
- 使用 Vercel Analytics（免费）监控访问量
- 使用 GitHub Actions 邮件通知监控抓取任务

---

## 六、常见问题

**Q: 网站访问速度慢？**
A: Vercel 提供全球 CDN，访问速度很快。如果慢，可能是 Supabase 数据库响应慢，可以考虑升级 Supabase 套餐。

**Q: GitHub Actions 抓取失败？**
A: 检查 Secrets 是否配置正确，查看 Actions 日志排查错误。

**Q: 域名备案？**
A: 如果使用国内服务器需要备案，但 Vercel 是国际服务器，不需要备案。

**Q: 如何更新网站？**
A: 直接推送代码到 GitHub，Vercel 会自动部署。
