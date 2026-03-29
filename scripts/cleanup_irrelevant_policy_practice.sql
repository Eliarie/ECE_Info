-- 清理历史无关数据（仅 policy / research_practice）
-- 规则与 scripts/fetch_policy.py 保持一致：
-- 保留：学前教育相关 OR (AI相关 AND 教育相关)
-- 作用范围：国内+国际，module in ('policy', 'research_practice')

-- 1) 先预览将被删除的数据量（安全检查）
WITH rules AS (
  SELECT
    E'(学前|幼儿|托育|早教|幼教|儿童早期|婴幼儿|幼儿园|保教|early childhood|preschool|pre-school|kindergarten|nursery|daycare|child care|ecec|early years|infant|toddler)' AS early_pat,
    E'((^|[^a-zA-Z])AI([^a-zA-Z]|$)|人工智能|智能化|大模型|生成式|AIGC|machine learning|deep learning|LLM|GPT)' AS ai_pat,
    E'(教育|教学|课堂|课程|学校|教师|学生|教研|育人|education|teaching|learning|curriculum|school|teacher|student)' AS edu_pat
)
SELECT
  module,
  region,
  COUNT(*) AS rows_to_delete
FROM articles a
CROSS JOIN rules r
WHERE a.module IN ('policy', 'research_practice')
  AND NOT (
    CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.early_pat
    OR (
      CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.ai_pat
      AND CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.edu_pat
    )
  )
GROUP BY module, region
ORDER BY module, region;

-- 2) 抽样查看将被删除的记录（建议先执行）
WITH rules AS (
  SELECT
    E'(学前|幼儿|托育|早教|幼教|儿童早期|婴幼儿|幼儿园|保教|early childhood|preschool|pre-school|kindergarten|nursery|daycare|child care|ecec|early years|infant|toddler)' AS early_pat,
    E'((^|[^a-zA-Z])AI([^a-zA-Z]|$)|人工智能|智能化|大模型|生成式|AIGC|machine learning|deep learning|LLM|GPT)' AS ai_pat,
    E'(教育|教学|课堂|课程|学校|教师|学生|教研|育人|education|teaching|learning|curriculum|school|teacher|student)' AS edu_pat
)
SELECT
  id,
  module,
  region,
  source_name,
  title_original,
  source_url,
  published_at
FROM articles a
CROSS JOIN rules r
WHERE a.module IN ('policy', 'research_practice')
  AND NOT (
    CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.early_pat
    OR (
      CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.ai_pat
      AND CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.edu_pat
    )
  )
ORDER BY fetched_at DESC NULLS LAST
LIMIT 100;

-- 3) 确认无误后执行删除
-- 建议在事务里执行，先看 RETURNING，再 COMMIT。
BEGIN;

WITH rules AS (
  SELECT
    E'(学前|幼儿|托育|早教|幼教|儿童早期|婴幼儿|幼儿园|保教|early childhood|preschool|pre-school|kindergarten|nursery|daycare|child care|ecec|early years|infant|toddler)' AS early_pat,
    E'((^|[^a-zA-Z])AI([^a-zA-Z]|$)|人工智能|智能化|大模型|生成式|AIGC|machine learning|deep learning|LLM|GPT)' AS ai_pat,
    E'(教育|教学|课堂|课程|学校|教师|学生|教研|育人|education|teaching|learning|curriculum|school|teacher|student)' AS edu_pat
)
DELETE FROM articles a
USING rules r
WHERE a.module IN ('policy', 'research_practice')
  AND NOT (
    CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.early_pat
    OR (
      CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.ai_pat
      AND CONCAT_WS(' ', a.title_original, a.title_zh, a.abstract_original, a.abstract_zh) ~* r.edu_pat
    )
  )
RETURNING a.id, a.module, a.region, a.source_name, a.title_original;

-- 核对 RETURNING 结果后：
-- COMMIT;
-- 如果不想删除：
-- ROLLBACK;
