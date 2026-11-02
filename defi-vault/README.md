# DeFi-vault — сквозной проект, недели 8–13

Vault принимает токены пользователей, выдаёт share-токены (долю) и размещает средства
в CLMM-пуле Raydium.

| Неделя | Что сделано | Документ |
|---|---|---|
| 8 | Каркас: настройки, PDA пользователя, share-токен. Вопросы к РК1 | [week08](docs/week08.md), [РК1](docs/rk1-questions.md) |
| 9 | Депозит | [week09](docs/week09.md) |
| 10 | Вывод: сжигание долей, возврат токенов с подписью PDA | [week10](docs/week10.md) |
| 11 | Пулы и диапазоны, тестовые токены и CLMM-пул | [week11](docs/week11.md) |
| 12 | Обмен через Raydium с минимальной суммой получения | [week12](docs/week12.md) |
| 13 | Позиция: открытие, комиссии, закрытие, перестановка | [week13](docs/week13.md) |

## Как устроено

```
programs/vault/src/
  state.rs          аккаунты и seeds
  math.rs           расчёт долей
  raydium.rs        CPI в Raydium CLMM
  instructions/     по файлу на группу инструкций
scripts/
  setup-pool.ts     тестовые токены и пул
  demo.ts           полный путь vault
  lib/              общий код для скриптов и тестов
tests/              тесты по неделям
```

## Запуск

Окружение: Rust, Solana CLI 3.1, Anchor 1.1, Node 24, Yarn. Команды выполняются внутри WSL.

Недели 11–13 работают с настоящей программой Raydium. Для тестов она клонируется из devnet
в локальный валидатор, поэтому нужен интернет, но SOL в devnet не нужен:

```bash
yarn install
scripts/start-validator.sh &
anchor test --skip-local-validator
```

Запуск в самом devnet (нужно около 5 SOL на кошельке):

```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
RPC_URL=https://api.devnet.solana.com yarn tsx scripts/setup-pool.ts
RPC_URL=https://api.devnet.solana.com yarn tsx scripts/demo.ts
```

Ключ программы (`target/deploy/vault-keypair.json`) в репозиторий не входит. После клонирования
выполните `anchor keys sync`, чтобы создать новый ключ и обновить `declare_id!`.
