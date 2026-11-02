//! CPI в Raydium CLMM. Инструкции собираются вручную: так программа не зависит
//! от крейта Raydium, собранного под другую версию Anchor.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

/// Raydium CLMM в devnet. В mainnet: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK.
pub const CLMM_PROGRAM_ID: Pubkey = pubkey!("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/// Первые 8 байт sha256("global:<имя инструкции>").
const SWAP_V2: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];

/// Смещения полей в аккаунте PoolState: дискриминатор 8, bump 1, два Pubkey (config, owner).
const POOL_MINT0_OFFSET: usize = 8 + 1 + 32 + 32;
const POOL_MINT1_OFFSET: usize = POOL_MINT0_OFFSET + 32;

/// Токены пула (token0, token1) из данных аккаунта PoolState.
pub fn pool_mints(pool: &AccountInfo) -> Result<(Pubkey, Pubkey)> {
    let data = pool.try_borrow_data()?;
    require!(
        data.len() >= POOL_MINT1_OFFSET + 32,
        ErrorCode::AccountDidNotDeserialize
    );
    let read = |offset: usize| -> Result<Pubkey> {
        Pubkey::try_from(&data[offset..offset + 32]).map_err(|_| ErrorCode::AccountDidNotDeserialize.into())
    };
    Ok((read(POOL_MINT0_OFFSET)?, read(POOL_MINT1_OFFSET)?))
}

/// Вызов программы Raydium от имени PDA vault.
/// Порядок и флаги аккаунтов заданы в `metas`; `infos` содержит сами аккаунты.
pub fn invoke_clmm<'info>(
    data: Vec<u8>,
    metas: Vec<AccountMeta>,
    infos: &[AccountInfo<'info>],
    signer: &[&[&[u8]]],
) -> Result<()> {
    let ix = Instruction {
        program_id: CLMM_PROGRAM_ID,
        accounts: metas,
        data,
    };
    invoke_signed(&ix, infos, signer)?;
    Ok(())
}

/// Данные инструкции swap_v2: обмен точной суммы входного токена.
pub fn swap_v2_data(amount_in: u64, minimum_out: u64, sqrt_price_limit_x64: u128) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 8 + 8 + 16 + 1);
    data.extend_from_slice(&SWAP_V2);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_out.to_le_bytes());
    data.extend_from_slice(&sqrt_price_limit_x64.to_le_bytes());
    data.push(1); // is_base_input: задана сумма на входе
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swap_data_layout() {
        let data = swap_v2_data(1, 2, 3);
        assert_eq!(data.len(), 41);
        assert_eq!(&data[..8], &SWAP_V2);
        assert_eq!(data[8], 1);
        assert_eq!(data[16], 2);
        assert_eq!(data[24], 3);
        assert_eq!(data[40], 1);
    }
}
