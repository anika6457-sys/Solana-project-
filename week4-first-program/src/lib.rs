//! Неделя 4 — первая программа на чистом Solana SDK (без Anchor).
//!
//! Программа хранит одно число (счётчик, u64) в аккаунте, которым владеет
//! сама программа. Вызов различается по первому байту instruction data:
//!   0 — сброс счётчика в ноль (инициализация);
//!   1 — увеличение счётчика на единицу.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Размер данных аккаунта-счётчика: один u64 в little-endian.
pub const COUNTER_SIZE: usize = 8;

pub const IX_RESET: u8 = 0;
pub const IX_INCREMENT: u8 = 1;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let counter = next_account_info(accounts_iter)?;

    // Писать можно только в аккаунт, которым владеет эта программа.
    if counter.owner != program_id {
        msg!("Ошибка: аккаунт не принадлежит программе");
        return Err(ProgramError::IncorrectProgramId);
    }
    if !counter.is_writable {
        msg!("Ошибка: аккаунт не помечен как writable");
        return Err(ProgramError::InvalidAccountData);
    }
    if counter.data_len() < COUNTER_SIZE {
        msg!("Ошибка: аккаунт меньше {} байт", COUNTER_SIZE);
        return Err(ProgramError::AccountDataTooSmall);
    }

    let (&tag, _rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    let mut data = counter.try_borrow_mut_data()?;
    let current = read_u64(&data[..COUNTER_SIZE]);

    let next = match tag {
        IX_RESET => {
            msg!("Инструкция: reset");
            0
        }
        IX_INCREMENT => {
            msg!("Инструкция: increment");
            current
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)?
        }
        _ => {
            msg!("Ошибка: неизвестная инструкция {}", tag);
            return Err(ProgramError::InvalidInstructionData);
        }
    };

    write_u64(&mut data[..COUNTER_SIZE], next);
    msg!("Счётчик: {} -> {}", current, next);
    Ok(())
}

/// Ручная распаковка u64 из 8 байт little-endian.
pub fn read_u64(bytes: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&bytes[..8]);
    u64::from_le_bytes(buf)
}

/// Ручная упаковка u64 в 8 байт little-endian.
pub fn write_u64(bytes: &mut [u8], value: u64) {
    bytes[..8].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u64_round_trip_little_endian() {
        let mut buf = [0u8; 8];
        write_u64(&mut buf, 0x0102_0304_0506_0708);
        assert_eq!(buf, [8, 7, 6, 5, 4, 3, 2, 1]);
        assert_eq!(read_u64(&buf), 0x0102_0304_0506_0708);
    }
}
