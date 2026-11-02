import { BN } from "@anchor-lang/core";
import { assert } from "chai";
import { getAccount } from "@solana/spl-token";
import { connection, depositIx, errorCode, fundedKeypair, payer, program, setupUser, setupVault, withdrawIx } from "./helpers";
import { setupPool, setupVaultWithPool } from "./pool-helpers";
import { readPool } from "../scripts/lib/clmm";
import { vaultSwap } from "../scripts/lib/vault";

const balance = async (account: Parameters<typeof getAccount>[1]) =>
  Number((await getAccount(connection, account)).amount);

describe("неделя 12: обмен из vault через Raydium", () => {
  let ctx: Awaited<ReturnType<typeof setupVaultWithPool>>;
  let alice: Awaited<ReturnType<typeof setupUser>>;

  before(async () => {
    ctx = await setupVaultWithPool(true);
    alice = await setupUser(ctx.vaultCtx, 10_000_000);
    await depositIx(ctx.vaultCtx, alice, 10_000_000).rpc();
  });

  it("configure_pool: запоминает пул и создаёт аккаунт второго токена", async () => {
    const config = await program.account.vaultConfig.fetch(ctx.c.vault);
    assert.ok(config.pool.equals(ctx.pool.poolId));
    assert.ok(config.quoteMint.equals(ctx.quoteMint));
    const quote = await getAccount(connection, ctx.c.quoteVault);
    assert.ok(quote.owner.equals(ctx.c.vault));
    assert.equal(Number(quote.amount), 0);
  });

  it("обмен основного токена на второй: PDA подписывает CPI в Raydium", async () => {
    const before = await readPool(connection, ctx.pool.poolId);
    const call = await vaultSwap(ctx.c, {
      sellAsset: true,
      amountIn: new BN(4_000_000),
      minimumOut: new BN(3_900_000),
    });
    await call.rpc();

    assert.equal(await balance(ctx.c.assetVault), 6_000_000);
    const quote = await balance(ctx.c.quoteVault);
    assert.isAtLeast(quote, 3_900_000);
    assert.isBelow(quote, 4_000_000, "комиссия пула удержана");
    assert.ok((await readPool(connection, ctx.pool.poolId)).sqrtPriceX64.lt(before.sqrtPriceX64));

    const config = await program.account.vaultConfig.fetch(ctx.c.vault);
    assert.equal(config.totalAssets.toNumber(), 10_000_000, "учёт долей обмен не меняет");
  });

  it("слишком высокий минимум: обмен откатывается целиком", async () => {
    const assetBefore = await balance(ctx.c.assetVault);
    const quoteBefore = await balance(ctx.c.quoteVault);
    try {
      const call = await vaultSwap(ctx.c, {
        sellAsset: true,
        amountIn: new BN(1_000_000),
        minimumOut: new BN(1_000_001),
      });
      await call.rpc();
      assert.fail("обмен должен откатиться");
    } catch (err) {
      assert.match(String(err), /TooLittleOutputReceived/);
    }
    assert.equal(await balance(ctx.c.assetVault), assetBefore);
    assert.equal(await balance(ctx.c.quoteVault), quoteBefore);
  });

  it("минимум обязателен", async () => {
    try {
      const call = await vaultSwap(ctx.c, { sellAsset: true, amountIn: new BN(1_000), minimumOut: new BN(0) });
      await call.rpc();
      assert.fail("нулевой минимум должен отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "MinimumOutRequired");
    }
  });

  it("обмен доступен только управляющему", async () => {
    const stranger = await fundedKeypair();
    try {
      const call = await vaultSwap(
        { ...ctx.c, authority: stranger.publicKey },
        { sellAsset: true, amountIn: new BN(1_000), minimumOut: new BN(1) }
      );
      await call.signers([stranger]).rpc();
      assert.fail("чужой кошелёк не должен управлять обменом");
    } catch (err) {
      assert.equal(errorCode(err), "Unauthorized");
    }
  });

  it("выход только на аккаунт vault: средства нельзя увести наружу", async () => {
    try {
      const call = await vaultSwap(ctx.c, { sellAsset: true, amountIn: new BN(1_000), minimumOut: new BN(1) });
      await call.accountsPartial({ outputTokenAccount: ctx.account1 }).rpc();
      assert.fail("внешний аккаунт должен отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "NotVaultAccount");
    }
  });

  it("пока средства в другом токене, вывод ограничен свободным остатком", async () => {
    try {
      await withdrawIx(ctx.vaultCtx, alice, 10_000_000).rpc();
      assert.fail("свободных токенов не хватает");
    } catch (err) {
      assert.equal(errorCode(err), "InsufficientIdleAssets");
    }
    await withdrawIx(ctx.vaultCtx, alice, 1_000_000).rpc();
    assert.equal(await balance(alice.assetAccount), 1_000_000);
  });

  it("обратный обмен возвращает средства в основной токен", async () => {
    const quote = await balance(ctx.c.quoteVault);
    const assetBefore = await balance(ctx.c.assetVault);
    const call = await vaultSwap(ctx.c, {
      sellAsset: false,
      amountIn: new BN(quote),
      minimumOut: new BN(Math.floor(quote * 0.99)),
    });
    await call.rpc();
    assert.equal(await balance(ctx.c.quoteVault), 0);
    assert.isAbove(await balance(ctx.c.assetVault), assetBefore);
  });

  it("работает и когда основной токен — token1 пула", async () => {
    const other = await setupVaultWithPool(false);
    const bob = await setupUser(other.vaultCtx, 1_000_000);
    await depositIx(other.vaultCtx, bob, 1_000_000).rpc();
    const call = await vaultSwap(other.c, {
      sellAsset: true,
      amountIn: new BN(500_000),
      minimumOut: new BN(490_000),
    });
    await call.rpc();
    assert.isAtLeast(await balance(other.c.quoteVault), 490_000);
  });

  it("configure_pool отклоняет чужого управляющего", async () => {
    const stranger = await fundedKeypair();
    const { pool } = await setupPool();
    const fresh = await setupVault(pool.mint0);
    try {
      await program.methods
        .configurePool()
        .accountsPartial({
          authority: stranger.publicKey,
          vault: fresh.vault,
          quoteMint: pool.mint1,
          poolState: pool.poolId,
        })
        .signers([stranger])
        .rpc();
      assert.fail("чужой кошелёк не должен настраивать vault");
    } catch (err) {
      assert.equal(errorCode(err), "Unauthorized");
    }
  });

  it("configure_pool отклоняет пул с другими токенами", async () => {
    const fresh = await setupVault();
    try {
      await program.methods
        .configurePool()
        .accountsPartial({
          authority: payer.publicKey,
          vault: fresh.vault,
          quoteMint: ctx.pool.mint1,
          poolState: ctx.pool.poolId,
        })
        .rpc();
      assert.fail("пул без основного токена vault должен отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "InvalidPool");
    }
  });

  it("configure_pool отклоняет аккаунт, не принадлежащий Raydium", async () => {
    const fresh = await setupVault();
    try {
      await program.methods
        .configurePool()
        .accountsPartial({
          authority: payer.publicKey,
          vault: fresh.vault,
          quoteMint: ctx.pool.mint1,
          poolState: fresh.assetVault,
        })
        .rpc();
      assert.fail("поддельный пул должен отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "InvalidPool");
    }
  });
});
