# Неделя 9 — депозит

`deposit(amount, min_shares_out)`:

1. Считает, сколько долей положено за `amount` (`math.rs`).
2. Переводит токены пользователя в хранилище vault (`transfer_checked`).
3. Выпускает share-токены пользователю. Подписывает PDA vault через seeds.
4. Обновляет `total_assets` и `deposited` в PDA пользователя.

## Формула доли

```
первый депозит:  shares = amount
дальше:          shares = amount * total_shares / total_assets
```

- Промежуточное значение считается в `u128`, поэтому не переполняется.
- Округление вниз, в пользу vault.
- Доля считается по `total_assets`, а не по балансу токен-аккаунта. Поэтому прямой
  перевод токенов в хранилище не меняет цену доли (защита от «inflation attack»).
- `min_shares_out` — защита пользователя: если доля подорожала, транзакция откатится.

Тесты: `tests/week09-deposit.ts`, unit-тесты: `programs/vault/src/math.rs`.
