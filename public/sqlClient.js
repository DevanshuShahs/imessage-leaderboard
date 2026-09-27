// Thin async wrapper around sql.js's official worker script (vendored at
// vendor/worker.sql-wasm.js + vendor/sql-wasm.wasm). Keeps the (large)
// database entirely off the main thread so the page stays responsive while
// it loads/queries a multi-hundred-MB chat.db.

export function createSqlClient() {
  const workerUrl = new URL("vendor/worker.sql-wasm.js", import.meta.url);
  const worker = new Worker(workerUrl);
  let nextId = 1;
  const pending = new Map();

  worker.onmessage = (event) => {
    const data = event.data || {};
    const resolver = pending.get(data.id);
    if (!resolver) return;
    pending.delete(data.id);
    if (data.error) resolver.reject(new Error(data.error));
    else resolver.resolve(data);
  };

  worker.onerror = (event) => {
    console.error("SQL worker error:", event.message || event);
  };

  function send(action, payload, transfer) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, action, ...payload }, transfer || []);
    });
  }

  return {
    // buffer is transferred (not copied) into the worker - it's unusable on
    // the main thread afterward, which is fine since we only need it once.
    open(buffer) {
      return send("open", { buffer }, [buffer]);
    },

    async exec(sql, params) {
      const { results } = await send("exec", { sql, params: params || [] });
      return rowsFromResults(results);
    },

    terminate() {
      worker.terminate();
    },
  };
}

function rowsFromResults(results) {
  if (!results || results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}
