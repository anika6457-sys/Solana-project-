use anchor_lang::prelude::*;

pub const VAULT_SEED: &[u8] = b"vault";
pub const SHARE_MINT_SEED: &[u8] = b"share";
pub const ASSET_VAULT_SEED: &[u8] = b"asset_vault";
pub const USER_SEED: &[u8] = b"user";
pub const QUOTE_VAULT_SEED: &[u8] = b"quote_vault";

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
    /// Пул Raydium CLMM, к которому подключён vault.
    pub pool: Pubkey,
    pub quote_mint: Pubkey,
    /// Токен-аккаунт vault для второго токена пула. PDA: ["quote_vault", vault].
    pub quote_vault: Pubkey,
}

impl VaultConfig {
    /// Принадлежит ли токен-аккаунт самому vault.
    pub fn is_own_account(&self, key: &Pubkey) -> bool {
        *key == self.asset_vault || *key == self.quote_vault
    }
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
