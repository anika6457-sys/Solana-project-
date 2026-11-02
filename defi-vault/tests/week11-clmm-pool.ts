import { BN } from "@anchor-lang/core";
import { assert } from "chai";
import { ComputeBudgetProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { connection, payer } from "./helpers";
import { directSwapIx, priceFromSqrt, readPool } from "../scripts/lib/clmm";
import { setupPool } from "./pool-helpers";

describe("неделя 11: CLMM-пул Raydium", () => {
  let ctx: Awaited<ReturnType<typeof setupPool>>;

  it("пул создан с ценой 1 и правильным порядком токенов", async () => {
    ctx = await setupPool();
    assert.ok(Buffer.compare(ctx.pool.mint0.toBuffer(), ctx.pool.mint1.toBuffer()) < 0, "token0 < token1");

    const state = await readPool(connection, ctx.pool.poolId);
    assert.equal(state.tickSpacing, 10);
    assert.equal(state.tick, 0);
    assert.closeTo(priceFromSqrt(state.sqrtPriceX64), 1, 1e-9);
  });

  it("ликвидность в диапазоне вокруг цены активна", async () => {
    const state = await readPool(connection, ctx.pool.poolId);
    assert.ok(state.liquidity.gt(new BN(0)), "у пула есть активная ликвидность");

    // Цена внутри диапазона: в позицию внесены оба токена поровну.
    const vault0 = Number((await getAccount(connection, ctx.pool.vault0)).amount);
    const vault1 = Number((await getAccount(connection, ctx.pool.vault1)).amount);
    assert.approximately(vault0 / vault1, 1, 1e-6);
  });

  it("обмен двигает цену и начисляет комиссию", async () => {
    const before = await readPool(connection, ctx.pool.poolId);
    const balanceBefore = (await getAccount(connection, ctx.account1)).amount;

    const ix = await directSwapIx({
      connection,
      pool: ctx.pool,
      owner: payer.publicKey,
      account0: ctx.account0,
      account1: ctx.account1,
      zeroForOne: true,
      amountIn: new BN(1_000_000_000),
    });
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix),
      [payer]
    );

    const after = await readPool(connection, ctx.pool.poolId);
    assert.ok(after.sqrtPriceX64.lt(before.sqrtPriceX64), "продажа token0 снижает цену");
    assert.ok(after.tick < before.tick);
    assert.ok(after.feeGrowth0.gt(before.feeGrowth0), "комиссия начислена в token0");
    assert.ok((await getAccount(connection, ctx.account1)).amount > balanceBefore, "получен token1");
  });
});
