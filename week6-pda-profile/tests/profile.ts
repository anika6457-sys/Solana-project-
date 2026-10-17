import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { Profile } from "../target/types/profile";

describe("profile (PDA)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.profile as Program<Profile>;

  const owner = provider.wallet.publicKey;

  // Адрес профиля выводится из кошелька — хранить его нигде не нужно.
  const profilePda = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), wallet.toBuffer()],
      program.programId
    );

  async function fundedKeypair() {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
    return kp;
  }

  it("create_profile: создаёт аккаунт по адресу PDA", async () => {
    await program.methods.createProfile("Sanzhik", "Изучаю Solana").accounts({ owner }).rpc();

    const [pda, bump] = profilePda(owner);
    const profile = await program.account.profile.fetch(pda);
    assert.ok(profile.owner.equals(owner));
    assert.equal(profile.name, "Sanzhik");
    assert.equal(profile.bio, "Изучаю Solana");
    assert.equal(profile.bump, bump, "сохранён канонический bump");
  });

  it("профиль находится только по кошельку владельца", async () => {
    const [pda] = profilePda(owner);
    const all = await program.account.profile.all();
    assert.ok(all.some((p) => p.publicKey.equals(pda)));
  });

  it("update_profile: владелец меняет содержимое", async () => {
    await program.methods
      .updateProfile("Sanzhik", "Неделя 6: PDA и seeds")
      .accounts({ owner })
      .rpc();

    const [pda] = profilePda(owner);
    const profile = await program.account.profile.fetch(pda);
    assert.equal(profile.bio, "Неделя 6: PDA и seeds");
  });

  it("повторный create_profile для того же кошелька невозможен", async () => {
    try {
      await program.methods.createProfile("Again", "").accounts({ owner }).rpc();
      assert.fail("второй профиль не должен создаваться");
    } catch (err) {
      assert.match(String(err), /already in use|custom program error: 0x0/);
    }
  });

  it("чужой кошелёк не может изменить чужой профиль", async () => {
    const stranger = await fundedKeypair();
    const [victimPda] = profilePda(owner);
    try {
      await program.methods
        .updateProfile("Hacker", "")
        .accountsPartial({ profile: victimPda, owner: stranger.publicKey })
        .signers([stranger])
        .rpc();
      assert.fail("чужой кошелёк не должен менять профиль");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.equal((err as anchor.AnchorError).error.errorCode.code, "ConstraintSeeds");
    }
  });

  it("require!: слишком длинное имя отклоняется", async () => {
    const user = await fundedKeypair();
    try {
      await program.methods
        .createProfile("x".repeat(33), "")
        .accounts({ owner: user.publicKey })
        .signers([user])
        .rpc();
      assert.fail("имя длиннее 32 байт должно отклоняться");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.equal((err as anchor.AnchorError).error.errorCode.code, "NameTooLong");
    }
  });
});
