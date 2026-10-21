# 交接进度

更新于 2026-10-21。「主速览切换往期」已完成、验证并推送到 GitHub main。

## 刚完成：主速览可切换往期（已推送）

首页最上面的本周速览旁边多了一个期数下拉框，可以切回以前任何一周的速览（最多列最近 52 周），
切到往期后标签变成「往期速览」，并出现「回到本周」。改动在 `web/src/app/page.tsx` 和 `web/src/lib/i18n.ts`。

- `latestDigest`（最新一期）和 `digest`（正在看的一期）分开：兴趣速览始终基于最新一期生成，不受切换影响。
- 兴趣速览和下方正在看的是同一周时，文中链接页内跳到卡片；不是同一周时链接打开原文。
- 看过的期数缓存在页面里，来回切不重复请求。
- `weekly_digests` 没有任何清理逻辑，所有往期都保留（2026-10-21 库里有 7 期：9/9、9/10、9/14 起至 10/12）。
  其中 9/9、9/10 两期不是周一开始，像是早期手动测试生成的，下拉框里会一起列出。
- 已在本地预览验证：切到 10/5、9/28 两期，标题、篇数、概览、卡片都正确，概览里 11 个页内链接都能对上卡片；「回到本周」正常。

## 上一项：每周任务自动补兴趣速览（已推送，未上线）

每周一的「每周研究速览」任务写完本周速览后，给每个订阅中的兴趣生成当周概览，让没打开网站的那几周也有存档。

- `scripts/generate_digest.py`：`generate_interest_digests()`，同一兴趣文本只调用一次模型；新增 `--dry-run` / `--interests-only` / `--week-start`。
- `.github/workflows/weekly_digest.yml`：手动运行可勾选 `dry_run`、`interests_only`；读取 Secret `INTEREST_DIGEST_JOB_TOKEN`。
- `supabase/migrations/20261019120000_add_interest_digest_job_rpcs.sql`：两个认任务口令的函数，库里只存口令 sha256。
- 兴趣概览的提示词在脚本和 `web/src/app/api/generate/route.ts` 各有一份，**改一边要同步另一边**（2026-10-21 核对过一致）。
- 用户（2026-10-21）：兴趣存档不必每周都有，能看到最近两三周就够。所以第 3、4、6、7 步是「锦上添花」，不急。

## 需要用户手动做的（按顺序）

详细说明见 `RUN_THIS_SQL.md` 的 ①、①-2、①-3。

1. [x] ① `get_saved_article_ids`（收藏跨设备读取）：2026-10-21 从网站报错提示确认库里已有这个函数
2. [ ] **①-2**（`20261019090000_add_user_interest_digests.sql`）：**必做**。没执行前兴趣和兴趣往期只存在当前浏览器里，
   换设备、清缓存就没了；网站控制台一直报 `get_user_interests` 的 `PGRST202`（2026-10-21 仍在报）
3. [ ] ①-3（`20261019120000_add_interest_digest_job_rpcs.sql`）：可选，让每周任务自动补兴趣速览
4. [ ] 可选，配合第 3 步：把口令存进 GitHub Secret（仓库现有 Secret 里还没有 `INTEREST_DIGEST_JOB_TOKEN`）：
   `printf '%s' "$(grep '^INTEREST_DIGEST_JOB_TOKEN=' .env | cut -d= -f2-)" | gh secret set INTEREST_DIGEST_JOB_TOKEN --repo Eliarie/ECE_Info`
5. [x] 推送 main 到 GitHub（2026-10-21，`75b3f6b`）
6. [ ] 可选：Actions →「每周研究速览」→ Run workflow，勾选 `dry_run` + `interests_only` 演练；
   日志出现「订阅中的兴趣 N 个：待生成 …」即成功
7. [ ] 可选：只勾 `interests_only` 再跑一次，给最新一期补齐兴趣速览

## 未验证 / 已知情况

- 每周任务的新代码只做过编译检查，**没有对真实数据库跑过**。本机演练没跑成：系统 Python 没装 `openai`，`.venv` 是空目录。
- 本机 shell 设了代理 `127.0.0.1:7897`，代理没开时 `git push`、curl 都连不上；2026-10-21 推送时临时绕过了代理。
- 根目录的 `IDEA.md`（未跟踪）把 ECE 写成「电子与计算机工程」论文平台，和本项目（学前教育）不符，疑似放错位置，待确认是否删除。

## 最近完成

- 主速览可切换往期（2026-10-21）
- `8105dbf` 每周任务给所有订阅补兴趣速览
- `6ebb4c0` 页内跳转链接、多兴趣周报
- `a83960d` 在周报里直接收藏论文
- `6507edc` 按兴趣生成速览、扩大收录范围
