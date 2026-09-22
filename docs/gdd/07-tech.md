# 07 — Тех: Three.js + сервер

## Клиент Three.js
- Сцена: 1 карта = 1 сцена. Земля — Plane 256x256 сегментов с heightmap, лес — InstancedMesh (ствол+крона 2 draw call), здания — low-poly Box/Cylinder, солдаты — InstancedMesh по 1 на тип брони (3-4 draw call на 2000 тел).
- Камера RTS: OrbitControls с ограничением polar 20-60°, зум 15-120м, WASD + edge-pan + миникарта-канвас.
- Туман войны: DataTexture 128x128, обновляется сервером, шейдер затемняет. Клиент не видит HP врагов в тумане — только сервер шлет.
- LOD: дальше 60м солдаты — билборды/капсулы, ближние — боксы с цветом команды + щит/копье одной палкой. Моделей людей на MVP нет.
- UI: HTML поверх canvas (ресурсы, очередь, панель отряда), миникарта отдельным 2D canvas.

## Сервер — авторитетный
- `shared/sim/` — чистый TS без Three: ресурсы, HP, мораль, движение, формулы из 03/05. Один код для клиента (предсказание) и сервера (правда).
- Сервер: Node + Colyseus rooms: `LifeRoom` (persistent, autosave 10 сек в Postgres/Redis) + `BattleRoom` (эфемерная 40 мин).
- Tick 15Hz, снапшот диффом, команды только `move/attack/build/recruit/cast`. Валидация: цена, дистанция, туман, APM-лимит 10/сек. Остальное режется как читы.
- Реконнект: full-snapshot + последние 5 сек логов. Реплей = лог команд.

## Структура кода (создать)
```
src/game/data/*.json — баланс (расы, здания, юниты, герои)
shared/sim/{economy.ts, combat.ts, morale.ts, path.ts}
client/three/{map.ts, instancing.ts, fog.ts, selection.ts}
client/ui/{hud.ts, lobby.ts}
server/rooms/{LifeRoom.ts, BattleRoom.ts}
```

## Деплой GitHub
Клиент — gh-pages из `dist/`. GDD — `docs/gdd/*.md` читается прямо на GitHub. JSON баланса в `src/game/data/` — единый источник правды.
Лимиты веба: 2000 инстансов ок, 4000 — уже просадки на мобильных. Кап отряда и лимит 12 отрядов/игрок из-за этого.
