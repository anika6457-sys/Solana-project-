//! Неделя 5 — тот же счётчик, но на Anchor.
//!
//! initialize создаёт аккаунт состояния и запоминает, кто его создал;
//! increment увеличивает значение и отказывает, если вызывает не создатель.

use anchor_lang::prelude::*;

declare_id!("B61m2Tk5fsC2N8JsfEDL2QMjTU5ftpHjYE59qWQAJ1yU");

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = 0;
        msg!("Счётчик создан, authority = {}", counter.authority);
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_add(1)
            .ok_or(CounterError::Overflow)?;
        msg!("Счётчик: {}", counter.count);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Counter::INIT_SPACE)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, has_one = authority @ CounterError::Unauthorized)]
    pub counter: Account<'info, Counter>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub authority: Pubkey,
    pub count: u64,
}

#[error_code]
pub enum CounterError {
    #[msg("Только создатель счётчика может его увеличивать")]
    Unauthorized,
    #[msg("Переполнение счётчика")]
    Overflow,
}
