-- Optional appearance and EPA fuel economy. Existing rows stay null until filled in.
alter table public.vehicles add column if not exists exterior_color text;
alter table public.vehicles add column if not exists interior text;
alter table public.vehicles add column if not exists mpg_city integer;
alter table public.vehicles add column if not exists mpg_highway integer;
