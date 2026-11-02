import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { connection, newMint, payer, program, setupVault } from "./helpers";
import { VaultPoolContext, quoteVaultPda } from "../scripts/lib/vault";
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

/** Пул, vault на основном токене пула и подключение vault к пулу. */
export async function setupVaultWithPool(assetIsToken0 = true) {
  const poolCtx = await setupPool();
  const { pool } = poolCtx;
  const assetMint = assetIsToken0 ? pool.mint0 : pool.mint1;
  const quoteMint = assetIsToken0 ? pool.mint1 : pool.mint0;
  const vaultCtx = await setupVault(assetMint);
  await program.methods
    .configurePool()
    .accountsPartial({
      authority: payer.publicKey,
      vault: vaultCtx.vault,
      quoteMint,
      poolState: pool.poolId,
    })
    .rpc();
  const c: VaultPoolContext = {
    program,
    authority: payer.publicKey,
    vault: vaultCtx.vault,
    assetMint,
    assetVault: vaultCtx.assetVault,
    quoteVault: quoteVaultPda(program.programId, vaultCtx.vault),
    pool,
  };
  return { ...poolCtx, vaultCtx, c, quoteMint };
}

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
