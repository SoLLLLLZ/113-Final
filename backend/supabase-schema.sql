-- Run this in your Supabase SQL editor to set up the schema

create table if not exists shards (
  id uuid primary key,
  response_text text not null,
  category text not null,
  image_prompt text,
  image_url text,
  grid_x integer default 0,
  grid_y integer default 0,
  seed integer,
  created_at timestamptz default now()
);

create table if not exists shard_levels (
  id uuid primary key default gen_random_uuid(),
  shard_id uuid references shards(id) on delete cascade,
  level integer not null,
  image_url text not null,
  prompt text,
  width integer,
  height integer,
  created_at timestamptz default now(),
  unique(shard_id, level)
);

create table if not exists edges (
  id uuid primary key default gen_random_uuid(),
  shard_a uuid references shards(id) on delete cascade,
  shard_b uuid references shards(id) on delete cascade,
  seam_label text,
  weight float default 0.5,
  created_at timestamptz default now()
);

create table if not exists processed_rows (
  row_index integer primary key
);

-- Enable realtime on shards table
alter publication supabase_realtime add table shards;

-- Storage bucket (run if not created via dashboard)
-- insert into storage.buckets (id, name, public) values ('shards', 'shards', true);
