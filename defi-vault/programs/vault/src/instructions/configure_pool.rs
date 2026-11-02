use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::VaultError;
use crate::raydium::{pool_mints, CLMM_PROGRAM_ID};
use crate::state::*;

#[derive(Accounts)]
pub struct ConfigurePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, VaultConfig>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    /// CHECK: владелец — Raydium, токены пула проверяются в обработчике.
    #[account(owner = CLMM_PROGRAM_ID @ VaultError::InvalidPool)]
    pub pool_state: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [QUOTE_VAULT_SEED, vault.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = vault
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_configure_pool(ctx: Context<ConfigurePool>) -> Result<()> {
    let (mint0, mint1) = pool_mints(&ctx.accounts.pool_state.to_account_info())?;
    let asset = ctx.accounts.vault.asset_mint;
    let quote = ctx.accounts.quote_mint.key();
    require!(
        (mint0 == asset && mint1 == quote) || (mint0 == quote && mint1 == asset),
        VaultError::InvalidPool
    );

    let vault = &mut ctx.accounts.vault;
    vault.pool = ctx.accounts.pool_state.key();
    vault.quote_mint = quote;
    vault.quote_vault = ctx.accounts.quote_vault.key();
    msg!("Vault подключён к пулу {}", vault.pool);
    Ok(())
}
