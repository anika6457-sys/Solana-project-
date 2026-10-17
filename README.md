# Solana — задания 4–7

| Неделя | Папка | Что внутри |
|---|---|---|
| 4 | `week4-first-program` | Счётчик на чистом Solana SDK (`src/lib.rs`) + клиент `client/interact.ts` |
| 5 | `week5-anchor-counter` | Тот же счётчик на Anchor (`programs/counter/src/lib.rs`, `tests/counter.ts`) |
| 6 | `week6-pda-profile` | Профиль по PDA (`programs/profile/src/lib.rs`, `tests/profile.ts`) |
| 7 | `week7-token-extensions` | Токен на Token Extensions с метаданными (`create-token.ts`) |

Окружение: WSL Ubuntu 24.04, Rust 1.99, Solana CLI 3.1.10 (Agave), Anchor 1.1.2, Node 24.
Рабочая копия для сборки — `/root/solana-4-7` в WSL (сборка на `/mnt/c` медленная).

Ключи программ (`target/deploy/*-keypair.json`) в репозиторий не входят. После клонирования
выполните `anchor keys sync` в папках недель 5 и 6, чтобы сгенерировать новые ключи и обновить `declare_id!`;
для недели 4 ключ создаст `cargo build-sbf`.

## Запуск (внутри WSL: `wsl -d Ubuntu`, затем `. /root/env.sh`)

```bash
# Недели 5 и 6 — сами поднимают локальный валидатор, деплоят и гоняют тесты
cd /root/solana-4-7/week5-anchor-counter && anchor test --validator legacy   # 3 passing
cd /root/solana-4-7/week6-pda-profile    && anchor test --validator legacy   # 6 passing

# Недели 4 и 7 — нужен запущенный валидатор
solana-test-validator --reset &        # в отдельном терминале
solana config set --url localhost && solana airdrop 10

cd /root/solana-4-7/week4-first-program
cargo build-sbf
solana program deploy target/deploy/week4_first_program.so
PROGRAM_ID=$(solana address -k target/deploy/week4_first_program-keypair.json) npm run interact   # счётчик = 3

cd /root/solana-4-7/week7-token-extensions
npm run create-token     # 1000 SNZ выпущено, 250 переведено
```

Для devnet: `solana config set --url devnet` и `RPC_URL=https://api.devnet.solana.com`
для клиентских скриптов (нужно ~2–3 SOL на деплой программы).
