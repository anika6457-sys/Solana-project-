import { assert } from "chai";
import { getAccount, getMint, transfer } from "@solana/spl-token";
import {
  connection,
  depositIx,
  errorCode,
  payer,
  program,
  setupUser,
  setupVault,
  userPda,
  withdrawIx,
} from "./helpers";

const balance = async (account: Parameters<typeof getAccount>[1]) =>
  Number((await getAccount(connection, account)).amount);

describe("неделя 10: вывод", () => {
  let ctx: Awaited<ReturnType<typeof setupVault>>;
  let alice: Awaited<ReturnType<typeof setupUser>>;
  let bob: Awaited<ReturnType<typeof setupUser>>;

  before(async () => {
    ctx = await setupVault();
    alice = await setupUser(ctx, 1_000_000);
    bob = await setupUser(ctx, 1_000_000);
    await depositIx(ctx, alice, 600_000).rpc();
    await depositIx(ctx, bob, 200_000).rpc();
  });

  it("частичный вывод: доли сжигаются, токены возвращаются", async () => {
    await withdrawIx(ctx, alice, 100_000).rpc();

    assert.equal(await balance(alice.shareAccount), 500_000);
    assert.equal(await balance(alice.assetAccount), 500_000);
    assert.equal(await balance(ctx.assetVault), 700_000);
    assert.equal(Number((await getMint(connection, ctx.shareMint)).supply), 700_000);

    const config = await program.account.vaultConfig.fetch(ctx.vault);
    assert.equal(config.totalAssets.toNumber(), 700_000);
    const user = await program.account.userAccount.fetch(userPda(ctx.vault, alice.user.publicKey));
    assert.equal(user.withdrawn.toNumber(), 100_000);
  });

  it("нельзя сжечь больше долей, чем есть", async () => {
    try {
      await withdrawIx(ctx, bob, 200_001).rpc();
      assert.fail("должно упасть");
    } catch (err) {
      assert.equal(errorCode(err), "InsufficientShares");
    }
  });

  it("min_amount_out защищает от меньшей выплаты", async () => {
    try {
      await withdrawIx(ctx, bob, 1_000, 1_001).rpc();
      assert.fail("должно упасть");
    } catch (err) {
      assert.equal(errorCode(err), "SlippageExceeded");
    }
  });

  it("чужие токен-аккаунты использовать нельзя", async () => {
    try {
      await withdrawIx(ctx, { ...bob, shareAccount: alice.shareAccount }, 1_000).rpc();
      assert.fail("должно упасть");
    } catch (err) {
      assert.equal(errorCode(err), "ConstraintTokenOwner");
    }
    assert.equal(await balance(alice.shareAccount), 500_000);
  });

  it("прямой перевод в хранилище не меняет цену доли", async () => {
    const donor = await setupUser(ctx, 50_000);
    await transfer(connection, payer, donor.assetAccount, ctx.assetVault, donor.user, 50_000);
    await withdrawIx(ctx, bob, 200_000).rpc();
    assert.equal(await balance(bob.assetAccount), 1_000_000, "Боб получил ровно внесённое");
  });

  it("после полного вывода всех долей vault пуст по учёту", async () => {
    await withdrawIx(ctx, alice, 500_000).rpc();
    const config = await program.account.vaultConfig.fetch(ctx.vault);
    assert.equal(config.totalAssets.toNumber(), 0);
    assert.equal(Number((await getMint(connection, ctx.shareMint)).supply), 0);
    assert.equal(await balance(alice.assetAccount), 1_000_000);
  });
});
