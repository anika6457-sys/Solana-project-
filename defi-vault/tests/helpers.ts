import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { Vault } from "../target/types/vault";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
export const program = anchor.workspace.vault as Program<Vault>;
export const connection = provider.connection;
export const payer = (provider.wallet as anchor.Wallet).payer;

const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];

export const vaultPda = (assetMint: PublicKey) =>
  pda(Buffer.from("vault"), assetMint.toBuffer());
export const shareMintPda = (vault: PublicKey) =>
  pda(Buffer.from("share"), vault.toBuffer());
export const assetVaultPda = (vault: PublicKey) =>
  pda(Buffer.from("asset_vault"), vault.toBuffer());
export const userPda = (vault: PublicKey, owner: PublicKey) =>
  pda(Buffer.from("user"), vault.toBuffer(), owner.toBuffer());

export async function fundedKeypair(sol = 2) {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  return kp;
}

export const newMint = (decimals = 6) =>
  createMint(connection, payer, payer.publicKey, null, decimals);

/** Создаёт новый токен и vault для него. */
export async function setupVault() {
  const assetMint = await newMint();
  const vault = vaultPda(assetMint);
  await program.methods
    .initializeVault()
    .accounts({ authority: payer.publicKey, assetMint })
    .rpc();
  return {
    assetMint,
    vault,
    shareMint: shareMintPda(vault),
    assetVault: assetVaultPda(vault),
  };
}
