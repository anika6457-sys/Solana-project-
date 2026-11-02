//! DeFi-vault: принимает токены пользователей, выдаёт share-токены (их долю)
//! и размещает средства в пуле ликвидности Raydium CLMM.

pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("5CQXXi8aMKcmkWmZXHikKBvU5KUKfquWJtvt7R1K2KrN");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::handle_initialize_vault(ctx)
    }

    pub fn create_user_account(ctx: Context<CreateUserAccount>) -> Result<()> {
        instructions::create_user_account::handle_create_user_account(ctx)
    }
}
