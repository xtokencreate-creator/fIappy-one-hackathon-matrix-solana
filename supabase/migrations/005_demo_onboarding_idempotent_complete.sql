create or replace function public.mark_demo_complete(
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
      demo_completed_at = coalesce(demo_completed_at, now()),
      demo_version = p_demo_version,
      updated_at = now()
  where wallet_address = p_wallet_address
    and privy_user_id = p_privy_user_id
    and demo_play = false;

  get diagnostics v_row_count = row_count;
  if v_row_count > 0 then
    return true;
  end if;

  select demo_play
  into v_done
  from public.user_onboarding
  where wallet_address = p_wallet_address
    and privy_user_id = p_privy_user_id
  limit 1;

  return coalesce(v_done, false);
end;
$fn$;

revoke all on function public.mark_demo_complete(text, text, text) from public;
grant execute on function public.mark_demo_complete(text, text, text) to service_role;
