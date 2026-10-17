// Неделя 7 — собственный токен на Token Extensions (Token-2022).
//
// Mint создаётся с расширением MetadataPointer, а имя/символ/URI хранятся
// прямо в аккаунте минта — без отдельной программы метаданных.
// Затем токены выпускаются создателю и часть переводится второму кошельку
// через ассоциированные токен-аккаунты (ATA).
//
// Запуск: npm run create-token   (RPC_URL по умолчанию — локальный валидатор)

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  getAccount,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  getTokenMetadata,
  mintTo,
  transferChecked,
} from "@solana/spl-token";
import {
  TokenMetadata,
  createInitializeInstruction,
  pack,
} from "@solana/spl-token-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DECIMALS = 9;
const MINT_AMOUNT = 1_000n; // целых токенов
const TRANSFER_AMOUNT = 250n;

function loadPayer(): Keypair {
  const file =
    process.env.KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

const toBase = (whole: bigint) => whole * 10n ** BigInt(DECIMALS);
const fromBase = (amount: bigint) => Number(amount) / 10 ** DECIMALS;

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadPayer();
  if ((await connection.getBalance(payer.publicKey)) < LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;

  const metadata: TokenMetadata = {
    updateAuthority: payer.publicKey,
    mint,
    name: "Sanzhik Token",
    symbol: "SNZ",
    uri: "https://example.com/snz.json",
    additionalMetadata: [["course", "Solana week 7"]],
  };

  // Размер: сам mint + расширение MetadataPointer. Метаданные (TLV) дописываются
  // позже инструкцией initialize, поэтому rent считаем сразу на полный размер.
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  // Строгий порядок инструкций в одной транзакции.
  const tx = new Transaction().add(
    // 1. создаём аккаунт под mint, владелец — Token Extensions Program
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. указатель метаданных → сам mint
    createInitializeMetadataPointerInstruction(
      mint,
      payer.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    ),
    // 3. инициализация минта
    createInitializeMintInstruction(mint, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    // 4. запись самих метаданных в аккаунт минта
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      mint,
      mintAuthority: payer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    })
  );
  const createSig = await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
  console.log("Mint создан:", mint.toBase58());
  console.log("  tx:", createSig);

  const onChain = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log("Метаданные из аккаунта минта:");
  console.log(`  name=${onChain?.name}  symbol=${onChain?.symbol}  uri=${onChain?.uri}`);

  // Выпуск токенов создателю через его ATA.
  const ownerAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, payer.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
  );
  const mintSig = await mintTo(
    connection, payer, mint, ownerAta.address, payer, toBase(MINT_AMOUNT), [], undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`Выпущено ${MINT_AMOUNT} SNZ на ATA создателя ${ownerAta.address.toBase58()}`);
  console.log("  tx:", mintSig);

  // Перевод части токенов второму кошельку.
  const receiver = Keypair.generate();
  const receiverAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, receiver.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
  );
  const transferSig = await transferChecked(
    connection, payer, ownerAta.address, mint, receiverAta.address, payer,
    toBase(TRANSFER_AMOUNT), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
  );
  console.log(`Переведено ${TRANSFER_AMOUNT} SNZ кошельку ${receiver.publicKey.toBase58()}`);
  console.log("  tx:", transferSig);

  const ownerBal = (await getAccount(connection, ownerAta.address, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const recvBal = (await getAccount(connection, receiverAta.address, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  console.log("Балансы:");
  console.log(`  создатель:  ${fromBase(ownerBal)} SNZ`);
  console.log(`  получатель: ${fromBase(recvBal)} SNZ`);

  if (ownerBal !== toBase(MINT_AMOUNT - TRANSFER_AMOUNT) || recvBal !== toBase(TRANSFER_AMOUNT)) {
    throw new Error("балансы не совпадают с ожидаемыми");
  }
  console.log("OK: токен создан, выпущен и переведён");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
