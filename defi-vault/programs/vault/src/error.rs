use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Сумма должна быть больше нуля")]
    ZeroAmount,
}
