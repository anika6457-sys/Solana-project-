use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct CreateUserAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub vault: Account<'info, VaultConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [USER_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_user_account(ctx: Context<CreateUserAccount>) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    user.owner = ctx.accounts.owner.key();
    user.vault = ctx.accounts.vault.key();
    user.deposited = 0;
    user.withdrawn = 0;
    user.bump = ctx.bumps.user_account;
    Ok(())
}
