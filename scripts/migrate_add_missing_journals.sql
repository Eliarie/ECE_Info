-- 为现有 sources 表补充缺失期刊（幂等：已存在则跳过）
INSERT INTO sources (name, url, type, module, region, config)
SELECT *
FROM (
  VALUES
    ('Child Development Perspectives', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Child Development Perspectives", "openalex_id": "S79535635"}'::jsonb),
    ('Journal of Early Childhood Literacy', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Journal of Early Childhood Literacy"}'::jsonb),
    ('Infant and Child Development', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Infant and Child Development", "openalex_id": "S90519018"}'::jsonb),
    ('Early Child Development and Care', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Early Child Development and Care", "openalex_id": "S145930022"}'::jsonb),
    ('Early Years', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Early Years", "openalex_id": "S132976789"}'::jsonb),
    ('Infant Behavior & Development', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Infant Behavior & Development", "openalex_id": "S67039580"}'::jsonb),
    ('European Early Childhood Education Research Journal', 'https://api.openalex.org/works', 'openalex', 'research_practice', 'international', '{"journal_name": "European Early Childhood Education Research Journal"}'::jsonb),
    ('学前教育研究', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'domestic', '{"journal_name": "学前教育研究", "openalex_id": "S4306547182"}'::jsonb),
    ('心理发展与教育', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'domestic', '{"journal_name": "心理发展与教育", "openalex_id": "S4306548924", "keyword_filter": "学前|幼儿|幼儿园|早期教育|托育|婴幼儿"}'::jsonb),
    ('教师教育研究', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'domestic', '{"journal_name": "教师教育研究", "openalex_id": "S4306549549", "keyword_filter": "学前|幼儿|幼儿园|早期教育|托育|婴幼儿"}'::jsonb),
    ('比较教育研究', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'domestic', '{"journal_name": "比较教育研究", "openalex_id": "S4306553084", "keyword_filter": "学前|幼儿|幼儿园|早期教育|托育|婴幼儿"}'::jsonb),
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

-- 原有《学前教育研究》使用的 CNKI RSS 已返回 404，改为 OpenAlex。
UPDATE sources
SET url = 'https://api.openalex.org/works',
    type = 'openalex',
    module = 'research_frontier',
    region = 'domestic',
    config = '{"journal_name": "学前教育研究", "openalex_id": "S4306547182"}'::jsonb
WHERE name = '学前教育研究';
