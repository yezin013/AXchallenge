-- 결선 심사 시스템 저장소 (Supabase 프로젝트: AXchallenge)
-- 서버 함수만 service_role(비밀) 키로 접근한다. 공개 키(anon)·로그인 사용자로는 읽기·쓰기 모두 불가.
-- 여러 번 실행해도 되도록 if not exists / or replace 로 작성.

create table if not exists public.fj_config (
  id smallint primary key default 1 check (id = 1),
  doc jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.fj_score (
  sid text not null, jid text not null, tid text not null,
  entry jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (sid, jid, tid)
);
create table if not exists public.fj_sig (
  sid text not null, jid text not null,
  sig jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (sid, jid)
);
create table if not exists public.fj_access (
  sid text not null, jid text not null,
  code text not null,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (sid, jid)
);

-- 접속 코드: 한 세션 안에서만 겹치지 않으면 된다 (같은 위원은 세션1·2에 같은 코드를 쓴다)
alter table public.fj_access drop constraint if exists fj_access_code_key;
create unique index if not exists fj_access_sid_code_key on public.fj_access (sid, code);
create index if not exists fj_access_code_idx on public.fj_access (code);

-- 변경 번호: 네 테이블 중 하나라도 바뀌면 1씩 오른다. 화면은 이 번호가 같으면 다시 받지 않는다.
create table if not exists public.fj_meta (
  id smallint primary key default 1 check (id = 1),
  ver bigint not null default 1
);
insert into public.fj_meta (id) values (1) on conflict (id) do nothing;

create or replace function public.fj_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.fj_meta set ver = ver + 1 where id = 1;
  return null;
end $$;

drop trigger if exists fj_touch on public.fj_config;
drop trigger if exists fj_touch on public.fj_score;
drop trigger if exists fj_touch on public.fj_sig;
drop trigger if exists fj_touch on public.fj_access;
create trigger fj_touch after insert or update or delete on public.fj_config for each statement execute function public.fj_touch();
create trigger fj_touch after insert or update or delete on public.fj_score for each statement execute function public.fj_touch();
create trigger fj_touch after insert or update or delete on public.fj_sig for each statement execute function public.fj_touch();
create trigger fj_touch after insert or update or delete on public.fj_access for each statement execute function public.fj_touch();

-- 한 번에 전체 상태 읽기. p_since 가 지금 변경 번호와 같으면 작은 응답만 돌려준다.
create or replace function public.fj_snapshot(p_since bigint default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v bigint;
begin
  select ver into v from public.fj_meta where id = 1;
  if p_since is not null and p_since = v then
    return jsonb_build_object('ver', v, 'unchanged', true);
  end if;
  return jsonb_build_object(
    'ver', v,
    'config', (select doc from public.fj_config where id = 1),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('sid', sid, 'jid', jid, 'tid', tid, 'entry', entry)) from public.fj_score), '[]'::jsonb),
    'sigs', coalesce((select jsonb_agg(jsonb_build_object('sid', sid, 'jid', jid, 'sig', sig)) from public.fj_sig), '[]'::jsonb),
    'access', coalesce((select jsonb_agg(jsonb_build_object('sid', sid, 'jid', jid, 'code', code, 'submittedAt', submitted_at)) from public.fj_access), '[]'::jsonb)
  );
end $$;

-- 백업 불러오기·초기화: 설정·점수·서명을 한 번에 바꾸고, 명단에서 빠진 위원의 접속 코드는 지운다.
create or replace function public.fj_replace(p_doc jsonb, p_scores jsonb, p_sigs jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.fj_score where true;
  delete from public.fj_sig where true;
  insert into public.fj_score (sid, jid, tid, entry)
    select x->>'sid', x->>'jid', x->>'tid', x->'entry' from jsonb_array_elements(p_scores) x;
  insert into public.fj_sig (sid, jid, sig)
    select x->>'sid', x->>'jid', x->'sig' from jsonb_array_elements(p_sigs) x;
  insert into public.fj_config (id, doc) values (1, p_doc)
    on conflict (id) do update set doc = excluded.doc, updated_at = now();
  delete from public.fj_access a
    where not exists (
      select 1 from jsonb_array_elements(coalesce(p_doc->'sessions'->a.sid->'judges', '[]'::jsonb)) j
      where j->>'id' = a.jid
    );
end $$;

-- 권한: 공개 키·로그인 사용자 차단, 서버(service_role)만 허용
alter table public.fj_config enable row level security;
alter table public.fj_score enable row level security;
alter table public.fj_sig enable row level security;
alter table public.fj_access enable row level security;
alter table public.fj_meta enable row level security;
revoke all on public.fj_config, public.fj_score, public.fj_sig, public.fj_access, public.fj_meta from anon, authenticated;
grant select, insert, update, delete on public.fj_config, public.fj_score, public.fj_sig, public.fj_access to service_role;
grant select, update on public.fj_meta to service_role;
revoke execute on function public.fj_snapshot(bigint), public.fj_replace(jsonb, jsonb, jsonb), public.fj_touch() from public, anon, authenticated;
grant execute on function public.fj_snapshot(bigint), public.fj_replace(jsonb, jsonb, jsonb) to service_role;
