1. Залей compose на VPS и подними `docker compose up -d`.
2. Поменяй `WSS_URL` в `.env` на домен, quick-туннель больше не нужен.
3. Импортируй базу: `pg_dump` с ноута -> `psql` на VPS.
4. Прогони чек-лист `docs/gdd/netcode/testing.md` против VPS.
5. Не деплой бэк на Pages: Pages только `dist`, бэк едет в GHCR.
