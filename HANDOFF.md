# 交接进度

更新于 2026-10-23。**有 1 个待用户处理的步骤**（见下）。

## 进行中：兴趣速览在线上生成失败（2026-10-23）

用户手机上添加兴趣「ai 和学前教育」点「生成」，提示「生成失败，请稍后重试」。
- 原因：Vercel 主站没配 `DEEPSEEK_API_KEY`。`/api/generate/` 现在会返回 `reason`，线上实测返回 `missing_key`。
  本地预览（`web/.env.local` 有 key）同样请求 200、约 7 秒出结果；DeepSeek 余额 12.96 元，key 本身可用。
  之前的「端到端验证」都是在本地预览做的，线上从来没成功生成过。
- GitHub Pages 备用站（eliarie.github.io/ECE_Info）是静态站，本来就没有生成接口。现在在那里点「生成」会提示去主站生成，
  并且不再自动尝试补生成（已用本地静态构建验证）。
- [ ] **用户**：Vercel → ece-info 项目 → Settings → Environment Variables 添加 `DEEPSEEK_API_KEY`（值同根目录 `.env`），
  勾选 Production，然后 Deployments 里对最新一次点 Redeploy（环境变量要重新部署才生效）。
- [ ] 之后用 `curl -X POST -H 'Content-Type: application/json' -d '{"interest":"游戏"}' https://ece-info.vercel.app/api/generate/` 确认返回 overview_zh。
- 如果用户平时在大陆不翻墙用的是备用站，要让备用站也能生成，需要另做一个大陆能访问的接口（如 Supabase Edge Function），还没做。

## 刚完成：多设备同步改成扫码，并修好「删掉的收藏会回来」（2026-10-22）

用户反馈不想反复手动输入链接。改动：
- 首页和「全部文章」页顶部都有「多设备同步」，弹窗显示二维码（`web/src/components/SyncDeviceDialog.tsx`，`qrcode` 包本地生成）。
  手机扫一次就和电脑共用同一个同步码，之后自动同步。链接也指向首页。
- **修了一个同步 bug**：以前每次打开页面都把本机收藏并进云端，在一台设备取消的收藏会被另一台设备补回来。
  现在对齐过的设备以云端为准，没写成功的改动放在待补传队列里下次补（`web/src/lib/useBookmarks.ts`）。
- 手机扫码加入时，它原有的收藏和兴趣会并进同一组（兴趣部分在 `useInterestDigests.ts`）。
- 规则写在 `BOOKMARK_SYNC.md`。
- 已在本地预览用两个「设备」（localhost 和 127.0.0.1，各自一份本地存储）验证：A 收藏 2 篇 → B 自己收藏 1 篇后打开 A 的同步链接
  → 两边都是 3 篇 → B 取消一篇 → A 刷新后也消失、不会被补回 → 清空后数据库里两个测试同步码都为空。二维码用浏览器自带识别解码，与链接一致。
- 兴趣「扫码加入时合并」也实测过：B 自己的兴趣跟着进了共享组，A 刷新后两个兴趣都在；A 删除后 B 也清空。测试数据（含 B 旧同步码下的残留）已删。
- `npm audit`：跑了不破坏兼容的 `npm audit fix`（只改 lock 文件），14 个降到 9 个，生产构建和页面都正常。
  剩下 9 个（含 1 个 critical）都绑在 Next.js 14 和 Tailwind CSS 3 上：Next 已是 14.x 最新（14.2.35），
  critical 的两条是拒绝服务类（图片优化 remotePatterns、RSC 反序列化），只在 Next 16 修复，要大版本升级（Next 16 + React 19，Tailwind 4 也是大改）。
  GitHub Pages 备用站是纯静态，不受影响；Vercel 主站理论上受影响。升级是单独的一项工作，还没做。

## 上一项：每周任务自动补兴趣速览（已推送，未上线）

每周一的「每周研究速览」任务写完本周速览后，给每个订阅中的兴趣生成当周概览，让没打开网站的那几周也有存档。

- `scripts/generate_digest.py`：`generate_interest_digests()`，同一兴趣文本只调用一次模型；新增 `--dry-run` / `--interests-only` / `--week-start`。
- `.github/workflows/weekly_digest.yml`：手动运行可勾选 `dry_run`、`interests_only`；读取 Secret `INTEREST_DIGEST_JOB_TOKEN`。
- `supabase/migrations/20261019120000_add_interest_digest_job_rpcs.sql`：两个认任务口令的函数，库里只存口令 sha256。
- 兴趣概览的提示词在脚本和 `web/src/app/api/generate/route.ts` 各有一份，**改一边要同步另一边**（2026-10-21 核对过一致）。
- 用户（2026-10-21）：兴趣存档不必每周都有，能看到最近两三周就够。所以第 3、4、6、7 步是「锦上添花」，不急。

## 上线步骤（2026-10-22 全部完成）

详细说明见 `RUN_THIS_SQL.md` 的 ①、①-2、①-3。

1. [x] ① `get_saved_article_ids`（收藏跨设备读取）：2026-10-21 从网站报错提示确认库里已有这个函数
2. [x] ①-2（`20261019090000_add_user_interest_digests.sql`）：用户 2026-10-21 已执行。同日在本地预览做了端到端测试，全部通过：
   添加兴趣 → 生成并写入数据库（`save_interest_digest` 204，库里可查到）→ 清空浏览器后用 `?bookmark_sync=<同步码>` 打开，
   兴趣和概览从库里读回、不重新生成 → 页面上「删除」后库里清空。测试数据已删除。
3. [x] ①-3（`20261019120000_add_interest_digest_job_rpcs.sql`）：2026-10-22 才真正建进库里。之前两次「Success」其实都没建成
   （用户在 SQL Editor 跑检查，只查到 ①-2 的三个函数；原因不明，那个编辑器把中文表头显示成乱码，疑似中文注释粘贴出问题）。
   最后用去掉中文注释的纯英文版、末尾带检查语句跑成功，5 个函数 `anon_can_call` 全是 true。
   经验：**给 Supabase SQL Editor 的 SQL 尽量纯 ASCII，并在末尾加一条检查查询**，看结果表就知道成没成。
4. [x] GitHub Secret `INTEREST_DIGEST_JOB_TOKEN`：2026-10-21 已设置
5. [x] 推送 main 到 GitHub（2026-10-21，`75b3f6b`）
6. [x] 演练（run 39728862465）：「订阅中的兴趣 1 个：待生成 1 个兴趣」，日志只显示编号不显示兴趣原文
7. [x] 正式补齐（run 39728922429）：「生成 1 个兴趣，写入 1 个订阅，失败 0 个」，库里写入 412 字概览、[短语](编号) 链接正常。
   这两次用的是临时测试订阅（假同步码 + 「测试：游戏与语言发展」），验证后已删除，库里当前 0 个兴趣订阅。
   用户自己的兴趣要等下次在原浏览器打开首页时才会上传；之后每周一的任务会自动给它们补新一期。

## 未验证 / 已知情况

- 本机跑不了 `scripts/generate_digest.py`：系统 Python 没装 `openai`，`.venv` 是空目录；需要时用 GitHub Actions 手动运行。
- 本机 shell 设了代理 `127.0.0.1:7897`，代理没开时 `git push`、curl 都连不上；2026-10-21 推送时临时绕过了代理。
- 本地预览要生成兴趣速览，需要 `web/.env.local` 里有 `DEEPSEEK_API_KEY`（2026-10-21 已从根目录 `.env` 复制过去，该文件不进 git）。

## 最近完成

- 依赖安全修复（不破坏兼容的部分，14 → 9 个提示）（2026-10-22）
- 多设备同步改成扫码、修好删掉的收藏会回来（2026-10-22）
- 把根目录的 `IDEA.md`（早先的产品设想，写的是「电子与计算机工程」论文平台）按用户意思加入 git（2026-10-22）
- 每周任务自动补兴趣速览上线：①-3 建成，演练 + 正式补齐都通过（2026-10-22）
- 兴趣存档端到端测试通过、设置 GitHub Secret（2026-10-21）
- `221a108` 期数标签「本周」改为「最新一期」
- `4b522f8` 主速览可切换往期
- `8105dbf` 每周任务给所有订阅补兴趣速览
- `6ebb4c0` 页内跳转链接、多兴趣周报
- `a83960d` 在周报里直接收藏论文
- `6507edc` 按兴趣生成速览、扩大收录范围
