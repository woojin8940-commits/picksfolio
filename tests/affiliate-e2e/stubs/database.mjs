// @netlify/database 의 getDatabase() 와 같은 모양(db.sql 태그 · db.pool.connect)을 PGlite 로 흉내 낸다.
// 테스트가 globalThis.__AFFILIATE_TEST_PG 에 PGlite 인스턴스를 넣어 둔다.
const pg = () => {
  const db = globalThis.__AFFILIATE_TEST_PG;
  if (!db) throw new Error("test database not initialised");
  return db;
};

function toQuery(strings, values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
  return { text, params: values.map((v) => (v === undefined ? null : v)) };
}

// PGlite 는 연결이 하나뿐이라, 트랜잭션이 열려 있는 동안 다른 쿼리는 끝날 때까지 기다리게 한다.
let gate = Promise.resolve();

export function getDatabase() {
  return {
    sql: async (strings, ...values) => {
      const { text, params } = toQuery(strings, values);
      await gate;
      return (await pg().query(text, params)).rows;
    },
    pool: {
      connect: async () => {
        await gate;
        let open;
        gate = new Promise((r) => { open = r; });
        return {
          // node-postgres 와 같게 rowCount 를 붙인다(PGlite 는 affectedRows).
          query: async (text, params = []) => {
            const r = await pg().query(text, params);
            return { ...r, rowCount: r.affectedRows ?? r.rows.length };
          },
          release: () => open(),
        };
      },
    },
  };
}
