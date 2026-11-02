# Неделя 10 — вывод

`withdraw(shares, min_amount_out)`:

1. Считает сумму выплаты: `amount = shares * total_assets / total_shares` (вниз).
2. Сжигает share-токены пользователя (подпись пользователя).
3. Переводит токены из хранилища через Token program.
   Хранилищем владеет PDA vault, поэтому подписывает программа через `CpiContext::new_with_signer`
   с seeds `["vault", asset_mint, bump]`.
4. Уменьшает `total_assets`, увеличивает `withdrawn` в PDA пользователя.

## Проверки

| Ситуация | Ошибка |
|---|---|
| Долей меньше, чем запрошено | `InsufficientShares` |
| Выплата меньше `min_amount_out` | `SlippageExceeded` |
| В хранилище не хватает свободных токенов (средства размещены в пуле) | `InsufficientIdleAssets` |
| Чужой токен-аккаунт | `ConstraintTokenOwner` |

Тесты: `tests/week10-withdraw.ts`.
