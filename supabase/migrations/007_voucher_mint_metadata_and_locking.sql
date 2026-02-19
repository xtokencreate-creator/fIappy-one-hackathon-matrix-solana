alter table public.user_onboarding
  add column if not exists voucher_mint_in_progress boolean not null default false,
  add column if not exists voucher_mint_address text null,
  add column if not exists voucher_tx_signature text null,
  add column if not exists voucher_metadata_uri text null;

create or replace function public.claim_demo_voucher_mint(
  p_privy_user_id text,
  p_wallet_address text
)
returns table(
  status text,
  voucher_minted boolean,
  voucher_mint_in_progress boolean,
  voucher_mint_address text,
  voucher_tx_signature text,
  voucher_metadata_uri text,
  voucher_minted_at timestamptz,
  demo_play boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_onboarding%rowtype;
begin
  insert into public.user_onboarding (
    wallet_address,
    privy_user_id,
    demo_play,
    demo_completed_at,
    updated_at
  ) values (
    p_wallet_address,
    p_privy_user_id,
    true,
    now(),
    now()
  )
  on conflict (wallet_address) do update
    set privy_user_id = excluded.privy_user_id,
        demo_play = true,
        demo_completed_at = coalesce(public.user_onboarding.demo_completed_at, excluded.demo_completed_at),
        updated_at = now();

  select *
  into v_row
  from public.user_onboarding
  where wallet_address = p_wallet_address
    and privy_user_id = p_privy_user_id
  for update;

  if not found then
    return query
    select
      'not_found'::text,
      false,
      false,
      null::text,
      null::text,
      null::text,
      null::timestamptz,
      false;
    return;
  end if;

  if coalesce(v_row.voucher_minted, false) then
    return query
    select
      'already_minted'::text,
      true,
      coalesce(v_row.voucher_mint_in_progress, false),
      v_row.voucher_mint_address,
      coalesce(v_row.voucher_tx_signature, v_row.voucher_mint_tx),
      v_row.voucher_metadata_uri,
      v_row.voucher_minted_at,
      coalesce(v_row.demo_play, false);
    return;
  end if;

  if coalesce(v_row.voucher_mint_in_progress, false) then
    return query
    select
      'in_progress'::text,
      false,
      true,
      v_row.voucher_mint_address,
      coalesce(v_row.voucher_tx_signature, v_row.voucher_mint_tx),
      v_row.voucher_metadata_uri,
      v_row.voucher_minted_at,
      coalesce(v_row.demo_play, false);
    return;
  end if;

  update public.user_onboarding
  set
    voucher_mint_in_progress = true,
    demo_play = true,
    demo_completed_at = coalesce(demo_completed_at, now()),
    updated_at = now()
  where wallet_address = p_wallet_address
    and privy_user_id = p_privy_user_id
  returning * into v_row;

  return query
  select
    'claimed'::text,
    false,
    true,
    v_row.voucher_mint_address,
    coalesce(v_row.voucher_tx_signature, v_row.voucher_mint_tx),
    v_row.voucher_metadata_uri,
    v_row.voucher_minted_at,
    coalesce(v_row.demo_play, false);
end;
$$;

create or replace function public.finalize_demo_voucher_mint(
  p_privy_user_id text,
  p_wallet_address text,
  p_voucher_mint_address text,
  p_voucher_tx_signature text,
  p_voucher_metadata_uri text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_onboarding
  set
    demo_play = true,
    demo_completed_at = coalesce(demo_completed_at, now()),
    voucher_minted = true,
    voucher_mint_in_progress = false,
    voucher_minted_at = coalesce(voucher_minted_at, now()),
    voucher_mint_address = coalesce(p_voucher_mint_address, voucher_mint_address),
    voucher_tx_signature = coalesce(p_voucher_tx_signature, voucher_tx_signature),
    voucher_mint_tx = coalesce(p_voucher_tx_signature, voucher_tx_signature, voucher_mint_tx),
    voucher_metadata_uri = coalesce(p_voucher_metadata_uri, voucher_metadata_uri),
    updated_at = now()
  where wallet_address = p_wallet_address
    and privy_user_id = p_privy_user_id;

  return found;
end;
$$;

create or replace function public.release_demo_voucher_mint_lock(
  p_privy_user_id text,
  p_wallet_address text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_onboarding
  set
    voucher_mint_in_progress = false,
    updated_at = now()
  where wallet_address = p_wallet_address
    and privy_user_id = p_privy_user_id
    and coalesce(voucher_minted, false) = false;
  return found;
end;
$$;

revoke all on function public.claim_demo_voucher_mint(text, text) from public;
grant execute on function public.claim_demo_voucher_mint(text, text) to service_role;

revoke all on function public.finalize_demo_voucher_mint(text, text, text, text, text) from public;
grant execute on function public.finalize_demo_voucher_mint(text, text, text, text, text) to service_role;

revoke all on function public.release_demo_voucher_mint_lock(text, text) from public;
grant execute on function public.release_demo_voucher_mint_lock(text, text) to service_role;

create index if not exists idx_user_onboarding_voucher_mint_in_progress
  on public.user_onboarding (voucher_mint_in_progress);
