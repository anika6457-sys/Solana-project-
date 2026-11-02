// Инструкции vault, которые работают с Raydium. Общие для тестов и скриптов.

import { BN, Program } from "@anchor-lang/core";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import {
  AMM_CONFIG,
  CLMM_PROGRAM_ID,
  PoolAddresses,
  TICK_SPACING,
  liquidityForAmounts,
  positionAddresses,
  priceFromSqrt,
  readPool,
  readPosition,
  swapTickArrays,
} from "./clmm";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const COMPUTE_1M = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });

const writable = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

export const quoteVaultPda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("quote_vault"), vault.toBuffer()], programId)[0];

export interface VaultPoolContext {
  program: Program<any>;
  authority: PublicKey;
  vault: PublicKey;
  assetMint: PublicKey;
  assetVault: PublicKey;
  quoteVault: PublicKey;
  pool: PoolAddresses;
}

/** Токен-аккаунты vault в порядке token0, token1. */
export const orderedVaultAccounts = (c: VaultPoolContext): [PublicKey, PublicKey] =>
  c.pool.mint0.equals(c.assetMint) ? [c.assetVault, c.quoteVault] : [c.quoteVault, c.assetVault];

export const lpSignerPda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("lp_signer"), vault.toBuffer()], programId)[0];

/** Хватает на новые tick array и аккаунты позиции. Неиспользованный остаток возвращается. */
const RENT_FUNDING = new BN(0.5 * LAMPORTS_PER_SOL);

/** Открыть позицию из средств vault. Возвращает вызов и адреса позиции. */
export function vaultOpenPosition(
  c: VaultPoolContext,
  params: { tickLower: number; tickUpper: number; liquidity: BN; maxAmount0: BN; maxAmount1: BN }
) {
  const nftMint = Keypair.generate();
  const p = positionAddresses(c.pool.poolId, c.vault, nftMint.publicKey, params.tickLower, params.tickUpper);
  const [account0, account1] = orderedVaultAccounts(c);
  const call = c.program.methods
    .openPosition({
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      tickArrayLowerStart: p.lowerStart,
      tickArrayUpperStart: p.upperStart,
      liquidity: params.liquidity,
      amount0Max: params.maxAmount0,
      amount1Max: params.maxAmount1,
      rentFunding: RENT_FUNDING,
    })
    .accountsPartial({
      authority: c.authority,
      vault: c.vault,
      lpSigner: lpSignerPda(c.program.programId, c.vault),
      positionNftMint: nftMint.publicKey,
      positionNftAccount: p.nftAccount,
      poolState: c.pool.poolId,
      protocolPosition: p.protocolPosition,
      tickArrayLower: p.tickArrayLower,
      tickArrayUpper: p.tickArrayUpper,
      personalPosition: p.personalPosition,
      tokenAccount0: account0,
      tokenAccount1: account1,
      poolVault0: c.pool.vault0,
      poolVault1: c.pool.vault1,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      mint0: c.pool.mint0,
      mint1: c.pool.mint1,
      clmmProgram: CLMM_PROGRAM_ID,
    })
    .remainingAccounts([writable(c.pool.bitmapExtension)])
    .preInstructions([COMPUTE_1M])
    .signers([nftMint]);
  return { call, position: p };
}

type Position = ReturnType<typeof positionAddresses>;

function modifyAccounts(c: VaultPoolContext, p: Position) {
  const [account0, account1] = orderedVaultAccounts(c);
  return {
    authority: c.authority,
    vault: c.vault,
    positionNftAccount: p.nftAccount,
    personalPosition: p.personalPosition,
    poolState: c.pool.poolId,
    protocolPosition: p.protocolPosition,
    poolVault0: c.pool.vault0,
    poolVault1: c.pool.vault1,
    tickArrayLower: p.tickArrayLower,
    tickArrayUpper: p.tickArrayUpper,
    recipient0: account0,
    recipient1: account1,
    tokenProgram2022: TOKEN_2022_PROGRAM_ID,
    mint0: c.pool.mint0,
    mint1: c.pool.mint1,
    clmmProgram: CLMM_PROGRAM_ID,
  };
}

export const vaultCollectFees = (c: VaultPoolContext, p: Position) =>
  c.program.methods
    .collectFees()
    .accountsPartial(modifyAccounts(c, p))
    .remainingAccounts([writable(c.pool.bitmapExtension)])
    .preInstructions([COMPUTE_1M]);

export const vaultDecreaseLiquidity = (c: VaultPoolContext, p: Position, liquidity: BN, min0 = new BN(0), min1 = new BN(0)) =>
  c.program.methods
    .decreaseLiquidity(liquidity, min0, min1)
    .accountsPartial(modifyAccounts(c, p))
    .remainingAccounts([writable(c.pool.bitmapExtension)])
    .preInstructions([COMPUTE_1M]);

export const vaultClosePosition = (c: VaultPoolContext, p: Position) =>
  c.program.methods
    .closePosition()
    .accountsPartial({
      authority: c.authority,
      vault: c.vault,
      positionNftMint: p.nftMint,
      positionNftAccount: p.nftAccount,
      personalPosition: p.personalPosition,
      poolState: c.pool.poolId,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      clmmProgram: CLMM_PROGRAM_ID,
    });

export const vaultAssertOutOfRange = (c: VaultPoolContext) =>
  c.program.methods.assertOutOfRange().accountsPartial({ vault: c.vault, poolState: c.pool.poolId });

export const vaultSyncTotalAssets = (c: VaultPoolContext) =>
  c.program.methods.syncTotalAssets().accountsPartial({
    authority: c.authority,
    vault: c.vault,
    assetVault: c.assetVault,
    quoteVault: c.quoteVault,
  });

/**
 * Перестановка позиции, когда цена вышла из диапазона:
 * проверка выхода → вывод всей ликвидности и комиссий → закрытие →
 * выравнивание токенов обменом → новая позиция вокруг текущей цены.
 */
export async function vaultRebalance(c: VaultPoolContext, current: Position, widthTicks: number, maxSlippage = 0.02) {
  const connection = c.program.provider.connection;
  const { liquidity } = await readPosition(connection, current.personalPosition);

  const withdrawTx = await vaultDecreaseLiquidity(c, current, liquidity)
    .preInstructions([await vaultAssertOutOfRange(c).instruction()])
    .rpc();
  const closeTx = await vaultClosePosition(c, current).rpc();

  // Вне диапазона позиция состоит из одного токена: половину меняем на второй.
  const assetBalance = new BN((await getAccount(connection, c.assetVault)).amount.toString());
  const quoteBalance = new BN((await getAccount(connection, c.quoteVault)).amount.toString());
  const sellAsset = assetBalance.gt(quoteBalance);
  const amountIn = (sellAsset ? assetBalance.sub(quoteBalance) : quoteBalance.sub(assetBalance)).divn(2);
  const pool = await readPool(connection, c.pool.poolId);
  const price = priceFromSqrt(pool.sqrtPriceX64);
  const assetIsZero = c.pool.mint0.equals(c.assetMint);
  const zeroForOne = sellAsset === assetIsZero;
  const expectedOut = Math.floor(amountIn.toNumber() * (zeroForOne ? price : 1 / price));
  const swapCall = await vaultSwap(c, {
    sellAsset,
    amountIn,
    minimumOut: new BN(Math.max(1, Math.floor(expectedOut * (1 - maxSlippage)))),
  });
  const swapTx = await swapCall.rpc();

  // Новый диапазон вокруг текущей цены, на границах tick spacing.
  const after = await readPool(connection, c.pool.poolId);
  const center = Math.floor(after.tick / TICK_SPACING) * TICK_SPACING;
  const tickLower = center - widthTicks;
  const tickUpper = center + widthTicks;
  const [account0, account1] = orderedVaultAccounts(c);
  const max0 = new BN((await getAccount(connection, account0)).amount.toString());
  const max1 = new BN((await getAccount(connection, account1)).amount.toString());
  const { call, position } = vaultOpenPosition(c, {
    tickLower,
    tickUpper,
    liquidity: liquidityForAmounts(after.sqrtPriceX64, tickLower, tickUpper, max0, max1).muln(99).divn(100),
    maxAmount0: max0,
    maxAmount1: max1,
  });
  const openTx = await call.rpc();
  return { position, withdrawTx, closeTx, swapTx, openTx };
}

/** Обмен из vault. `sellAsset` — продать основной токен vault или второй токен пула. */
export async function vaultSwap(
  c: VaultPoolContext,
  params: { sellAsset: boolean; amountIn: BN; minimumOut: BN; sqrtPriceLimit?: BN }
) {
  const assetIsZero = c.pool.mint0.equals(c.assetMint);
  const zeroForOne = params.sellAsset === assetIsZero;
  const tickArrays = await swapTickArrays(c.program.provider.connection, c.pool.poolId, zeroForOne);

  return c.program.methods
    .swap(params.amountIn, params.minimumOut, params.sqrtPriceLimit ?? new BN(0))
    .accountsPartial({
      authority: c.authority,
      vault: c.vault,
      ammConfig: AMM_CONFIG,
      poolState: c.pool.poolId,
      inputTokenAccount: params.sellAsset ? c.assetVault : c.quoteVault,
      outputTokenAccount: params.sellAsset ? c.quoteVault : c.assetVault,
      inputPoolVault: zeroForOne ? c.pool.vault0 : c.pool.vault1,
      outputPoolVault: zeroForOne ? c.pool.vault1 : c.pool.vault0,
      observationState: c.pool.observation,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      inputMint: zeroForOne ? c.pool.mint0 : c.pool.mint1,
      outputMint: zeroForOne ? c.pool.mint1 : c.pool.mint0,
      clmmProgram: CLMM_PROGRAM_ID,
    })
    .remainingAccounts([writable(c.pool.bitmapExtension), ...tickArrays.map(writable)])
    .preInstructions([COMPUTE_1M]);
}
