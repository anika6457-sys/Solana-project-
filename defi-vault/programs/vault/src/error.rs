use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Сумма должна быть больше нуля")]
    ZeroAmount,
    #[msg("Сумма слишком мала: доля округляется до нуля")]
    ZeroShares,
    #[msg("Получено меньше минимально допустимого")]
    SlippageExceeded,
    #[msg("У пользователя меньше долей, чем он хочет сжечь")]
    InsufficientShares,
    #[msg("В хранилище недостаточно свободных токенов")]
    InsufficientIdleAssets,
    #[msg("Действие доступно только управляющему vault")]
    Unauthorized,
    #[msg("Пул не подходит этому vault")]
    InvalidPool,
    #[msg("Токен-аккаунт не принадлежит этому vault")]
    NotVaultAccount,
    #[msg("Нужно указать минимальную сумму получения")]
    MinimumOutRequired,
    #[msg("Переполнение при расчёте")]
    MathOverflow,
}
