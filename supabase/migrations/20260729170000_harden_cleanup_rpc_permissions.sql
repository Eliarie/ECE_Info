revoke all on function public.prune_unbookmarked_articles(integer, integer)
    from public, anon, authenticated;

grant execute on function public.prune_unbookmarked_articles(integer, integer)
    to service_role;
