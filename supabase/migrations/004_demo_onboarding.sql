create table if not exists public.user_onboarding (
  wallet_address text primary key,
  privy_user_id text not null unique,
  demo_play boolean not null default false,
  demo_started_at timestamptz null,
  demo_completed_at timestamptz null,
  demo_version text not null default 'v1',
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_onboarding'
      and policyname = 'user_onboarding_select_own'
  ) then
    create policy user_onboarding_select_own
      on public.user_onboarding
      for select
      using (
        (auth.jwt() ->> 'sub') is not null
        and (auth.jwt() ->> 'sub') = privy_user_id
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_proc
    where proname = 'mark_demo_complete'
      and pg_function_is_visible(oid)
  ) then
    create function public.mark_demo_complete(
      p_privy_user_id text,
      p_wallet_address text,
      p_demo_version text default 'v1'
    )
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_row_count bigint;
      v_done boolean;
    begin
      update public.user_onboarding
      set demo_started_at = coalesce(demo_started_at, now()),
          updated_at = now()
      where wallet_address = p_wallet_address
        and privy_user_id = p_privy_user_id;

      if not found then
        insert into public.user_onboarding (
          wallet_address,
          privy_user_id,
          demo_play,
          demo_started_at,
          demo_version,
          updated_at
        ) values (
          p_wallet_address,
          p_privy_user_id,
          false,
          now(),
          p_demo_version,
          now()
        )
        on conflict (wallet_address) do update
        set privy_user_id = excluded.privy_user_id,
            demo_started_at = coalesce(public.user_onboarding.demo_started_at, excluded.demo_started_at),
            updated_at = now();
      end if;

      update public.user_onboarding
      set demo_play = true,
          demo_completed_at = now(),
          demo_version = p_demo_version,
          updated_at = now()
      where wallet_address = p_wallet_address
        and privy_user_id = p_privy_user_id
        and demo_play = false;

      get diagnostics v_row_count = row_count;
      v_done := v_row_count > 0;
      return v_done;
    end;
    $fn$;
  end if;
end $$;

revoke all on function public.mark_demo_complete(text, text, text) from public;
grant execute on function public.mark_demo_complete(text, text, text) to service_role;

create index if not exists idx_user_onboarding_demo_play on public.user_onboarding (demo_play);
create index if not exists idx_user_onboarding_updated_at on public.user_onboarding (updated_at desc);
