-- 취향 밸런스 게임 테이블 스키마 (rooms, answers) + Supabase Auth 및 RLS 적용

-- 1. rooms 테이블 (방 정보)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_code varchar(4) not null unique,                                         -- 방 코드 (4자리)
  status text not null default '대기',                                           -- 상태 ('대기' / '진행중')
  current_question integer not null default 1,                                  -- 현재 질문 번호
  host_user_id uuid references auth.users(id) on delete set null default auth.uid(),  -- 방 생성자 (Supabase Auth User ID)
  guest_user_id uuid references auth.users(id) on delete set null,              -- 방 참가자 (Supabase Auth User ID)
  created_at timestamptz not null default now()                                 -- 생성일
);

-- 2. answers 테이블 (참가자 답변 기록)
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  room_code varchar(4) not null references public.rooms(room_code) on delete cascade, -- 방 코드 (4자리)
  player text not null check (player in ('player1', 'player2')),                      -- 참가자 ('player1' | 'player2')
  question_id integer not null,                                                       -- 질문 번호
  answer text not null,                                                               -- 선택한 답변
  user_id uuid references auth.users(id) on delete set null default auth.uid(),       -- 답변 작성자 (Supabase Auth User ID)
  created_at timestamptz not null default now(),                                      -- 생성일
  unique (room_code, player, question_id)
);

-- 조회 성능 향상을 위한 인덱스
create index if not exists idx_rooms_room_code on public.rooms (room_code);
create index if not exists idx_answers_room_code on public.answers (room_code);
create index if not exists idx_answers_room_question on public.answers (room_code, question_id);

-- 3. RLS(Row Level Security) 활성화 및 인증 사용자(authenticated) 보안 정책 적용
alter table public.rooms enable row level security;
alter table public.answers enable row level security;

drop policy if exists "Authenticated users can select rooms" on public.rooms;
create policy "Authenticated users can select rooms"
  on public.rooms for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can insert rooms" on public.rooms;
create policy "Authenticated users can insert rooms"
  on public.rooms for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users can update rooms" on public.rooms;
create policy "Authenticated users can update rooms"
  on public.rooms for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users can delete rooms" on public.rooms;
create policy "Authenticated users can delete rooms"
  on public.rooms for delete
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can select answers" on public.answers;
create policy "Authenticated users can select answers"
  on public.answers for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can insert answers" on public.answers;
create policy "Authenticated users can insert answers"
  on public.answers for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users can update answers" on public.answers;
create policy "Authenticated users can update answers"
  on public.answers for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users can delete answers" on public.answers;
create policy "Authenticated users can delete answers"
  on public.answers for delete
  to authenticated
  using (auth.uid() is not null);

-- 4. Realtime 기능 활성화 (REPLICA IDENTITY FULL 및 supabase_realtime Publication 등록)
alter table public.rooms replica identity full;
alter table public.answers replica identity full;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.answers;

-- 5. 빈 방 자동 정리 함수 및 트리거 (생성 후 10분 동안 아무도 접속하지 않은 대기 방 자동 삭제)
create or replace function public.cleanup_expired_waiting_rooms()
returns trigger
language plpgsql
as $$
begin
  delete from public.rooms
  where status in ('대기', 'waiting')
    and created_at < now() - interval '10 minutes';
  return new;
end;
$$;

drop trigger if exists trg_cleanup_expired_waiting_rooms on public.rooms;
create trigger trg_cleanup_expired_waiting_rooms
  after insert or update on public.rooms
  for each statement
  execute function public.cleanup_expired_waiting_rooms();
