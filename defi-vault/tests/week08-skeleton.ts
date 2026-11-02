import { assert } from "chai";
import { getAccount, getMint } from "@solana/spl-token";
import { connection, fundedKeypair, payer, program, setupVault, userPda } from "./helpers";

describe("неделя 8: каркас vault", () => {
  let ctx: Awaited<ReturnType<typeof setupVault>>;

  it("initialize_vault: создаёт настройки, share-токен и хранилище", async () => {
    ctx = await setupVault();

    const config = await program.account.vaultConfig.fetch(ctx.vault);
    assert.ok(config.authority.equals(payer.publicKey));
    assert.ok(config.assetMint.equals(ctx.assetMint));
    assert.ok(config.shareMint.equals(ctx.shareMint));
    assert.equal(config.totalAssets.toNumber(), 0);

    const share = await getMint(connection, ctx.shareMint);
    assert.ok(share.mintAuthority?.equals(ctx.vault), "share-токен выпускает только vault");
    assert.equal(share.decimals, 6);
    assert.equal(Number(share.supply), 0);

    const store = await getAccount(connection, ctx.assetVault);
    assert.ok(store.owner.equals(ctx.vault));
    assert.ok(store.mint.equals(ctx.assetMint));
  });

  it("второй vault для того же токена создать нельзя", async () => {
    try {
      await program.methods
        .initializeVault()
        .accounts({ authority: payer.publicKey, assetMint: ctx.assetMint })
        .rpc();
      assert.fail("повторная инициализация должна падать");
    } catch (err) {
      assert.match(String(err), /Program 1{32} failed/, "падает создание занятого аккаунта");
    }
  });

  it("create_user_account: создаёт PDA пользователя", async () => {
    const user = await fundedKeypair();
    await program.methods
      .createUserAccount()
      .accounts({ owner: user.publicKey, vault: ctx.vault })
      .signers([user])
      .rpc();

    const account = await program.account.userAccount.fetch(userPda(ctx.vault, user.publicKey));
    assert.ok(account.owner.equals(user.publicKey));
    assert.ok(account.vault.equals(ctx.vault));
    assert.equal(account.deposited.toNumber(), 0);
  });
});
