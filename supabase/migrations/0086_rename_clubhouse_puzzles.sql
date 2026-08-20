-- The daily puzzle game was renamed "Teammates" -> "Clubhouse". Rename its
-- storage table to match (data is preserved; puzzles are regenerable anyway).

alter table public.teammates_puzzles rename to clubhouse_puzzles;

notify pgrst, 'reload schema';
