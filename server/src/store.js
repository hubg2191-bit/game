// store: postgres + redis с graceful degrade в память (ноут без docker тоже едет).
import pg from 'pg';
import redis from 'redis';

export async function initStore(env, log) {
  let pool = null;
  try {
    pool = new pg.Pool({ connectionString: env.DB_URL, connectionTimeoutMillis: 2000 });
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS lifesave (
      room TEXT PRIMARY KEY, tick INT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY, seed BIGINT NOT NULL, cfg JSONB NOT NULL,
      orders JSONB NOT NULL, result JSONB, created_at TIMESTAMPTZ DEFAULT now())`);
    log('store: postgres ok');
  } catch {
    log('store: postgres недоступен — режим памяти');
    pool = null;
  }

  let rc = null;
  try {
    rc = redis.createClient({ url: env.REDIS_URL, socket: { connectTimeout: 2000 } });
    await rc.connect();
    log('store: redis ok');
  } catch {
    log('store: redis недоступен — режим памяти');
    rc = null;
  }

  const mem = { saves: new Map(), replays: new Map() };
  return {
    backend: pool ? 'postgres' : 'memory',
    async saveLife(room, tick, data) {
      if (pool) {
        await pool.query(
          `INSERT INTO lifesave (room, tick, data, updated_at) VALUES ($1,$2,$3,now())
           ON CONFLICT (room) DO UPDATE SET tick=$2, data=$3, updated_at=now()`,
          [room, tick, data]
        );
      } else {
        mem.saves.set(room, { tick, data });
      }
    },
    async saveReplay(id, rec) {
      if (pool) {
        await pool.query(
          `INSERT INTO replays (id, seed, cfg, orders, result) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET orders=$4, result=$5`,
          [id, rec.seed, rec.cfg, JSON.stringify(rec.orders), rec.result ? JSON.stringify(rec.result) : null]
        );
      } else {
        mem.replays.set(id, rec);
      }
    },
    async getReplay(id) {
      if (pool) {
        const r = await pool.query('SELECT seed, cfg, orders, result FROM replays WHERE id=$1', [id]);
        if (!r.rows.length) return null;
        const row = r.rows[0];
        return { seed: Number(row.seed), cfg: row.cfg, orders: row.orders, result: row.result };
      }
      return mem.replays.get(id) || null;
    },
    publish(room, msg) {
      // rooms.md: redis паб/саб room:<id>; в прототипе — прямой вызов, шина на будущее
      if (rc) rc.publish(`room:${room}`, msg).catch(() => {});
    },
    async close() {
      try {
        await rc?.quit();
      } catch { /* ignore */ }
      try {
        await pool?.end();
      } catch { /* ignore */ }
    },
  };
}
