import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { connection, newMint, payer } from "./helpers";
import {
  createPoolIx,
  liquidityForAmounts,
  openPositionIx,
  poolAddresses,
  readPool,
  sortMints,
} from "../scripts/lib/clmm";

export const sendWithBudget = (ixs: Parameters<Transaction["add"]>, signers: Parameters<typeof sendAndConfirmTransaction>[2]) =>
  sendAndConfirmTransaction(
    connection,
    new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...ixs),
    signers
  );

/** Два новых токена, пул с ценой 1 и стартовая ликвидность в диапазоне [-1000, 1000]. */
export async function setupPool(seed = 100_000_000_000) {
  const [mint0, mint1] = sortMints(await newMint(), await newMint());
  const account0 = (await getOrCreateAssociatedTokenAccount(connection, payer, mint0, payer.publicKey)).address;
  const account1 = (await getOrCreateAssociatedTokenAccount(connection, payer, mint1, payer.publicKey)).address;
  await mintTo(connection, payer, mint0, account0, payer, 1_000_000_000_000);
  await mintTo(connection, payer, mint1, account1, payer, 1_000_000_000_000);

  const pool = poolAddresses(mint0, mint1);
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createPoolIx(payer.publicKey, mint0, mint1, 6, 1)),
    [payer]
  );

  const amount = new BN(seed);
  const state = await readPool(connection, pool.poolId);
  const { ix, nftMint } = openPositionIx({
    pool,
    owner: payer.publicKey,
    account0,
    account1,
    tickLower: -1000,
    tickUpper: 1000,
    liquidity: liquidityForAmounts(state.sqrtPriceX64, -1000, 1000, amount, amount),
    maxAmount0: amount.muln(2),
    maxAmount1: amount.muln(2),
  });
  await sendWithBudget([ix], [payer, nftMint]);
  return { pool, account0, account1 };
}
