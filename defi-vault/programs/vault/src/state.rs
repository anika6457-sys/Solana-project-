use anchor_lang::prelude::*;

pub const VAULT_SEED: &[u8] = b"vault";
pub const SHARE_MINT_SEED: &[u8] = b"share";
pub const ASSET_VAULT_SEED: &[u8] = b"asset_vault";
pub const USER_SEED: &[u8] = b"user";

/// Аккаунт настроек vault. PDA: ["vault", asset_mint].
/// Он же — authority у share-токена и токен-аккаунтов vault.
#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub asset_vault: Pubkey,
    /// Сколько токенов числится за держателями share-токенов.
    pub total_assets: u64,
    pub bump: u8,
}

/// PDA пользователя: ["user", vault, owner].
#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub deposited: u64,
    pub withdrawn: u64,
    pub bump: u8,
}
