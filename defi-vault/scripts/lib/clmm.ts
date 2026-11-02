// Работа с Raydium CLMM: адреса, чтение пула, инструкции создания пула и позиции.
// Используется и скриптами для devnet, и тестами на локальном валидаторе.

import { BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ClmmInstrument,
  LiquidityMathUtil,
  PoolInfoLayout,
  TickUtil,
  TickArrayUtil,
  getPdaExBitmapAccount,
  getPdaObservationAccount,
  getPdaPersonalPositionAddress,
  getPdaPoolId,
  getPdaPoolVaultId,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
} from "@raydium-io/raydium-sdk-v2";
import Decimal from "decimal.js";

/** Raydium CLMM в devnet. В mainnet адрес другой: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK. */
export const CLMM_PROGRAM_ID = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
/** AmmConfig в devnet: tick spacing 10, комиссия 0.05%. */
export const AMM_CONFIG = new PublicKey("FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q");
export const TICK_SPACING = 10;
/** В одном tick array хранится 60 инициализируемых тиков. */
export const TICK_ARRAY_SPAN = 60 * TICK_SPACING;

/** CLMM требует, чтобы адрес token0 был меньше адреса token1. */
export function sortMints(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a];
}

export function poolAddresses(mint0: PublicKey, mint1: PublicKey) {
  const poolId = getPdaPoolId(CLMM_PROGRAM_ID, AMM_CONFIG, mint0, mint1).publicKey;
  return {
    poolId,
    mint0,
    mint1,
    vault0: getPdaPoolVaultId(CLMM_PROGRAM_ID, poolId, mint0).publicKey,
    vault1: getPdaPoolVaultId(CLMM_PROGRAM_ID, poolId, mint1).publicKey,
    observation: getPdaObservationAccount(CLMM_PROGRAM_ID, poolId).publicKey,
    bitmapExtension: getPdaExBitmapAccount(CLMM_PROGRAM_ID, poolId).publicKey,
  };
}
export type PoolAddresses = ReturnType<typeof poolAddresses>;

export function createPoolIx(owner: PublicKey, mint0: PublicKey, mint1: PublicKey, decimals: number, price: number) {
  const { poolId, observation, vault0, vault1, bitmapExtension } = poolAddresses(mint0, mint1);
  const sqrtPrice = TickUtil.priceToSqrtPriceX64(new Decimal(price), decimals, decimals);
  return ClmmInstrument.createPoolInstruction(
    CLMM_PROGRAM_ID,
    poolId,
    owner,
    AMM_CONFIG,
    observation,
    mint0,
    vault0,
    TOKEN_PROGRAM,
    mint1,
    vault1,
    TOKEN_PROGRAM,
    bitmapExtension,
    sqrtPrice,
    undefined
  );
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export async function readPool(connection: Connection, poolId: PublicKey) {
  const info = await connection.getAccountInfo(poolId);
  if (!info) throw new Error(`пул ${poolId.toBase58()} не найден`);
  const pool = PoolInfoLayout.decode(info.data);
  return {
    tick: pool.tickCurrent as number,
    sqrtPriceX64: pool.sqrtPriceX64 as BN,
    liquidity: pool.liquidity as BN,
    tickSpacing: pool.tickSpacing as number,
    feeGrowth0: pool.feeGrowthGlobalX64A as BN,
    feeGrowth1: pool.feeGrowthGlobalX64B as BN,
  };
}

/** Цена token1 за token0 при одинаковых decimals. */
export const priceFromSqrt = (sqrtPriceX64: BN) =>
  new Decimal(sqrtPriceX64.toString()).div(new Decimal(2).pow(64)).pow(2).toNumber();

export const tickArrayStart = (tick: number) => TickArrayUtil.getTickArrayStartIndex(tick, TICK_SPACING);
export const tickArrayAddress = (poolId: PublicKey, start: number) =>
  getPdaTickArrayAddress(CLMM_PROGRAM_ID, poolId, start).publicKey;

/** Существующие tick array в направлении обмена, начиная с текущей цены. */
export async function swapTickArrays(connection: Connection, poolId: PublicKey, zeroForOne: boolean, maxScan = 12) {
  const { tick } = await readPool(connection, poolId);
  const first = tickArrayStart(tick);
  const candidates = Array.from({ length: maxScan }, (_, i) =>
    tickArrayAddress(poolId, first + (zeroForOne ? -i : i) * TICK_ARRAY_SPAN)
  );
  const infos = await connection.getMultipleAccountsInfo(candidates);
  const existing = candidates.filter((_, i) => infos[i] !== null);
  if (existing.length === 0) throw new Error("нет инициализированных tick array: добавьте ликвидность");
  return existing.slice(0, 4);
}

/** Адреса новой позиции. Владелец NFT может быть PDA (vault) или кошельком. */
export function positionAddresses(poolId: PublicKey, nftOwner: PublicKey, nftMint: PublicKey, tickLower: number, tickUpper: number) {
  const lowerStart = tickArrayStart(tickLower);
  const upperStart = tickArrayStart(tickUpper);
  return {
    nftMint,
    nftAccount: getAssociatedTokenAddressSync(nftMint, nftOwner, true, TOKEN_2022_PROGRAM_ID),
    personalPosition: getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey,
    protocolPosition: getPdaProtocolPositionAddress(CLMM_PROGRAM_ID, poolId, tickLower, tickUpper).publicKey,
    tickArrayLower: tickArrayAddress(poolId, lowerStart),
    tickArrayUpper: tickArrayAddress(poolId, upperStart),
    lowerStart,
    upperStart,
    tickLower,
    tickUpper,
  };
}

/** Какая ликвидность получится из заданных сумм в диапазоне и сколько токенов она займёт. */
export function liquidityForAmounts(sqrtPriceX64: BN, tickLower: number, tickUpper: number, amount0: BN, amount1: BN) {
  const sqrtLower = TickUtil.getSqrtPriceAtTick(tickLower);
  const sqrtUpper = TickUtil.getSqrtPriceAtTick(tickUpper);
  return LiquidityMathUtil.getLiquidityFromAmounts(sqrtPriceX64, sqrtLower, sqrtUpper, amount0, amount1) as BN;
}

/** Инструкция открытия позиции напрямую, от имени кошелька. */
export function openPositionIx(params: {
  pool: PoolAddresses;
  owner: PublicKey;
  account0: PublicKey;
  account1: PublicKey;
  tickLower: number;
  tickUpper: number;
  liquidity: BN;
  maxAmount0: BN;
  maxAmount1: BN;
}): { ix: TransactionInstruction; nftMint: Keypair } {
  const { pool, owner } = params;
  const nftMint = Keypair.generate();
  const p = positionAddresses(pool.poolId, owner, nftMint.publicKey, params.tickLower, params.tickUpper);
  const ix = ClmmInstrument.openPositionWithToken22NftInstruction(
    CLMM_PROGRAM_ID,
    owner,
    pool.poolId,
    owner,
    p.nftMint,
    p.nftAccount,
    p.protocolPosition,
    p.tickArrayLower,
    p.tickArrayUpper,
    p.personalPosition,
    params.account0,
    params.account1,
    pool.vault0,
    pool.vault1,
    pool.mint0,
    pool.mint1,
    params.tickLower,
    params.tickUpper,
    p.lowerStart,
    p.upperStart,
    params.liquidity,
    params.maxAmount0,
    params.maxAmount1,
    false,
    null,
    pool.bitmapExtension
  );
  return { ix, nftMint };
}

/** Обмен напрямую от имени кошелька (используется, чтобы двигать цену в тестах). */
export async function directSwapIx(params: {
  connection: Connection;
  pool: PoolAddresses;
  owner: PublicKey;
  account0: PublicKey;
  account1: PublicKey;
  zeroForOne: boolean;
  amountIn: BN;
}) {
  const { pool, zeroForOne } = params;
  const tickArrays = await swapTickArrays(params.connection, pool.poolId, zeroForOne);
  return ClmmInstrument.swapV2Instruction(
    CLMM_PROGRAM_ID,
    params.owner,
    pool.poolId,
    AMM_CONFIG,
    zeroForOne ? params.account0 : params.account1,
    zeroForOne ? params.account1 : params.account0,
    zeroForOne ? pool.vault0 : pool.vault1,
    zeroForOne ? pool.vault1 : pool.vault0,
    zeroForOne ? pool.mint0 : pool.mint1,
    zeroForOne ? pool.mint1 : pool.mint0,
    tickArrays,
    pool.observation,
    params.amountIn,
    new BN(0),
    new BN(0),
    true,
    pool.bitmapExtension
  );
}
