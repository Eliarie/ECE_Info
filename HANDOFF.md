# 交接进度

更新于 2026-10-21，代码提交 `8105dbf`，已推送到 GitHub main。

## 当前在做

**每周任务自动补兴趣速览。** 每周一的「每周研究速览」任务写完本周速览后，给每个订阅中的兴趣生成当周概览，
这样用户没打开网站的那几周，兴趣存档也不会空着。代码已完成并提交，**还没上线**。

改动集中在：

- `scripts/generate_digest.py`：`generate_interest_digests()`，同一兴趣文本只调用一次模型，写给所有订阅它的同步码；
  新增 `--dry-run` / `--interests-only` / `--week-start`。
- `.github/workflows/weekly_digest.yml`：手动运行可勾选 `dry_run`、`interests_only`；读取 Secret `INTEREST_DIGEST_JOB_TOKEN`。
- `supabase/migrations/20261019120000_add_interest_digest_job_rpcs.sql`：两个认任务口令的函数，库里只存口令 sha256。
- 兴趣概览的提示词在脚本和 `web/src/app/api/generate/route.ts` 各有一份，**改一边要同步另一边**（2026-10-21 核对过一致）。

## 上线还差的步骤（按顺序）

详细说明见 `RUN_THIS_SQL.md` 的 ①、①-2、①-3。

1. [ ] 在 Supabase SQL Editor 执行 ①（`get_saved_article_ids`，收藏跨设备读取）
2. [ ] 执行 ①-2（`20261019090000_add_user_interest_digests.sql`，兴趣与兴趣速览存档）
3. [ ] 执行 ①-3（`20261019120000_add_interest_digest_job_rpcs.sql`）
4. [ ] 把口令存进 GitHub Secret（仓库现有 Secret 里还没有 `INTEREST_DIGEST_JOB_TOKEN`）：
   `printf '%s' "$(grep '^INTEREST_DIGEST_JOB_TOKEN=' .env | cut -d= -f2-)" | gh secret set INTEREST_DIGEST_JOB_TOKEN --repo Eliarie/ECE_Info`
5. [x] 推送 main 到 GitHub（2026-10-21）
6. [ ] Actions →「每周研究速览」→ Run workflow，勾选 `dry_run` + `interests_only` 演练；
   日志出现「订阅中的兴趣 N 个：待生成 …」即成功
7. [ ] 只勾 `interests_only` 再跑一次，给最新一期补齐兴趣速览

## 未验证 / 已知情况

- 新代码只做过编译检查，**没有对真实数据库跑过**。本机演练没跑成：系统 Python 没装 `openai`，`.venv` 是空目录；
  本机网络走 `127.0.0.1:7897` 代理，代理没开时连不上 Supabase。要在本机演练需先 `pip install -r requirements.txt` 并打开代理。
- 1–3 步的 SQL 是否已在库里执行过，2026-10-21 无法确认（同上，连不上库）。若已执行，SQL 可重复运行，不会出问题。
- 根目录的 `IDEA.md`（未跟踪）把 ECE 写成「电子与计算机工程」论文平台，和本项目（学前教育）不符，疑似放错位置，未提交，待确认是否删除。

## 最近完成

- `8105dbf` 每周任务给所有订阅补兴趣速览
- `6ebb4c0` 页内跳转链接、多兴趣周报
- `a83960d` 在周报里直接收藏论文
- `6507edc` 按兴趣生成速览、扩大收录范围
