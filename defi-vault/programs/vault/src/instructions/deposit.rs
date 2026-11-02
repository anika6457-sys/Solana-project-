use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, TransferChecked};

use crate::error::VaultError;
use crate::math::shares_for_deposit;
use crate::state::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        has_one = asset_mint,
        has_one = asset_vault,
        has_one = share_mint
    )]
    pub vault: Box<Account<'info, VaultConfig>>,
    #[account(
        mut,
        seeds = [USER_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump = user_account.bump,
        has_one = owner,
        has_one = vault
    )]
    pub user_account: Box<Account<'info, UserAccount>>,
    pub asset_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub asset_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = asset_mint, token::authority = owner)]
    pub user_asset_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = share_mint, token::authority = owner)]
    pub user_share_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);

    let shares = shares_for_deposit(
        amount,
        ctx.accounts.vault.total_assets,
        ctx.accounts.share_mint.supply,
    )
    .ok_or(VaultError::MathOverflow)?;
    require!(shares > 0, VaultError::ZeroShares);
    require!(shares >= min_shares_out, VaultError::SlippageExceeded);

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.user_asset_account.to_account_info(),
                mint: ctx.accounts.asset_mint.to_account_info(),
                to: ctx.accounts.asset_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.asset_mint.decimals,
    )?;

    // Share-токен выпускает PDA vault, поэтому нужна подпись по его seeds.
    let asset_mint_key = ctx.accounts.vault.asset_mint;
    let bump = [ctx.accounts.vault.bump];
    let signer: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint_key.as_ref(), &bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ),
        shares,
    )?;

    let vault = &mut ctx.accounts.vault;
    vault.total_assets = vault
        .total_assets
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    let user = &mut ctx.accounts.user_account;
    user.deposited = user
        .deposited
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;

    msg!("Депозит {} токенов, выдано {} долей", amount, shares);
    Ok(())
}
