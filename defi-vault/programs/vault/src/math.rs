//! Расчёт долей. Округление всегда в пользу vault, чтобы нельзя было
//! заработать на округлении, многократно внося и выводя маленькие суммы.

/// Сколько share-токенов выдать за депозит `amount`.
/// Первый депозит идёт 1:1, дальше — пропорционально доле в vault.
pub fn shares_for_deposit(amount: u64, total_assets: u64, total_shares: u64) -> Option<u64> {
    if total_shares == 0 || total_assets == 0 {
        return Some(amount);
    }
    mul_div_floor(amount, total_shares, total_assets)
}

/// Сколько токенов вернуть за сжигание `shares`.
pub fn assets_for_shares(shares: u64, total_assets: u64, total_shares: u64) -> Option<u64> {
    mul_div_floor(shares, total_assets, total_shares)
}

/// `a * b / c` с округлением вниз без переполнения в промежуточном значении.
pub fn mul_div_floor(a: u64, b: u64, c: u64) -> Option<u64> {
    if c == 0 {
        return None;
    }
    let result = (a as u128).checked_mul(b as u128)? / (c as u128);
    u64::try_from(result).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(shares_for_deposit(1_000, 0, 0), Some(1_000));
    }

    #[test]
    fn next_deposit_is_proportional() {
        // В vault 2000 токенов на 1000 долей: доля стоит 2 токена.
        assert_eq!(shares_for_deposit(500, 2_000, 1_000), Some(250));
    }

    #[test]
    fn rounding_favours_the_vault() {
        assert_eq!(shares_for_deposit(1, 3, 2), Some(0));
        assert_eq!(shares_for_deposit(5, 3, 2), Some(3));
    }

    #[test]
    fn withdraw_returns_proportional_assets() {
        // Vault заработал: 3000 токенов на 1000 долей.
        assert_eq!(assets_for_shares(100, 3_000, 1_000), Some(300));
        assert_eq!(assets_for_shares(1_000, 3_000, 1_000), Some(3_000));
    }

    #[test]
    fn deposit_then_withdraw_gives_no_profit() {
        let shares = shares_for_deposit(7, 10, 3).unwrap();
        let back = assets_for_shares(shares, 10 + 7, 3 + shares).unwrap();
        assert!(back <= 7);
    }

    #[test]
    fn withdraw_with_no_shares_is_rejected() {
        assert_eq!(assets_for_shares(1, 0, 0), None);
    }

    #[test]
    fn large_values_do_not_overflow() {
        assert_eq!(mul_div_floor(u64::MAX, u64::MAX, u64::MAX), Some(u64::MAX));
    }

    #[test]
    fn division_by_zero_is_rejected() {
        assert_eq!(mul_div_floor(1, 1, 0), None);
    }
}
