import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { Counter } from "../target/types/counter";

describe("counter (Anchor)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.counter as Program<Counter>;

  const counter = Keypair.generate();
  const authority = provider.wallet.publicKey;

  it("initialize: создаёт счётчик и запоминает создателя", async () => {
    await program.methods
      .initialize()
      .accounts({ counter: counter.publicKey, authority })
      .signers([counter])
      .rpc();

    const state = await program.account.counter.fetch(counter.publicKey);
    assert.equal(state.count.toNumber(), 0);
    assert.ok(state.authority.equals(authority));
  });

  it("increment: увеличивает значение от имени создателя", async () => {
    for (let i = 0; i < 3; i++) {
      await program.methods
        .increment()
        .accounts({ counter: counter.publicKey, authority })
        .rpc();
    }
    const state = await program.account.counter.fetch(counter.publicKey);
    assert.equal(state.count.toNumber(), 3);
  });

  it("increment: отказывает чужому кошельку (has_one)", async () => {
    const stranger = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      stranger.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    try {
      await program.methods
        .increment()
        .accounts({ counter: counter.publicKey, authority: stranger.publicKey })
        .signers([stranger])
        .rpc();
      assert.fail("чужой кошелёк не должен увеличивать счётчик");
    } catch (err) {
      assert.instanceOf(err, anchor.AnchorError);
      assert.equal((err as anchor.AnchorError).error.errorCode.code, "Unauthorized");
    }

    const state = await program.account.counter.fetch(counter.publicKey);
    assert.equal(state.count.toNumber(), 3);
  });
});
