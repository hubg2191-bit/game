# Архитектура — architecture

## Схема
```
[Three-клиент] <--WS json--> [Node WS-gateway] <-> [Sim-worker (shared/sim)] <-> [Redis pub/sub] <-> [Postgres]
      |                              |                         |
  predict + render              validate + fog             autosave + season
```

## Компоненты
- `shared/sim/` — чистый TS без Three: economy.ts, combat.ts, morale.ts, path.ts, fog.ts. Один код для клиента и сервера. Версия `simVersion: 12` сверяется при входе.
- Клиент: `client/three/*` рендер + `client/ui/*` + `client/net/*` (сокет, буфер команд, снапшоты).
- Сервер: Node + `ws` (чистый, без Colyseus — как просил). 1 процесс gateway + N sim-worker (по 1 на 4 комнаты). Redis — очередь команд + паб снапшотов. Postgres — профили, герои, кланы, сезон-очки.
- Тики: sim 15 Hz, снапшот дифф 10 Hz (бой) / 3 Hz (MAIN вне боя), fog-биты 5 Hz, autosave MAIN 10 сек.

## Масштаб v0.2
- BattleRoom: 2-4 игрока, 40 мин, до 48 отрядов (~800 тел) — 1 worker тянет 6 комнат.
- LifeRoom: шард 60 игроков, чанки 256м — 1 worker на шард, стриминг чанков по подписке.
- Лимиты: 2000 инстансов/клиент, 10 приказов/сек/игрок, 256кб снапшот макс.
