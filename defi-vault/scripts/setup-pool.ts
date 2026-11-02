// Неделя 11: создаёт два тестовых токена и CLMM-пул Raydium, добавляет стартовую ликвидность.
// Результат сохраняется в deployments/<cluster>.json и используется следующими скриптами.
//
// Запуск в devnet:  RPC_URL=https://api.devnet.solana.com yarn tsx scripts/setup-pool.ts
// Локально:         scripts/start-validator.sh, затем yarn tsx scripts/setup-pool.ts

import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createPoolIx,
  liquidityForAmounts,
  openPositionIx,
  poolAddresses,
  priceFromSqrt,
  readPool,
  sortMints,
} from "./lib/clmm";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const CLUSTER = RPC_URL.includes("devnet") ? "devnet" : "localnet";
const DECIMALS = 6;
const INITIAL_PRICE = 1;
const SUPPLY = 1_000_000_000_000; // 1 000 000 токенов
const SEED_AMOUNT = new BN(100_000_000_000); // 100 000 токенов каждого вида
const SEED_TICK_LOWER = -1000;
const SEED_TICK_UPPER = 1000;

async function main() {
  const walletFile = process.env.KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletFile, "utf8"))));
  const connection = new Connection(RPC_URL, "confirmed");
  console.log(`Сеть: ${CLUSTER}, кошелёк: ${owner.publicKey.toBase58()}`);

  const a = await createMint(connection, owner, owner.publicKey, null, DECIMALS);
  const b = await createMint(connection, owner, owner.publicKey, null, DECIMALS);
  const [mint0, mint1] = sortMints(a, b);
  console.log("token0:", mint0.toBase58());
  console.log("token1:", mint1.toBase58());

  const account0 = (await getOrCreateAssociatedTokenAccount(connection, owner, mint0, owner.publicKey)).address;
  const account1 = (await getOrCreateAssociatedTokenAccount(connection, owner, mint1, owner.publicKey)).address;
  await mintTo(connection, owner, mint0, account0, owner, SUPPLY);
  await mintTo(connection, owner, mint1, account1, owner, SUPPLY);

  const pool = poolAddresses(mint0, mint1);
  const createSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createPoolIx(owner.publicKey, mint0, mint1, DECIMALS, INITIAL_PRICE)),
    [owner]
  );
  console.log("Пул:", pool.poolId.toBase58());
  console.log("  tx:", createSig);

  const created = await readPool(connection, pool.poolId);
  const liquidity = liquidityForAmounts(created.sqrtPriceX64, SEED_TICK_LOWER, SEED_TICK_UPPER, SEED_AMOUNT, SEED_AMOUNT);
  const { ix, nftMint } = openPositionIx({
    pool,
    owner: owner.publicKey,
    account0,
    account1,
    tickLower: SEED_TICK_LOWER,
    tickUpper: SEED_TICK_UPPER,
    liquidity,
    maxAmount0: SEED_AMOUNT.muln(2),
    maxAmount1: SEED_AMOUNT.muln(2),
  });
  const seedSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix),
    [owner, nftMint]
  );
  console.log(`Стартовая ликвидность в диапазоне [${SEED_TICK_LOWER}, ${SEED_TICK_UPPER}], tx: ${seedSig}`);

  const state = await readPool(connection, pool.poolId);
  console.log(`Цена: ${priceFromSqrt(state.sqrtPriceX64)}, тик: ${state.tick}, ликвидность: ${state.liquidity.toString()}`);

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${CLUSTER}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        cluster: CLUSTER,
        mint0: mint0.toBase58(),
        mint1: mint1.toBase58(),
        pool: pool.poolId.toBase58(),
        createPoolTx: createSig,
        seedLiquidityTx: seedSig,
      },
      null,
      2
    ) + "\n"
  );
  console.log("Сохранено:", file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
