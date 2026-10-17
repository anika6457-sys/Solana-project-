// Неделя 4 — клиент для нативной программы-счётчика.
//
// 1. Резервирует аккаунт на 8 байт и передаёт его во владение программе.
// 2. Отправляет одну инструкцию инициализации (байт 0) и три increment (байт 1).
// 3. Читает данные аккаунта и распаковывает u64 из little-endian.
//
// Запуск: PROGRAM_ID=<адрес> npm run interact

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const COUNTER_SIZE = 8;
const IX_RESET = 0;
const IX_INCREMENT = 1;

function loadPayer(): Keypair {
  const file =
    process.env.KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
  return Keypair.fromSecretKey(secret);
}

function counterIx(programId: PublicKey, counter: PublicKey, tag: number) {
  return new TransactionInstruction({
    programId,
    keys: [{ pubkey: counter, isSigner: false, isWritable: true }],
    data: Buffer.from([tag]),
  });
}

async function readCounter(connection: Connection, counter: PublicKey) {
  const info = await connection.getAccountInfo(counter, "confirmed");
  if (!info) throw new Error("аккаунт счётчика не найден");
  return info.data.readBigUInt64LE(0);
}

async function main() {
  if (!process.env.PROGRAM_ID) throw new Error("укажите PROGRAM_ID");
  const programId = new PublicKey(process.env.PROGRAM_ID);
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadPayer();

  const balance = await connection.getBalance(payer.publicKey);
  if (balance < LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  console.log("Программа:", programId.toBase58());
  console.log("Плательщик:", payer.publicKey.toBase58());

  // Шаг 1: резервируем аккаунт нужного размера и отдаём его программе.
  const counter = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(COUNTER_SIZE);
  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: counter.publicKey,
      lamports: rent,
      space: COUNTER_SIZE,
      programId,
    })
  );
  const createSig = await sendAndConfirmTransaction(connection, createTx, [payer, counter]);
  console.log("Аккаунт счётчика:", counter.publicKey.toBase58());
  console.log("  создан, tx:", createSig);

  // Шаг 2: один вызов инициализации и три вызова увеличения подряд.
  const tx = new Transaction()
    .add(counterIx(programId, counter.publicKey, IX_RESET))
    .add(counterIx(programId, counter.publicKey, IX_INCREMENT))
    .add(counterIx(programId, counter.publicKey, IX_INCREMENT))
    .add(counterIx(programId, counter.publicKey, IX_INCREMENT));
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log("reset + 3 x increment, tx:", sig);

  // Шаг 3: читаем и распаковываем u64.
  const value = await readCounter(connection, counter.publicKey);
  console.log("Значение счётчика:", value.toString());

  const logs = (await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  }))?.meta?.logMessages ?? [];
  console.log("Логи программы:");
  for (const line of logs.filter((l) => l.startsWith("Program log:"))) {
    console.log("  " + line);
  }

  if (value !== 3n) throw new Error(`ожидалось 3, получено ${value}`);
  console.log("OK: счётчик равен 3");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
