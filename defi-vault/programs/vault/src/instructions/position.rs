//! Управление позицией в пуле Raydium CLMM: открыть, собрать комиссии,
//! уменьшить ликвидность, закрыть, проверить выход цены из диапазона.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Approve, Revoke, Token, TokenAccount};
use anchor_spl::token_2022::Token2022;

use crate::error::VaultError;
use crate::raydium::{
    close_position_data, decrease_liquidity_data, invoke_clmm, open_position_data, pool_tick,
    OpenPositionArgs, CLMM_PROGRAM_ID, MEMO_PROGRAM_ID,
};
use crate::state::*;

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, VaultConfig>>,
    /// Платит за аккаунты позиции и переводит токены как delegate vault.
    /// Без данных, поэтому System Program разрешает ему создавать аккаунты.
    #[account(mut, seeds = [LP_SIGNER_SEED, vault.key().as_ref()], bump)]
    pub lp_signer: SystemAccount<'info>,
    #[account(mut)]
    pub position_nft_mint: Signer<'info>,
    /// CHECK: создаётся программой Raydium.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: только пул, к которому подключён vault.
    #[account(mut, address = vault.pool @ VaultError::InvalidPool)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,
    /// CHECK: создаётся программой Raydium.
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault.is_own_account(&token_account_0.key()) @ VaultError::NotVaultAccount
    )]
    pub token_account_0: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = vault.is_own_account(&token_account_1.key()) @ VaultError::NotVaultAccount
    )]
    pub token_account_1: Box<Account<'info, TokenAccount>>,
    /// CHECK: хранилище пула, проверяется программой Raydium.
    #[account(mut)]
    pub pool_vault_0: UncheckedAccount<'info>,
    /// CHECK: хранилище пула, проверяется программой Raydium.
    #[account(mut)]
    pub pool_vault_1: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: проверяется программой Raydium.
    pub mint_0: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub mint_1: UncheckedAccount<'info>,
    /// CHECK: адрес фиксирован.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenPositionParams {
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub tick_array_lower_start: i32,
    pub tick_array_upper_start: i32,
    pub liquidity: u128,
    pub amount_0_max: u64,
    pub amount_1_max: u64,
    /// Сколько lamports управляющий даёт на rent новых аккаунтов. Остаток вернётся.
    pub rent_funding: u64,
}

pub fn handle_open_position<'info>(
    ctx: Context<'info, OpenPosition<'info>>,
    params: OpenPositionParams,
) -> Result<()> {
    require!(
        !ctx.accounts.vault.has_position(),
        VaultError::PositionAlreadyOpen
    );
    require!(params.liquidity > 0, VaultError::ZeroAmount);

    let a = &ctx.accounts;
    let asset_mint_key = a.vault.asset_mint;
    let vault_bump = [a.vault.bump];
    let vault_signer: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint_key.as_ref(), &vault_bump]];
    let vault_key = a.vault.key();
    let lp_bump = [ctx.bumps.lp_signer];
    let lp_signer_seeds: &[&[&[u8]]] = &[&[LP_SIGNER_SEED, vault_key.as_ref(), &lp_bump]];

    // Raydium берёт токены у плательщика, поэтому lp_signer получает право
    // потратить ровно max-суммы. После открытия право отзывается.
    for (account, amount) in [
        (&a.token_account_0, params.amount_0_max),
        (&a.token_account_1, params.amount_1_max),
    ] {
        token::approve(
            CpiContext::new_with_signer(
                a.token_program.key(),
                Approve {
                    to: account.to_account_info(),
                    delegate: a.lp_signer.to_account_info(),
                    authority: a.vault.to_account_info(),
                },
                vault_signer,
            ),
            amount,
        )?;
    }

    system_program::transfer(
        CpiContext::new(
            a.system_program.key(),
            system_program::Transfer {
                from: a.authority.to_account_info(),
                to: a.lp_signer.to_account_info(),
            },
        ),
        params.rent_funding,
    )?;

    let mut metas = vec![
        AccountMeta::new(a.lp_signer.key(), true),
        AccountMeta::new_readonly(vault_key, false),
        AccountMeta::new(a.position_nft_mint.key(), true),
        AccountMeta::new(a.position_nft_account.key(), false),
        AccountMeta::new(a.pool_state.key(), false),
        AccountMeta::new_readonly(a.protocol_position.key(), false),
        AccountMeta::new(a.tick_array_lower.key(), false),
        AccountMeta::new(a.tick_array_upper.key(), false),
        AccountMeta::new(a.personal_position.key(), false),
        AccountMeta::new(a.token_account_0.key(), false),
        AccountMeta::new(a.token_account_1.key(), false),
        AccountMeta::new(a.pool_vault_0.key(), false),
        AccountMeta::new(a.pool_vault_1.key(), false),
        AccountMeta::new_readonly(a.rent.key(), false),
        AccountMeta::new_readonly(a.system_program.key(), false),
        AccountMeta::new_readonly(a.token_program.key(), false),
        AccountMeta::new_readonly(a.associated_token_program.key(), false),
        AccountMeta::new_readonly(a.token_program_2022.key(), false),
        AccountMeta::new_readonly(a.mint_0.key(), false),
        AccountMeta::new_readonly(a.mint_1.key(), false),
    ];
    let mut infos = vec![
        a.lp_signer.to_account_info(),
        a.vault.to_account_info(),
        a.position_nft_mint.to_account_info(),
        a.position_nft_account.to_account_info(),
        a.pool_state.to_account_info(),
        a.protocol_position.to_account_info(),
        a.tick_array_lower.to_account_info(),
        a.tick_array_upper.to_account_info(),
        a.personal_position.to_account_info(),
        a.token_account_0.to_account_info(),
        a.token_account_1.to_account_info(),
        a.pool_vault_0.to_account_info(),
        a.pool_vault_1.to_account_info(),
        a.rent.to_account_info(),
        a.system_program.to_account_info(),
        a.token_program.to_account_info(),
        a.associated_token_program.to_account_info(),
        a.token_program_2022.to_account_info(),
        a.mint_0.to_account_info(),
        a.mint_1.to_account_info(),
    ];
    for account in ctx.remaining_accounts {
        metas.push(AccountMeta::new(account.key(), false));
        infos.push(account.clone());
    }

    invoke_clmm(
        open_position_data(&OpenPositionArgs {
            tick_lower: params.tick_lower,
            tick_upper: params.tick_upper,
            tick_array_lower_start: params.tick_array_lower_start,
            tick_array_upper_start: params.tick_array_upper_start,
            liquidity: params.liquidity,
            amount_0_max: params.amount_0_max,
            amount_1_max: params.amount_1_max,
        }),
        metas,
        &infos,
        lp_signer_seeds,
    )?;

    for account in [&a.token_account_0, &a.token_account_1] {
        token::revoke(CpiContext::new_with_signer(
            a.token_program.key(),
            Revoke {
                source: account.to_account_info(),
                authority: a.vault.to_account_info(),
            },
            vault_signer,
        ))?;
    }

    // Неиспользованный остаток SOL возвращается управляющему.
    let leftover = a.lp_signer.lamports();
    if leftover > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                a.system_program.key(),
                system_program::Transfer {
                    from: a.lp_signer.to_account_info(),
                    to: a.authority.to_account_info(),
                },
                lp_signer_seeds,
            ),
            leftover,
        )?;
    }

    let nft_mint = ctx.accounts.position_nft_mint.key();
    let vault = &mut ctx.accounts.vault;
    vault.position_nft_mint = nft_mint;
    vault.position_tick_lower = params.tick_lower;
    vault.position_tick_upper = params.tick_upper;
    msg!(
        "Позиция открыта: диапазон [{}, {}], ликвидность {}",
        params.tick_lower,
        params.tick_upper,
        params.liquidity
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ModifyLiquidity<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, VaultConfig>>,
    /// CHECK: проверяется программой Raydium: NFT позиции должен лежать у vault.
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: только пул, к которому подключён vault.
    #[account(mut, address = vault.pool @ VaultError::InvalidPool)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: хранилище пула, проверяется программой Raydium.
    #[account(mut)]
    pub pool_vault_0: UncheckedAccount<'info>,
    /// CHECK: хранилище пула, проверяется программой Raydium.
    #[account(mut)]
    pub pool_vault_1: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,
    /// Получатели — только токен-аккаунты самого vault.
    #[account(
        mut,
        constraint = vault.is_own_account(&recipient_0.key()) @ VaultError::NotVaultAccount
    )]
    pub recipient_0: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = vault.is_own_account(&recipient_1.key()) @ VaultError::NotVaultAccount
    )]
    pub recipient_1: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: адрес фиксирован.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub mint_0: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub mint_1: UncheckedAccount<'info>,
    /// CHECK: адрес фиксирован.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
}

/// Уменьшение ликвидности. Вместе с ней Raydium всегда выплачивает накопленные комиссии.
pub fn handle_decrease_liquidity<'info>(
    ctx: Context<'info, ModifyLiquidity<'info>>,
    liquidity: u128,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    require!(
        ctx.accounts.vault.has_position(),
        VaultError::NoOpenPosition
    );
    let a = &ctx.accounts;
    let before_0 = a.recipient_0.amount;
    let before_1 = a.recipient_1.amount;

    let mut metas = vec![
        AccountMeta::new_readonly(a.vault.key(), true),
        AccountMeta::new_readonly(a.position_nft_account.key(), false),
        AccountMeta::new(a.personal_position.key(), false),
        AccountMeta::new(a.pool_state.key(), false),
        AccountMeta::new_readonly(a.protocol_position.key(), false),
        AccountMeta::new(a.pool_vault_0.key(), false),
        AccountMeta::new(a.pool_vault_1.key(), false),
        AccountMeta::new(a.tick_array_lower.key(), false),
        AccountMeta::new(a.tick_array_upper.key(), false),
        AccountMeta::new(a.recipient_0.key(), false),
        AccountMeta::new(a.recipient_1.key(), false),
        AccountMeta::new_readonly(a.token_program.key(), false),
        AccountMeta::new_readonly(a.token_program_2022.key(), false),
        AccountMeta::new_readonly(a.memo_program.key(), false),
        AccountMeta::new_readonly(a.mint_0.key(), false),
        AccountMeta::new_readonly(a.mint_1.key(), false),
    ];
    let mut infos = vec![
        a.vault.to_account_info(),
        a.position_nft_account.to_account_info(),
        a.personal_position.to_account_info(),
        a.pool_state.to_account_info(),
        a.protocol_position.to_account_info(),
        a.pool_vault_0.to_account_info(),
        a.pool_vault_1.to_account_info(),
        a.tick_array_lower.to_account_info(),
        a.tick_array_upper.to_account_info(),
        a.recipient_0.to_account_info(),
        a.recipient_1.to_account_info(),
        a.token_program.to_account_info(),
        a.token_program_2022.to_account_info(),
        a.memo_program.to_account_info(),
        a.mint_0.to_account_info(),
        a.mint_1.to_account_info(),
    ];
    for account in ctx.remaining_accounts {
        metas.push(AccountMeta::new(account.key(), false));
        infos.push(account.clone());
    }

    let asset_mint_key = a.vault.asset_mint;
    let bump = [a.vault.bump];
    let signer: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint_key.as_ref(), &bump]];
    invoke_clmm(
        decrease_liquidity_data(liquidity, amount_0_min, amount_1_min),
        metas,
        &infos,
        signer,
    )?;

    ctx.accounts.recipient_0.reload()?;
    ctx.accounts.recipient_1.reload()?;
    msg!(
        "Получено: token0 {}, token1 {} (ликвидность -{})",
        ctx.accounts.recipient_0.amount.saturating_sub(before_0),
        ctx.accounts.recipient_1.amount.saturating_sub(before_1),
        liquidity
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, VaultConfig>>,
    /// CHECK: только NFT текущей позиции vault.
    #[account(mut, address = vault.position_nft_mint @ VaultError::NoOpenPosition)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: только пул, к которому подключён vault.
    #[account(mut, address = vault.pool @ VaultError::InvalidPool)]
    pub pool_state: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: адрес фиксирован.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
}

pub fn handle_close_position(ctx: Context<ClosePosition>) -> Result<()> {
    require!(
        ctx.accounts.vault.has_position(),
        VaultError::NoOpenPosition
    );
    let a = &ctx.accounts;
    let metas = vec![
        AccountMeta::new(a.vault.key(), true),
        AccountMeta::new(a.position_nft_mint.key(), false),
        AccountMeta::new(a.position_nft_account.key(), false),
        AccountMeta::new(a.personal_position.key(), false),
        AccountMeta::new_readonly(a.system_program.key(), false),
        AccountMeta::new_readonly(a.token_program_2022.key(), false),
        AccountMeta::new(a.pool_state.key(), false),
    ];
    let infos = [
        a.vault.to_account_info(),
        a.position_nft_mint.to_account_info(),
        a.position_nft_account.to_account_info(),
        a.personal_position.to_account_info(),
        a.system_program.to_account_info(),
        a.token_program_2022.to_account_info(),
        a.pool_state.to_account_info(),
    ];
    let asset_mint_key = a.vault.asset_mint;
    let bump = [a.vault.bump];
    let signer: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint_key.as_ref(), &bump]];
    invoke_clmm(close_position_data(), metas, &infos, signer)?;

    // Raydium вернул rent закрытых аккаунтов на PDA vault. Излишек уходит тому, кто его платил.
    let vault_info = ctx.accounts.vault.to_account_info();
    let rent_exempt = Rent::get()?.minimum_balance(vault_info.data_len());
    let excess = vault_info.lamports().saturating_sub(rent_exempt);
    if excess > 0 {
        **vault_info.try_borrow_mut_lamports()? -= excess;
        **ctx
            .accounts
            .authority
            .to_account_info()
            .try_borrow_mut_lamports()? += excess;
    }

    let vault = &mut ctx.accounts.vault;
    vault.position_nft_mint = Pubkey::default();
    vault.position_tick_lower = 0;
    vault.position_tick_upper = 0;
    msg!("Позиция закрыта, возвращено {} lamports", excess);
    Ok(())
}

#[derive(Accounts)]
pub struct AssertOutOfRange<'info> {
    pub vault: Box<Account<'info, VaultConfig>>,
    /// CHECK: только пул, к которому подключён vault.
    #[account(address = vault.pool @ VaultError::InvalidPool)]
    pub pool_state: UncheckedAccount<'info>,
}

/// Завершается успешно, только если цена вышла из диапазона позиции.
/// Ставится первой инструкцией при перестановке, чтобы не переставлять работающую позицию.
pub fn handle_assert_out_of_range(ctx: Context<AssertOutOfRange>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(vault.has_position(), VaultError::NoOpenPosition);
    let tick = pool_tick(&ctx.accounts.pool_state.to_account_info())?;
    require!(
        !vault.is_tick_in_range(tick),
        VaultError::PositionInRange
    );
    msg!(
        "Тик {} вне диапазона [{}, {}]",
        tick,
        vault.position_tick_lower,
        vault.position_tick_upper
    );
    Ok(())
}

#[derive(Accounts)]
pub struct SyncTotalAssets<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ VaultError::Unauthorized,
        has_one = asset_vault,
        has_one = quote_vault
    )]
    pub vault: Box<Account<'info, VaultConfig>>,
    pub asset_vault: Box<Account<'info, TokenAccount>>,
    pub quote_vault: Box<Account<'info, TokenAccount>>,
}

/// Обновляет цену доли. Работает, только когда все средства снова в основном токене:
/// другой цены без оракула надёжно не посчитать.
pub fn handle_sync_total_assets(ctx: Context<SyncTotalAssets>) -> Result<()> {
    require!(
        !ctx.accounts.vault.has_position(),
        VaultError::PositionAlreadyOpen
    );
    require!(
        ctx.accounts.quote_vault.amount == 0,
        VaultError::QuoteNotEmpty
    );
    let actual = ctx.accounts.asset_vault.amount;
    let vault = &mut ctx.accounts.vault;
    msg!("total_assets: {} -> {}", vault.total_assets, actual);
    vault.total_assets = actual;
    Ok(())
}
