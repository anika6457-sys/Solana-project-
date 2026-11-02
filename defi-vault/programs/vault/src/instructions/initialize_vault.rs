use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::*;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [VAULT_SEED, asset_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultConfig>,
    #[account(
        init,
        payer = authority,
        seeds = [SHARE_MINT_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = asset_mint.decimals,
        mint::authority = vault
    )]
    pub share_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [ASSET_VAULT_SEED, vault.key().as_ref()],
        bump,
        token::mint = asset_mint,
        token::authority = vault
    )]
    pub asset_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.asset_mint = ctx.accounts.asset_mint.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.asset_vault = ctx.accounts.asset_vault.key();
    vault.total_assets = 0;
    vault.bump = ctx.bumps.vault;
    msg!("Vault создан для токена {}", vault.asset_mint);
    Ok(())
}
