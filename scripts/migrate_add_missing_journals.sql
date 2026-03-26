-- 为现有 sources 表补充缺失期刊（幂等：已存在则跳过）
INSERT INTO sources (name, url, type, module, region, config)
SELECT *
FROM (
  VALUES
    ('Journal of Early Childhood Literacy', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Journal of Early Childhood Literacy"}'::jsonb),
    ('Topics in Early Childhood Special Education', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Topics in Early Childhood Special Education"}'::jsonb),
    ('Australasian Journal of Early Childhood', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Australasian Journal of Early Childhood"}'::jsonb),
    ('Educational Researcher', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Educational Researcher", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'::jsonb),
    ('Teaching and Teacher Education', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Teaching and Teacher Education", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'::jsonb)
) AS v(name, url, type, module, region, config)
WHERE NOT EXISTS (
  SELECT 1
  FROM sources s
  WHERE s.name = v.name
);
