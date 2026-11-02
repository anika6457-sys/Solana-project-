import { BN } from "@anchor-lang/core";
import { assert } from "chai";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection, depositIx, errorCode, fundedKeypair, payer, program, setupUser, withdrawIx } from "./helpers";
import { sendWithBudget, setupVaultWithPool } from "./pool-helpers";
import { directSwapIx, liquidityForAmounts, readPool, readPosition } from "../scripts/lib/clmm";
import {
  lpSignerPda,
  orderedVaultAccounts,
  vaultAssertOutOfRange,
  vaultClosePosition,
  vaultCollectFees,
  vaultDecreaseLiquidity,
  vaultOpenPosition,
  vaultRebalance,
  vaultSwap,
  vaultSyncTotalAssets,
} from "../scripts/lib/vault";

const balance = async (account: Parameters<typeof getAccount>[1]) =>
  Number((await getAccount(connection, account)).amount);

describe("неделя 13: позиция из vault", () => {
  let ctx: Awaited<ReturnType<typeof setupVaultWithPool>>;
  let alice: Awaited<ReturnType<typeof setupUser>>;
  let position: ReturnType<typeof vaultOpenPosition>["position"];

  const DEPOSIT = 40_000_000;

  const marketSwap = async (zeroForOne: boolean, amountIn: number) => {
    const ix = await directSwapIx({
      connection,
      pool: ctx.pool,
      owner: payer.publicKey,
      account0: ctx.account0,
      account1: ctx.account1,
      zeroForOne,
      amountIn: new BN(amountIn),
    });
    await sendWithBudget([ix], [payer]);
  };

  const openAround = async (tickLower: number, tickUpper: number) => {
    const { sqrtPriceX64 } = await readPool(connection, ctx.pool.poolId);
    const [a0, a1] = orderedVaultAccounts(ctx.c);
    const max0 = new BN(await balance(a0));
    const max1 = new BN(await balance(a1));
    return vaultOpenPosition(ctx.c, {
      tickLower,
      tickUpper,
      liquidity: liquidityForAmounts(sqrtPriceX64, tickLower, tickUpper, max0, max1).muln(99).divn(100),
      maxAmount0: max0,
      maxAmount1: max1,
    });
  };

  before(async () => {
    ctx = await setupVaultWithPool(true);
    alice = await setupUser(ctx.vaultCtx, DEPOSIT);
    await depositIx(ctx.vaultCtx, alice, DEPOSIT).rpc();
    const swap = await vaultSwap(ctx.c, {
      sellAsset: true,
      amountIn: new BN(DEPOSIT / 2),
      minimumOut: new BN(Math.floor((DEPOSIT / 2) * 0.99)),
    });
    await swap.rpc();
  });

  it("open_position: NFT у vault, диапазон записан, delegate отозван", async () => {
    const assetBefore = await balance(ctx.c.assetVault);
    const authorityBefore = await connection.getBalance(payer.publicKey);

    const opened = await openAround(-100, 100);
    position = opened.position;
    await opened.call.rpc();

    const nftAccount = getAssociatedTokenAddressSync(position.nftMint, ctx.c.vault, true, TOKEN_2022_PROGRAM_ID);
    const nft = await getAccount(connection, nftAccount, undefined, TOKEN_2022_PROGRAM_ID);
    assert.equal(Number(nft.amount), 1);
    assert.ok(nft.owner.equals(ctx.c.vault), "позицией владеет PDA vault");

    const config = await program.account.vaultConfig.fetch(ctx.c.vault);
    assert.ok(config.positionNftMint.equals(position.nftMint));
    assert.equal(config.positionTickLower, -100);
    assert.equal(config.positionTickUpper, 100);

    const state = await readPosition(connection, position.personalPosition);
    assert.ok(state.liquidity.gtn(0));
    assert.isBelow(await balance(ctx.c.assetVault), assetBefore, "токены ушли в пул");

    const asset = await getAccount(connection, ctx.c.assetVault);
    assert.equal(asset.delegate, null, "право на токены отозвано");
    assert.equal(await connection.getBalance(lpSignerPda(program.programId, ctx.c.vault)), 0, "остаток SOL возвращён");
    assert.isAbove(
      await connection.getBalance(payer.publicKey),
      authorityBefore - 0.5e9,
      "управляющий платит только реальный rent"
    );
  });

  it("вторую позицию открыть нельзя", async () => {
    try {
      const { call } = await openAround(-200, 200);
      await call.rpc();
      assert.fail("вторая позиция должна отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "PositionAlreadyOpen");
    }
  });

  it("позицией управляет только authority", async () => {
    const stranger = await fundedKeypair();
    try {
      await vaultCollectFees({ ...ctx.c, authority: stranger.publicKey }, position).signers([stranger]).rpc();
      assert.fail("чужой кошелёк не должен собирать комиссии");
    } catch (err) {
      assert.equal(errorCode(err), "Unauthorized");
    }
  });

  it("пока цена внутри диапазона, перестановка запрещена", async () => {
    try {
      await vaultAssertOutOfRange(ctx.c).rpc();
      assert.fail("цена внутри диапазона");
    } catch (err) {
      assert.equal(errorCode(err), "PositionInRange");
    }
  });

  it("collect_fees: комиссии приходят в vault, ликвидность не меняется", async () => {
    // Рынок торгует внутри диапазона в обе стороны и платит комиссии.
    const liquidityBefore = (await readPosition(connection, position.personalPosition)).liquidity;
    await marketSwap(true, 3_000_000);
    await marketSwap(false, 3_000_000);

    const [a0, a1] = orderedVaultAccounts(ctx.c);
    const before0 = await balance(a0);
    const before1 = await balance(a1);
    await vaultCollectFees(ctx.c, position).rpc();

    const gained0 = (await balance(a0)) - before0;
    const gained1 = (await balance(a1)) - before1;
    assert.isAbove(gained0, 0, "комиссия в token0");
    assert.isAbove(gained1, 0, "комиссия в token1");
    assert.isBelow(gained0, 3_000_000 * 0.0005 + 1, "не больше всей комиссии обмена");
    assert.ok((await readPosition(connection, position.personalPosition)).liquidity.eq(liquidityBefore));
  });

  it("закрыть позицию с ликвидностью нельзя", async () => {
    try {
      await vaultClosePosition(ctx.c, position).rpc();
      assert.fail("закрытие должно падать");
    } catch (err) {
      assert.match(String(err), /ClosePositionErr|Close position/i);
    }
  });

  it("decrease_liquidity: выводит часть позиции с защитой минимумом", async () => {
    const { liquidity } = await readPosition(connection, position.personalPosition);
    const part = liquidity.divn(4);
    const [a0] = orderedVaultAccounts(ctx.c);
    const before = await balance(a0);

    try {
      await vaultDecreaseLiquidity(ctx.c, position, part, new BN(1_000_000_000)).rpc();
      assert.fail("слишком высокий минимум должен отклоняться");
    } catch (err) {
      assert.match(String(err), /PriceSlippageCheck|slippage/i);
    }

    await vaultDecreaseLiquidity(ctx.c, position, part).rpc();
    assert.isAbove(await balance(a0), before);
    assert.ok((await readPosition(connection, position.personalPosition)).liquidity.eq(liquidity.sub(part)));
  });

  it("перестановка: цена вышла из диапазона, позиция открыта заново вокруг цены", async () => {
    // Крупная продажа выводит цену ниже диапазона [-100, 100].
    await marketSwap(true, 20_000_000_000);
    const moved = await readPool(connection, ctx.pool.poolId);
    assert.isBelow(moved.tick, -100, "цена ниже диапазона");

    const old = position;
    const { position: next } = await vaultRebalance(ctx.c, old, 100);
    position = next;

    assert.isNull(await connection.getAccountInfo(old.personalPosition), "старая позиция закрыта");
    assert.isNull(await connection.getAccountInfo(old.nftMint), "NFT старой позиции сожжён");

    const config = await program.account.vaultConfig.fetch(ctx.c.vault);
    assert.ok(config.positionNftMint.equals(next.nftMint));
    const { tick } = await readPool(connection, ctx.pool.poolId);
    assert.isAtLeast(tick, config.positionTickLower);
    assert.isBelow(tick, config.positionTickUpper);
    assert.ok((await readPosition(connection, next.personalPosition)).liquidity.gtn(0));

    try {
      await vaultAssertOutOfRange(ctx.c).rpc();
      assert.fail("новая позиция в диапазоне");
    } catch (err) {
      assert.equal(errorCode(err), "PositionInRange");
    }
  });

  it("sync_total_assets запрещён, пока средства размещены", async () => {
    try {
      await vaultSyncTotalAssets(ctx.c).rpc();
      assert.fail("открыта позиция");
    } catch (err) {
      assert.equal(errorCode(err), "PositionAlreadyOpen");
    }
  });

  it("полный выход: закрытие, обмен, обновление цены доли и вывод пользователя", async () => {
    const { liquidity } = await readPosition(connection, position.personalPosition);
    await vaultDecreaseLiquidity(ctx.c, position, liquidity).rpc();
    await vaultClosePosition(ctx.c, position).rpc();

    const config = await program.account.vaultConfig.fetch(ctx.c.vault);
    assert.ok(config.positionNftMint.equals(PublicKey.default), "позиции больше нет");

    try {
      await vaultSyncTotalAssets(ctx.c).rpc();
      assert.fail("на аккаунте второго токена есть средства");
    } catch (err) {
      assert.equal(errorCode(err), "QuoteNotEmpty");
    }

    const quote = await balance(ctx.c.quoteVault);
    const swap = await vaultSwap(ctx.c, { sellAsset: false, amountIn: new BN(quote), minimumOut: new BN(1) });
    await swap.rpc();
    assert.equal(await balance(ctx.c.quoteVault), 0);

    await vaultSyncTotalAssets(ctx.c).rpc();
    const synced = await program.account.vaultConfig.fetch(ctx.c.vault);
    const actual = await balance(ctx.c.assetVault);
    assert.equal(synced.totalAssets.toNumber(), actual);

    // Алиса — единственный держатель, поэтому получает всё, что есть в vault.
    await withdrawIx(ctx.vaultCtx, alice, DEPOSIT).rpc();
    assert.equal(await balance(alice.assetAccount), actual);
    assert.equal(await balance(ctx.c.assetVault), 0);
  });
});
