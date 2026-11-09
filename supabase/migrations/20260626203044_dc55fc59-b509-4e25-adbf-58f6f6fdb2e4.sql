
REVOKE EXECUTE ON FUNCTION public.close_gl_period(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_gl_period(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_gl_period(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_gl_period(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, date, text) TO authenticated;
