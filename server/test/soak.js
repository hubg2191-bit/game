// Soak: 2 живых WS-клиента 10 мин — снапшоты идут, киков/десинков нет, оба на связи.
// Запуск: node test/soak.js [seconds]   (по умолчанию 600)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const URL = process.env.WSS_URL || 'ws://localhost:3000';
const SECS = Number(process.argv[2] || 600);
const PROG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'soak.log');
const prog = (s) => {
  const line = `${new Date().toISOString()} ${s}`;
  console.log(line);
  fs.appendFileSync(PROG_FILE, line + '\n', 'utf8');
};

function client(race) {
  return new Promise((res) => {
    const ws = new WebSocket(URL);
    const st = { snaps: 0, acks: 0, errs: [], kicks: 0, joined: null, cid: null, lastSnapAt: 0, sq: [] };
    ws.on('open', () => ws.send(JSON.stringify({ hello: true, simVersion: 12, mode: '1v1', map: 'plain', race, mmr: 1000 })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.queued) st.cid = m.clientId;
      if (m.joined) {
        st.joined = m;
        st.pid = m.pid;
      }
      if (m.snap !== undefined || m.full) {
        st.snaps += 1;
        st.lastSnapAt = Date.now();
        if (m.full) {
          for (const s of m.squads || []) if (s.o === st.pid) st.sq.push(s.id);
        }
      }
      if (m.ack) st.acks += 1;
      if (m.err) st.errs.push(m.err);
      if (m.kick) st.kicks += 1;
      if (m.end) st.end = m;
    });
    res({ ws, st });
  });
}

const A = await client('nord');
const B = await client('kaganat');
const t0 = Date.now();
let seq = 0;
let lastOrder = 0;
prog(`soak start ${SECS}s`);
// ждём оба joined
for (let i = 0; i < 200; i++) {
  if (A.st.joined && B.st.joined) break;
  await new Promise((r) => setTimeout(r, 300));
}
if (!A.st.joined || !B.st.joined) {
  prog('FAIL: клиенты не в матче');
  process.exit(1);
}
prog(`both joined room=${A.st.joined.room}`);
while (Date.now() - t0 < SECS * 1000) {
  await new Promise((r) => setTimeout(r, 1000));
  const el = Math.floor((Date.now() - t0) / 1000);
  // каждые 5 сек оба шлют приказы
  if (el - lastOrder >= 5) {
    lastOrder = el;
    for (const [c, tag] of [[A, 'A'], [B, 'B']]) {
      const ids = c.st.sq.slice(0, 2);
      if (ids.length && c.st.joined) {
        c.ws.send(JSON.stringify({ room: c.st.joined.room, clientId: c.st.cid, cmd: 'move', ids, x: 150 + (el % 50), z: 150, t: el, seq: ++seq }));
      }
    }
  }
  if (el % 60 === 0) {
    prog(`t=${el}s A(snaps=${A.st.snaps},acks=${A.st.acks},errs=${A.st.errs.length},kicks=${A.st.kicks}) B(snaps=${B.st.snaps},acks=${B.st.acks},errs=${B.st.errs.length},kicks=${B.st.kicks})`);
  }
  if (Date.now() - A.st.lastSnapAt > 10000 || Date.now() - B.st.lastSnapAt > 10000) {
    prog('FAIL: снапшоты встали');
    process.exit(1);
  }
}
let fail = false;
for (const [c, tag] of [[A, 'A'], [B, 'B']]) {
  if (c.st.kicks > 0) {
    prog(`FAIL: кики у ${tag}`);
    fail = true;
  }
  if (c.st.snaps < SECS * 5) {
    prog(`FAIL: мало снапшотов у ${tag}: ${c.st.snaps}`);
    fail = true;
  }
}
prog(fail ? 'SOAK: FAIL' : `SOAK: OK (${SECS}s, 2 клиента, десинк-киков 0)`);
A.ws.close();
B.ws.close();
process.exit(fail ? 1 : 0);
