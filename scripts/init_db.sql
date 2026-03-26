-- 学前教育前沿资讯平台 - 数据库初始化
-- 在 Supabase SQL Editor 中运行此脚本

-- 主内容表
CREATE TABLE IF NOT EXISTS articles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_original      TEXT NOT NULL,
    title_zh            TEXT,
    abstract_original   TEXT,
    abstract_zh         TEXT,
    authors             JSONB DEFAULT '[]',
    source_name         TEXT NOT NULL,
    source_url          TEXT NOT NULL UNIQUE,
    doi                 TEXT,
    module              TEXT NOT NULL CHECK (module IN ('policy', 'research_frontier', 'research_practice', 'forum')),
    region              TEXT NOT NULL CHECK (region IN ('domestic', 'international')),
    published_at        TIMESTAMPTZ,
    fetched_at          TIMESTAMPTZ DEFAULT NOW(),
    tags                JSONB DEFAULT '[]',
    is_translated       BOOLEAN DEFAULT FALSE
);

-- 索引：按模块+地区查询（前端主要查询方式）
CREATE INDEX IF NOT EXISTS idx_articles_module_region ON articles(module, region);
-- 索引：按发布时间排序
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
-- 索引：未翻译的文章（翻译任务用）
CREATE INDEX IF NOT EXISTS idx_articles_not_translated ON articles(is_translated) WHERE is_translated = FALSE;

-- 来源配置表（管理抓取来源）
CREATE TABLE IF NOT EXISTS sources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('openalex', 'rss', 'scraper', 'api')),
    module      TEXT NOT NULL,
    region      TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    last_fetched_at TIMESTAMPTZ,
    config      JSONB DEFAULT '{}'  -- 存储各来源特有配置（如OpenAlex期刊ID）
);

-- 插入来源配置
INSERT INTO sources (name, url, type, module, region, config) VALUES

-- 国际学术期刊（通过OpenAlex API抓取）
('Early Childhood Research Quarterly', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Early Childhood Research Quarterly"}'),
('Child Development', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Child Development"}'),
('Developmental Science', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Developmental Science"}'),
('Early Childhood Education Journal', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Early Childhood Education Journal"}'),
('International Journal of Early Childhood', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "International Journal of Early Childhood"}'),
('Journal of Research in Childhood Education', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Journal of Research in Childhood Education"}'),
('Early Education and Development', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Early Education and Development"}'),
('Young Children', 'https://api.openalex.org/works', 'openalex', 'research_practice', 'international', '{"journal_name": "Young Children"}'),
('Computers & Education', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Computers & Education", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'),
('British Journal of Educational Technology', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "British Journal of Educational Technology", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'),
('Journal of Computer Assisted Learning', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Journal of Computer Assisted Learning", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'),
('Frontiers in Education', 'https://www.frontiersin.org/journals/education/rss', 'rss', 'research_frontier', 'international', '{"keyword_filter": "early childhood|preschool|kindergarten|young children"}'),
('Journal of Children and Media', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Journal of Children and Media"}'),
('Journal of Early Childhood Literacy', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Journal of Early Childhood Literacy"}'),
('Topics in Early Childhood Special Education', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Topics in Early Childhood Special Education"}'),
('Australasian Journal of Early Childhood', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Australasian Journal of Early Childhood"}'),
('Educational Researcher', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Educational Researcher", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'),
('Teaching and Teacher Education', 'https://api.openalex.org/works', 'openalex', 'research_frontier', 'international', '{"journal_name": "Teaching and Teacher Education", "keyword_filter": "early childhood|preschool|kindergarten|young children"}'),

-- 国内学术期刊（知网RSS）
('学前教育研究', 'https://www.cnki.net/kns/rss.aspx?journal=XQJY', 'rss', 'research_frontier', 'domestic', '{}'),
('幼儿教育', 'https://www.cnki.net/kns/rss.aspx?journal=YEJY', 'rss', 'research_frontier', 'domestic', '{}'),
('教育研究', 'https://www.cnki.net/kns/rss.aspx?journal=JYYJ', 'rss', 'research_frontier', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园|早期教育"}'),
('全球教育展望', 'https://www.cnki.net/kns/rss.aspx?journal=WGJN', 'rss', 'research_frontier', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园|早期教育"}'),
('电化教育研究', 'https://www.cnki.net/kns/rss.aspx?journal=DHJY', 'rss', 'research_frontier', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园|早期教育"}'),
('中国电化教育', 'https://www.cnki.net/kns/rss.aspx?journal=ZDDJ', 'rss', 'research_frontier', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园|早期教育"}'),
('开放教育研究', 'https://www.cnki.net/kns/rss.aspx?journal=KFJY', 'rss', 'research_frontier', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园|早期教育"}'),

-- 国内政策
('教育部', 'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/', 'scraper', 'policy', 'domestic', '{"selector": ".news-list li"}'),
('国务院政策库', 'https://sousuo.www.gov.cn/zcwjk/policyDocumentLibrary', 'scraper', 'policy', 'domestic', '{"keyword": "学前教育 幼儿园"}'),
('上海市教育局', 'https://edu.sh.gov.cn/cms-api/api/tool/homepage', 'api', 'policy', 'domestic', '{}'),
('北京市教育委员会', 'https://jw.beijing.gov.cn/xxgk/zxxxgk/', 'scraper', 'policy', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园"}'),
('深圳市教育局', 'https://www.szedu.net/xxgk/zxxxgk/', 'scraper', 'policy', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园"}'),
('杭州市教育局', 'https://edu.hangzhou.gov.cn/art/2024/1/1/art_1229284_1.html', 'scraper', 'policy', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园"}'),
('广州市教育局', 'https://www.gzedu.gov.cn/xxgk/zxxxgk/', 'scraper', 'policy', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园"}'),
('成都市教育局', 'https://edu.chengdu.gov.cn/cdjyxxgk/c131823/list.shtml', 'scraper', 'policy', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园"}'),
('苏州市教育局', 'https://jyj.suzhou.gov.cn/szsjyj/xxgk/list.shtml', 'scraper', 'policy', 'domestic', '{"keyword_filter": "学前|幼儿|幼儿园"}'),

-- 国际政策/机构
('UNESCO ECE', 'https://www.unesco.org/en/early-childhood-education', 'scraper', 'policy', 'international', '{}'),
('OECD ECEC', 'https://www.oecd.org/en/topics/early-childhood-education-and-care.html', 'scraper', 'policy', 'international', '{}'),
('UNICEF ECD', 'https://www.unicef.org/early-childhood-development', 'scraper', 'policy', 'international', '{}'),
('World Bank ECD', 'https://www.worldbank.org/en/topic/earlychildhooddevelopment', 'scraper', 'policy', 'international', '{}'),
('OMEP', 'https://omep.org/wp-json/wp/v2/posts', 'api', 'policy', 'international', '{}'),

-- 实践研究机构
('Harvard Center on the Developing Child', 'https://developingchild.harvard.edu/resources/', 'scraper', 'research_practice', 'international', '{}'),
('Zero to Three', 'https://www.zerotothree.org/resources/', 'scraper', 'research_practice', 'international', '{}'),
('Brookings ECE', 'https://www.brookings.edu/topic/early-childhood-education/', 'scraper', 'research_practice', 'international', '{}'),
('NAEYC', 'https://www.naeyc.org/resources', 'scraper', 'research_practice', 'international', '{}'),
('RAND ECE', 'https://www.rand.org/topics/early-childhood-education.html', 'scraper', 'research_practice', 'international', '{}'),
('中国儿童中心', 'http://www.ccc.org.cn/', 'scraper', 'research_practice', 'domestic', '{}'),
('中国学前教育研究会', 'http://www.cnsece.com/', 'scraper', 'research_practice', 'domestic', '{}'),

-- 论坛/会议动态
('NAEYC Annual Conference', 'https://www.naeyc.org/events', 'scraper', 'forum', 'international', '{}'),
('OMEP World Congress', 'https://www.omep.org/events/', 'scraper', 'forum', 'international', '{}'),
('EECERA', 'https://www.eecera.org/events/', 'scraper', 'forum', 'international', '{}'),
('SRCD', 'https://www.srcd.org/events', 'scraper', 'forum', 'international', '{}')

ON CONFLICT DO NOTHING;
