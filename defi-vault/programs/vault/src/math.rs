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
    fn large_values_do_not_overflow() {
        assert_eq!(mul_div_floor(u64::MAX, u64::MAX, u64::MAX), Some(u64::MAX));
    }

    #[test]
    fn division_by_zero_is_rejected() {
        assert_eq!(mul_div_floor(1, 1, 0), None);
    }
}
