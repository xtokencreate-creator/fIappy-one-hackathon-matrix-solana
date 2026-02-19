alter table public.user_onboarding
  add column if not exists voucher_minted boolean not null default false,
  add column if not exists voucher_minted_at timestamptz null,
  add column if not exists voucher_mint_tx text null;

create or replace function public.mark_demo_voucher_minted(
  p_privy_user_id text,
  p_wallet_address text,
  p_voucher_mint_tx text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.user_onboarding%rowtype;
begin
  update public.user_onboarding
  set
    demo_play = true,
    voucher_minted = true,
    voucher_minted_at = coalesce(voucher_minted_at, now()),
    voucher_mint_tx = coalesce(p_voucher_mint_tx, voucher_mint_tx),
    updated_at = now()
  where privy_user_id = p_privy_user_id
    and wallet_address = p_wallet_address
    and voucher_minted = false;

  if not found then
    insert into public.user_onboarding (
      wallet_address,
      privy_user_id,
      demo_play,
      demo_completed_at,
      voucher_minted,
      voucher_minted_at,
      voucher_mint_tx,
      updated_at
    ) values (
      p_wallet_address,
      p_privy_user_id,
      true,
      now(),
      true,
      now(),
      p_voucher_mint_tx,
      now()
    )
    on conflict (wallet_address)
    do update
      set privy_user_id = excluded.privy_user_id,
          demo_play = true,
          demo_completed_at = coalesce(public.user_onboarding.demo_completed_at, excluded.demo_completed_at),
          voucher_minted = true,
          voucher_minted_at = coalesce(public.user_onboarding.voucher_minted_at, excluded.voucher_minted_at),
          voucher_mint_tx = coalesce(excluded.voucher_mint_tx, public.user_onboarding.voucher_mint_tx),
          updated_at = now()
    returning * into v_row;
  end if;

  return true;
end;
$$;

grant execute on function public.mark_demo_voucher_minted(text, text, text) to anon, authenticated, service_role;

create index if not exists idx_user_onboarding_voucher_minted
  on public.user_onboarding (voucher_minted);
