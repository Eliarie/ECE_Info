alter table public.articles
    add column if not exists topic_version text;

create index if not exists idx_articles_topic_version
    on public.articles(topic_version);
