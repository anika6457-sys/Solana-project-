import { BN } from "@anchor-lang/core";
import { assert } from "chai";
import { getAccount, getMint } from "@solana/spl-token";
import { connection, depositIx, errorCode, program, setupUser, setupVault, userPda } from "./helpers";

const balance = async (account: Parameters<typeof getAccount>[1]) =>
  Number((await getAccount(connection, account)).amount);

describe("неделя 9: депозит", () => {
  let ctx: Awaited<ReturnType<typeof setupVault>>;
  let alice: Awaited<ReturnType<typeof setupUser>>;
  let bob: Awaited<ReturnType<typeof setupUser>>;

  before(async () => {
    ctx = await setupVault();
    alice = await setupUser(ctx, 1_000_000);
    bob = await setupUser(ctx, 1_000_000);
  });

  it("первый депозит: токены уходят в vault, доли выдаются 1:1", async () => {
    await depositIx(ctx, alice, 400_000).rpc();

    assert.equal(await balance(alice.assetAccount), 600_000);
    assert.equal(await balance(ctx.assetVault), 400_000);
    assert.equal(await balance(alice.shareAccount), 400_000);

    const config = await program.account.vaultConfig.fetch(ctx.vault);
    assert.equal(config.totalAssets.toNumber(), 400_000);
    const user = await program.account.userAccount.fetch(userPda(ctx.vault, alice.user.publicKey));
    assert.equal(user.deposited.toNumber(), 400_000);
  });

  it("второй пользователь получает долю пропорционально", async () => {
    await depositIx(ctx, bob, 100_000).rpc();

    assert.equal(await balance(bob.shareAccount), 100_000);
    assert.equal(Number((await getMint(connection, ctx.shareMint)).supply), 500_000);
  });

  it("нулевой депозит отклоняется", async () => {
    try {
      await depositIx(ctx, alice, 0).rpc();
      assert.fail("нулевой депозит должен отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "ZeroAmount");
    }
  });

  it("min_shares_out защищает от неожиданной цены доли", async () => {
    try {
      await depositIx(ctx, alice, 1_000, 1_001).rpc();
      assert.fail("должно упасть по SlippageExceeded");
    } catch (err) {
      assert.equal(errorCode(err), "SlippageExceeded");
    }
    assert.equal(await balance(ctx.assetVault), 500_000, "баланс vault не изменился");
  });

  it("нельзя внести токены через чужой PDA пользователя", async () => {
    try {
      await program.methods
        .deposit(new BN(1_000), new BN(0))
        .accountsPartial({
          owner: bob.user.publicKey,
          vault: ctx.vault,
          userAccount: userPda(ctx.vault, alice.user.publicKey),
          assetMint: ctx.assetMint,
          shareMint: ctx.shareMint,
          assetVault: ctx.assetVault,
          userAssetAccount: bob.assetAccount,
          userShareAccount: bob.shareAccount,
        })
        .signers([bob.user])
        .rpc();
      assert.fail("чужой PDA должен отклоняться");
    } catch (err) {
      assert.equal(errorCode(err), "ConstraintSeeds");
    }
  });
});
