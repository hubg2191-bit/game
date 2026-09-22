# Компоненты для кода — components

## Стек
- `client/ui/*.ts` + HTML/CSS, без фреймворка (чистый TS, как просил). Канвас Three отдельно `client/three/*`. Связь через `GameStore` (подписка на sim-снапшот 5 Hz для UI, 15 Hz для боя).
- Шрифт: system + `Inter` с Google Fonts (фолбэк). Иконки — inline SVG 24px (меч/дом/флаг), лежат `src/game/assets/icons/`.

## Компоненты
- `TopBar.ts` — ресурсы + таймер. `BuildMenu.ts` — табы+сетка+очередь. `SelectionPanel.ts` — отряд/здание/герой. `HeroPanel.ts` — Q/E + шмот-модалка. `QuestTracker.ts` — 3 квеста. `Minimap.ts` — 2D canvas + пинги. `Chat.ts` — вкладки + F1-F4. `ScoreBar.ts` — счет Схватки. `Lobby.ts` — комнаты + пики. `Modals.ts` — сдаться/настройки/награды.

## Токены
- Цвета команд: `p0 #2f9dff, p1 #ff4d4d, p2 #ffd23f, p3 #b07dff, self #39d353`. Фон панелей `rgba(10,14,22,0.85)`, бордер `#26314a`. HP зеленый→красный, мораль синяя, мана фиолет.
- Размеры: топ 36px, миникарта 220px, иконки 48px (тач 64px), шрифт 13px база.

## Для другого чата
- Каждый компонент — 1 файл + 1 CSS-класс `tt-<name>`. Никакой логики баланса в UI — только `formatNumber`, `cooldown overlay`, `tooltip`.
- Тест: открыть `hud-main` с мок-снапшотом без сервера (файл `client/ui/mock.ts`).
