// Неделя 13: полный путь vault на заданной сети.
// Депозит → обмен → позиция → комиссии → выход цены из диапазона → перестановка →
// закрытие → обновление цены доли → вывод. Подписи транзакций сохраняются в файл.
//
// Перед запуском: anchor deploy и scripts/setup-pool.ts на той же сети.
// Запуск: [RPC_URL=https://api.devnet.solana.com] yarn tsx scripts/demo.ts

import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { directSwapIx, liquidityForAmounts, poolAddresses, priceFromSqrt, readPool, readPosition } from "./lib/clmm";
import {
  VaultPoolContext,
  orderedVaultAccounts,
  quoteVaultPda,
  vaultClosePosition,
  vaultCollectFees,
  vaultDecreaseLiquidity,
  vaultOpenPosition,
  vaultRebalance,
  vaultSwap,
  vaultSyncTotalAssets,
} from "./lib/vault";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const CLUSTER = RPC_URL.includes("devnet") ? "devnet" : "localnet";
const ROOT = path.join(__dirname, "..");
const DEPOSIT = 40_000_000; // 40 токенов
const MARKET_MOVE = 20_000_000_000; // 20 000 токенов: выводит цену из диапазона

const txs: Record<string, string> = {};
function record(step: string, sig: string) {
  txs[step] = sig;
  console.log(`${step}: ${sig}`);
}

async function main() {
  const walletFile = process.env.KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletFile, "utf8"))));
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target", "idl", "vault.json"), "utf8"));
  const program = new Program(idl, provider) as Program<any>;

  const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${CLUSTER}.json`), "utf8"));
  const pool = poolAddresses(new PublicKey(deployment.mint0), new PublicKey(deployment.mint1));
  const assetMint = pool.mint0;
  const seed = (name: string, ...rest: Buffer[]) =>
    PublicKey.findProgramAddressSync([Buffer.from(name), ...rest], program.programId)[0];
  const vault = seed("vault", assetMint.toBuffer());
  const shareMint = seed("share", vault.toBuffer());
  const assetVault = seed("asset_vault", vault.toBuffer());
  const c: VaultPoolContext = {
    program,
    authority: owner.publicKey,
    vault,
    assetMint,
    assetVault,
    quoteVault: quoteVaultPda(program.programId, vault),
    pool,
  };
  console.log(`Сеть: ${CLUSTER}, программа: ${program.programId.toBase58()}, vault: ${vault.toBase58()}`);

  const ata = async (mint: PublicKey) =>
    (await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey)).address;
  const account0 = await ata(pool.mint0);
  const account1 = await ata(pool.mint1);
  const balance = async (a: PublicKey) => new BN((await getAccount(connection, a)).amount.toString());

  if (!(await connection.getAccountInfo(vault))) {
    record("initialize_vault", await program.methods.initializeVault().accountsPartial({ authority: owner.publicKey, assetMint }).rpc());
    record(
      "configure_pool",
      await program.methods
        .configurePool()
        .accountsPartial({ authority: owner.publicKey, vault, quoteMint: pool.mint1, poolState: pool.poolId })
        .rpc()
    );
  }
  const userShare = await ata(shareMint);
  if (!(await connection.getAccountInfo(seed("user", vault.toBuffer(), owner.publicKey.toBuffer())))) {
    record("create_user_account", await program.methods.createUserAccount().accounts({ owner: owner.publicKey, vault }).rpc());
  }
  await mintTo(connection, owner, assetMint, account0, owner, DEPOSIT);

  const userAccounts = {
    owner: owner.publicKey,
    vault,
    assetMint,
    shareMint,
    assetVault,
    userAssetAccount: account0,
    userShareAccount: userShare,
  };
  record("deposit", await program.methods.deposit(new BN(DEPOSIT), new BN(0)).accountsPartial(userAccounts).rpc());

  record(
    "swap",
    await (
      await vaultSwap(c, {
        sellAsset: true,
        amountIn: new BN(DEPOSIT / 2),
        minimumOut: new BN(Math.floor((DEPOSIT / 2) * 0.98)),
      })
    ).rpc()
  );

  const start = await readPool(connection, pool.poolId);
  const center = Math.floor(start.tick / 10) * 10;
  const [a0, a1] = orderedVaultAccounts(c);
  const max0 = await balance(a0);
  const max1 = await balance(a1);
  const opened = vaultOpenPosition(c, {
    tickLower: center - 100,
    tickUpper: center + 100,
    liquidity: liquidityForAmounts(start.sqrtPriceX64, center - 100, center + 100, max0, max1).muln(99).divn(100),
    maxAmount0: max0,
    maxAmount1: max1,
  });
  record("open_position", await opened.call.rpc());

  const market = async (zeroForOne: boolean, amountIn: number) => {
    const ix = await directSwapIx({ connection, pool, owner: owner.publicKey, account0, account1, zeroForOne, amountIn: new BN(amountIn) });
    return sendAndConfirmTransaction(
      connection,
      new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix),
      [owner]
    );
  };
  record("market_swap_1", await market(true, 3_000_000));
  record("market_swap_2", await market(false, 3_000_000));

  const fee0 = await balance(a0);
  const fee1 = await balance(a1);
  record("collect_fees", await vaultCollectFees(c, opened.position).rpc());
  console.log(`  комиссии: token0 +${(await balance(a0)).sub(fee0)}, token1 +${(await balance(a1)).sub(fee1)}`);

  record("market_move", await market(true, MARKET_MOVE));
  const moved = await readPool(connection, pool.poolId);
  console.log(`  цена ${priceFromSqrt(moved.sqrtPriceX64).toFixed(5)}, тик ${moved.tick}: вне диапазона позиции`);

  const rebalanced = await vaultRebalance(c, opened.position, 100);
  record("rebalance_withdraw", rebalanced.withdrawTx);
  record("rebalance_close", rebalanced.closeTx);
  record("rebalance_swap", rebalanced.swapTx);
  record("rebalance_open", rebalanced.openTx);
  console.log(`  новый диапазон: [${rebalanced.position.tickLower}, ${rebalanced.position.tickUpper}]`);

  const { liquidity } = await readPosition(connection, rebalanced.position.personalPosition);
  record("decrease_liquidity", await vaultDecreaseLiquidity(c, rebalanced.position, liquidity).rpc());
  record("close_position", await vaultClosePosition(c, rebalanced.position).rpc());
  record(
    "swap_back",
    await (await vaultSwap(c, { sellAsset: false, amountIn: await balance(c.quoteVault), minimumOut: new BN(1) })).rpc()
  );
  record("sync_total_assets", await vaultSyncTotalAssets(c).rpc());

  const shares = await balance(userShare);
  const walletBefore = await balance(account0);
  record("withdraw", await program.methods.withdraw(shares, new BN(0)).accountsPartial(userAccounts).rpc());
  console.log(`Внесено ${DEPOSIT}, выплачено при выводе ${(await balance(account0)).sub(walletBefore)}`);

  const file = path.join(ROOT, "deployments", `${CLUSTER}-demo.json`);
  fs.writeFileSync(file, JSON.stringify({ program: program.programId.toBase58(), vault: vault.toBase58(), pool: pool.poolId.toBase58(), txs }, null, 2) + "\n");
  console.log("Сохранено:", file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
