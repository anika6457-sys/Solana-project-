// Инструкции vault, которые работают с Raydium. Общие для тестов и скриптов.

import { BN, Program } from "@anchor-lang/core";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { AMM_CONFIG, CLMM_PROGRAM_ID, PoolAddresses, swapTickArrays } from "./clmm";

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
