import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
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

type VaultCtx = Awaited<ReturnType<typeof setupVault>>;

/** Новый пользователь с токенами, токен-аккаунтом долей и PDA в vault. */
export async function setupUser(ctx: VaultCtx, tokens: number) {
  const user = await fundedKeypair();
  const asset = await getOrCreateAssociatedTokenAccount(connection, payer, ctx.assetMint, user.publicKey);
  const share = await getOrCreateAssociatedTokenAccount(connection, payer, ctx.shareMint, user.publicKey);
  if (tokens > 0) await mintTo(connection, payer, ctx.assetMint, asset.address, payer, tokens);
  await program.methods
    .createUserAccount()
    .accounts({ owner: user.publicKey, vault: ctx.vault })
    .signers([user])
    .rpc();
  return { user, assetAccount: asset.address, shareAccount: share.address };
}

/** Депозит от имени пользователя. */
export function depositIx(
  ctx: VaultCtx,
  u: Awaited<ReturnType<typeof setupUser>>,
  amount: number,
  minShares = 0
) {
  return program.methods
    .deposit(new anchor.BN(amount), new anchor.BN(minShares))
    .accountsPartial({
      owner: u.user.publicKey,
      vault: ctx.vault,
      assetMint: ctx.assetMint,
      shareMint: ctx.shareMint,
      assetVault: ctx.assetVault,
      userAssetAccount: u.assetAccount,
      userShareAccount: u.shareAccount,
    })
    .signers([u.user]);
}

/** Вывод от имени пользователя. */
export function withdrawIx(
  ctx: VaultCtx,
  u: Awaited<ReturnType<typeof setupUser>>,
  shares: number,
  minAmount = 0
) {
  return program.methods
    .withdraw(new anchor.BN(shares), new anchor.BN(minAmount))
    .accountsPartial({
      owner: u.user.publicKey,
      vault: ctx.vault,
      assetMint: ctx.assetMint,
      shareMint: ctx.shareMint,
      assetVault: ctx.assetVault,
      userAssetAccount: u.assetAccount,
      userShareAccount: u.shareAccount,
    })
    .signers([u.user]);
}

/** Код ошибки Anchor из исключения, иначе текст исключения. */
export const errorCode = (err: unknown): string =>
  (err as anchor.AnchorError).error?.errorCode?.code ?? String(err);

/** Создаёт vault для токена (по умолчанию — для нового). */
export async function setupVault(mint?: PublicKey) {
  const assetMint = mint ?? (await newMint());
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
