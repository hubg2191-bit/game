# Thrones & Towns — 0.1 Схватка-скелет

Web-RTS (Three.js + Vite). Первый playable по `docs/gdd/08-roadmap.md`:
1 раса (Нордвейн), карта «Равнина», 4 отряда, 8+ зданий, бот-пустышка, победа — 1000 очков или снос Ратуши.

## Запуск

```powershell
cd three-game-vite
npm install
npm run dev
```

Открыть http://localhost:5173

## Управление

- ЛКМ — выбрать отряд/здание, рамкой — несколько
- ПКМ — идти / атаковать (атака + захват по пути)
- WASD / край экрана — камера, колесо — зум
- Найм: выбрать Ратушу (Ополчение) или Казармы (Мечники, Копейщики, Лучники)
- Стройка: кнопки внизу → ЛКМ по земле (ПКМ/Esc — отмена)
- Флаги захватываются отрядом 8+ бойцов

## Структура

- `src/game/sim.js` — чистая симуляция (shared/sim по GDD 07-tech)
- `src/game/render.js` — Three.js сцена (client/three)
- `src/game/ui.js` — HUD поверх canvas (client/ui)
- `src/game/data/*.json` — баланс (единственное место правок цифр)
- `docs/gdd/` — дизайн-документ

Деплой: push в `main` → GitHub Actions → GitHub Pages.
