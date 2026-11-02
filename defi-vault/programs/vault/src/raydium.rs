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
const OPEN_POSITION_TOKEN22: [u8; 8] = [77, 255, 174, 82, 125, 29, 201, 46];
const DECREASE_LIQUIDITY_V2: [u8; 8] = [58, 127, 188, 62, 79, 82, 196, 96];
const CLOSE_POSITION: [u8; 8] = [123, 134, 81, 0, 49, 68, 98, 98];

/// Смещения полей в аккаунте PoolState: дискриминатор 8, bump 1, два Pubkey (config, owner).
const POOL_MINT0_OFFSET: usize = 8 + 1 + 32 + 32;
const POOL_MINT1_OFFSET: usize = POOL_MINT0_OFFSET + 32;
/// После mint0, mint1, vault0, vault1, observation: decimals 2, tick_spacing 2, liquidity 16, sqrt_price 16.
const POOL_TICK_OFFSET: usize = POOL_MINT0_OFFSET + 32 * 5 + 2 + 2 + 16 + 16;

/// Текущий тик пула из данных аккаунта PoolState.
pub fn pool_tick(pool: &AccountInfo) -> Result<i32> {
    let data = pool.try_borrow_data()?;
    let bytes = data
        .get(POOL_TICK_OFFSET..POOL_TICK_OFFSET + 4)
        .ok_or(ErrorCode::AccountDidNotDeserialize)?;
    let mut buf = [0u8; 4];
    buf.copy_from_slice(bytes);
    Ok(i32::from_le_bytes(buf))
}

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

pub struct OpenPositionArgs {
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub tick_array_lower_start: i32,
    pub tick_array_upper_start: i32,
    pub liquidity: u128,
    pub amount_0_max: u64,
    pub amount_1_max: u64,
}

/// Данные инструкции open_position_with_token22_nft. Позиция задаётся через ликвидность.
pub fn open_position_data(args: &OpenPositionArgs) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 16 + 16 + 16 + 3);
    data.extend_from_slice(&OPEN_POSITION_TOKEN22);
    data.extend_from_slice(&args.tick_lower.to_le_bytes());
    data.extend_from_slice(&args.tick_upper.to_le_bytes());
    data.extend_from_slice(&args.tick_array_lower_start.to_le_bytes());
    data.extend_from_slice(&args.tick_array_upper_start.to_le_bytes());
    data.extend_from_slice(&args.liquidity.to_le_bytes());
    data.extend_from_slice(&args.amount_0_max.to_le_bytes());
    data.extend_from_slice(&args.amount_1_max.to_le_bytes());
    data.push(0); // with_metadata: без метаданных NFT
    data.push(0); // base_flag: None
    data.push(0);
    data
}

/// Данные инструкции decrease_liquidity_v2. При liquidity = 0 только собирает комиссии.
pub fn decrease_liquidity_data(liquidity: u128, amount_0_min: u64, amount_1_min: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 16 + 8 + 8);
    data.extend_from_slice(&DECREASE_LIQUIDITY_V2);
    data.extend_from_slice(&liquidity.to_le_bytes());
    data.extend_from_slice(&amount_0_min.to_le_bytes());
    data.extend_from_slice(&amount_1_min.to_le_bytes());
    data
}

pub fn close_position_data() -> Vec<u8> {
    CLOSE_POSITION.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_offset_matches_pool_layout() {
        // 8 + 1 + 32 * 7 + 1 + 1 + 2 + 16 + 16
        assert_eq!(POOL_TICK_OFFSET, 269);
    }

    #[test]
    fn open_position_data_layout() {
        let data = open_position_data(&OpenPositionArgs {
            tick_lower: -10,
            tick_upper: 10,
            tick_array_lower_start: -600,
            tick_array_upper_start: 0,
            liquidity: 5,
            amount_0_max: 6,
            amount_1_max: 7,
        });
        assert_eq!(data.len(), 59);
        assert_eq!(&data[8..12], &(-10i32).to_le_bytes());
        assert_eq!(data[24], 5);
        assert_eq!(data[40], 6);
        assert_eq!(data[48], 7);
    }

    #[test]
    fn decrease_liquidity_data_layout() {
        let data = decrease_liquidity_data(1, 2, 3);
        assert_eq!(data.len(), 40);
        assert_eq!(data[8], 1);
        assert_eq!(data[24], 2);
        assert_eq!(data[32], 3);
    }

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
