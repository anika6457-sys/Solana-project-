//! DeFi-vault: принимает токены пользователей, выдаёт share-токены (их долю)
//! и размещает средства в пуле ликвидности Raydium CLMM.

pub mod error;
pub mod instructions;
pub mod math;
pub mod raydium;
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

    pub fn deposit(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount, min_shares_out)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64, min_amount_out: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, shares, min_amount_out)
    }

    pub fn configure_pool(ctx: Context<ConfigurePool>) -> Result<()> {
        instructions::configure_pool::handle_configure_pool(ctx)
    }

    pub fn swap<'info>(
        ctx: Context<'info, Swap<'info>>,
        amount_in: u64,
        minimum_amount_out: u64,
        sqrt_price_limit_x64: u128,
    ) -> Result<()> {
        instructions::swap::handle_swap(ctx, amount_in, minimum_amount_out, sqrt_price_limit_x64)
    }

    pub fn open_position<'info>(
        ctx: Context<'info, OpenPosition<'info>>,
        params: OpenPositionParams,
    ) -> Result<()> {
        instructions::position::handle_open_position(ctx, params)
    }

    /// Выплачивает накопленные комиссии, не трогая ликвидность.
    pub fn collect_fees<'info>(ctx: Context<'info, ModifyLiquidity<'info>>) -> Result<()> {
        instructions::position::handle_decrease_liquidity(ctx, 0, 0, 0)
    }

    pub fn decrease_liquidity<'info>(
        ctx: Context<'info, ModifyLiquidity<'info>>,
        liquidity: u128,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        instructions::position::handle_decrease_liquidity(ctx, liquidity, amount_0_min, amount_1_min)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::position::handle_close_position(ctx)
    }

    pub fn assert_out_of_range(ctx: Context<AssertOutOfRange>) -> Result<()> {
        instructions::position::handle_assert_out_of_range(ctx)
    }

    pub fn sync_total_assets(ctx: Context<SyncTotalAssets>) -> Result<()> {
        instructions::position::handle_sync_total_assets(ctx)
    }
}
