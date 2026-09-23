# tt-game-server — бэк-прототип (чистый Node `ws`, без Colyseus)

## Запуск на ноуте

```powershell
cd server
npm install
node src/index.js        # :3000, redis/postgres опциональны (режим памяти)
```

```powershell
docker compose up -d     # game + redis + postgres (для VPS/докера)
```

## Конфиг — только `.env`

| Ключ | Локально | Снаружи (quick-туннель) |
|---|---|---|
| `PORT` | 3000 | 3000 |
| `WSS_URL` | `ws://localhost:3000` | `wss://xxx.trycloudflare.com` из `cloudflared tunnel --url localhost:3000` |
| `DB_URL` | `postgres://tt:tt@localhost:5432/tt` | тот же (compose подменяет хост) |
| `REDIS_URL` | `redis://localhost:6379` | тот же (compose подменяет хост) |

Адресов и токенов в коде ноль. Фронт ходит только по `VITE_WSS_URL` из `three-game-vite/.env`.

## Протокол

Формы сообщений — строго `docs/gdd/netcode/protocol.md`, `simVersion: 12` из `netcode.json`.
Отклонения прототипа (осознанные):
- единицы на проводе — мировые (метры × 0.25), иначе плывут хеши;
- `+ upgrade/trade/give/forge/stance` — команды вне protocol.md (нужны механикам 0.2–1.0);
- боты видят всё (чит пустышки, как на клиенте).

## Комнаты

- `BattleRoom`: wait → build 10 мин (урон 50%) → battle → score/win → rewards → close; тик 15 Гц, дифф 10 Гц, туман на сторону, хеш/десинк (3 мимо — full snapshot), реконнект 90с, реплей-лог.
- `LifeRoom`: заглушка — вход, heartbeat 3 Гц, автосейв 10с в `lifesave`.

## Приёмка

```powershell
node test/accept.js         # транспорт + комната + туман + реплей
node test/soak.js           # 2 клиента 10 мин без десинка (фон)
```

## Переезд на VPS — server/MIGRATION.md
