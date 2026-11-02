use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{Token, TokenAccount};
use anchor_spl::token_2022::Token2022;

use crate::error::VaultError;
use crate::raydium::{invoke_clmm, swap_v2_data, CLMM_PROGRAM_ID, MEMO_PROGRAM_ID};
use crate::state::*;

#[derive(Accounts)]
pub struct Swap<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, VaultConfig>>,
    /// CHECK: проверяется программой Raydium вместе с пулом.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: только пул, к которому подключён vault.
    #[account(mut, address = vault.pool @ VaultError::InvalidPool)]
    pub pool_state: UncheckedAccount<'info>,
    /// Вход и выход — только токен-аккаунты самого vault, чтобы средства не ушли наружу.
    #[account(
        mut,
        constraint = vault.is_own_account(&input_token_account.key()) @ VaultError::NotVaultAccount
    )]
    pub input_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = vault.is_own_account(&output_token_account.key()) @ VaultError::NotVaultAccount,
        constraint = output_token_account.key() != input_token_account.key() @ VaultError::NotVaultAccount
    )]
    pub output_token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: хранилище пула, проверяется программой Raydium.
    #[account(mut)]
    pub input_pool_vault: UncheckedAccount<'info>,
    /// CHECK: хранилище пула, проверяется программой Raydium.
    #[account(mut)]
    pub output_pool_vault: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: адрес фиксирован.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub input_mint: UncheckedAccount<'info>,
    /// CHECK: проверяется программой Raydium.
    pub output_mint: UncheckedAccount<'info>,
    /// CHECK: адрес фиксирован.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
}

/// Обмен из vault. В remaining_accounts — bitmap extension и tick array пула.
pub fn handle_swap<'info>(
    ctx: Context<'info, Swap<'info>>,
    amount_in: u64,
    minimum_amount_out: u64,
    sqrt_price_limit_x64: u128,
) -> Result<()> {
    require!(amount_in > 0, VaultError::ZeroAmount);
    // Без минимума обмен не защищён от проскальзывания.
    require!(minimum_amount_out > 0, VaultError::MinimumOutRequired);

    let a = &ctx.accounts;
    let received_before = a.output_token_account.amount;
    let vault_key = a.vault.key();

    let mut metas = vec![
        AccountMeta::new_readonly(vault_key, true),
        AccountMeta::new_readonly(a.amm_config.key(), false),
        AccountMeta::new(a.pool_state.key(), false),
        AccountMeta::new(a.input_token_account.key(), false),
        AccountMeta::new(a.output_token_account.key(), false),
        AccountMeta::new(a.input_pool_vault.key(), false),
        AccountMeta::new(a.output_pool_vault.key(), false),
        AccountMeta::new(a.observation_state.key(), false),
        AccountMeta::new_readonly(a.token_program.key(), false),
        AccountMeta::new_readonly(a.token_program_2022.key(), false),
        AccountMeta::new_readonly(a.memo_program.key(), false),
        AccountMeta::new_readonly(a.input_mint.key(), false),
        AccountMeta::new_readonly(a.output_mint.key(), false),
    ];
    let mut infos = vec![
        a.vault.to_account_info(),
        a.amm_config.to_account_info(),
        a.pool_state.to_account_info(),
        a.input_token_account.to_account_info(),
        a.output_token_account.to_account_info(),
        a.input_pool_vault.to_account_info(),
        a.output_pool_vault.to_account_info(),
        a.observation_state.to_account_info(),
        a.token_program.to_account_info(),
        a.token_program_2022.to_account_info(),
        a.memo_program.to_account_info(),
        a.input_mint.to_account_info(),
        a.output_mint.to_account_info(),
    ];
    for account in ctx.remaining_accounts {
        metas.push(AccountMeta::new(account.key(), false));
        infos.push(account.clone());
    }

    let asset_mint_key = a.vault.asset_mint;
    let bump = [a.vault.bump];
    let signer: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint_key.as_ref(), &bump]];
    invoke_clmm(
        swap_v2_data(amount_in, minimum_amount_out, sqrt_price_limit_x64),
        metas,
        &infos,
        signer,
    )?;

    // Raydium проверяет минимум сам; повторная проверка по факту не полагается на внешний код.
    ctx.accounts.output_token_account.reload()?;
    let received = ctx
        .accounts
        .output_token_account
        .amount
        .checked_sub(received_before)
        .ok_or(VaultError::MathOverflow)?;
    require!(received >= minimum_amount_out, VaultError::SlippageExceeded);

    msg!("Обмен: отдано {}, получено {}", amount_in, received);
    Ok(())
}
