/* Ábaco · almacenamiento único en IndexedDB (Fase 3).
 *
 * Una sola base de datos, «abaco». Cada guardado es UNA transacción:
 *  - entries: movimientos del ledger (append-only; solo cambia el marcador de revertido).
 *  - records: colecciones vigentes (cuentas, tarjetas, MSI, préstamos, cobros, metas,
 *    inversiones, presupuestos) y datos de la app.
 *  - legacy: copia de solo lectura del formato antiguo, tomada en la migración.
 *  - meta: versión del esquema y marca de tiempo.
 *
 * Garantías:
 *  - Todo se serializa (structuredClone) antes de abrir la transacción: si algo no
 *    se puede guardar, la transacción ni siquiera empieza y no queda nada a medias.
 *  - Los errores se propagan (rechazan la promesa). Nunca se traga un fallo en silencio.
 *  - La migración ocurre una sola vez: si ya existe el esquema v3, no vuelve a correr.
 *
 * Browser: window.AbacoStore. Requiere AbacoCore y AbacoMigrate cargados antes.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbacoStore = api.AbacoStore; // en el navegador, el global es la clase
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DB_NAME = 'abaco';
  const DB_VERSION = 1;
  const SCHEMA = 3;
  const STORES = ['entries', 'records', 'legacy', 'meta'];
  const COLLECTIONS = ['accounts', 'cards', 'msiPlans', 'loans', 'debtors', 'goals', 'investments', 'budgets'];
  const LEGACY_READ_KEYS = [
    'expenses', 'incomes', 'shop', 'checklist', 'cart', 'shopMode', 'historial', 'savings', 'kanban',
    'reminders', 'reactions', 'categories', 'budgets', 'budget_period', 'cards', 'msiPlans', 'accounts',
    'transfers', 'loans', 'subscriptions', 'debtors', 'investments', 'account_view', 'pinned',
    'user_pronoun', 'money_chart_prefs', 'active_panel', 'wallet_quiz', 'theme', 'user_id', 'user_name',
    'last_backup_at', 'swipe_hint_closed', 'abaco_db_updated_at'
  ];

  class StorageError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'StorageError';
      this.code = code;
    }
  }

  const wrap = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError('REQUEST_FAILED', request.error && request.error.message));
  });

  function open(idb) {
    return new Promise((resolve, reject) => {
      if (!idb) return reject(new StorageError('NO_INDEXEDDB', 'Este navegador no ofrece almacenamiento local seguro'));
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, name === 'entries' ? { keyPath: 'id' } : undefined);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageError('OPEN_FAILED', req.error && req.error.message));
      req.onblocked = () => reject(new StorageError('OPEN_BLOCKED', 'Cierra otras pestañas de Ábaco e inténtalo de nuevo'));
    });
  }

  /* Lee las claves antiguas de localStorage (valores JSON o texto plano). */
  function readLegacy(storage) {
    const out = {};
    if (!storage) return out;
    for (const key of LEGACY_READ_KEYS) {
      let raw = null;
      try { raw = storage.getItem(key); } catch (_) { raw = null; }
      if (raw === null || raw === undefined) continue;
      try { out[key] = JSON.parse(raw); } catch (_) { out[key] = raw; }
    }
    return out;
  }

  const hasLegacyData = (legacy) => COLLECTIONS.some((k) => Array.isArray(legacy[k]) && legacy[k].length) || !!legacy.user_id;

  class AbacoStore {
    constructor(db, { Ledger, migrate }) {
      this.db = db;
      this.Ledger = Ledger;
      this.migrate = migrate;
      this.persisted = new Map(); // id del movimiento -> marcador de revertido ya guardado
    }

    /* Abre la base y devuelve { store, ledger, app, status }.
     * status: 'loaded' (datos existentes), 'fresh' (instalación nueva) o 'migrated' (desde localStorage). */
    static async open({ idb = root.indexedDB, storage = root.localStorage, Ledger = root.AbacoCore.Ledger, migrate = root.AbacoMigrate.migrateLegacy, now } = {}) {
      const db = await open(idb);
      const store = new AbacoStore(db, { Ledger, migrate });
      const loaded = await store.load();
      if (loaded) return { store, ...loaded, status: 'loaded' };

      const legacy = readLegacy(storage);
      if (hasLegacyData(legacy)) {
        const result = migrate(legacy, { Ledger, now });
        if (!result.report.verify.ok) throw new StorageError('MIGRATION_INVALID', 'La migración no cuadra; no se guardó nada');
        await store.commit(result.ledger, result.app);
        await store.writeLegacyArchive(legacy, result.legacyHistory, result.report);
        return { store, ledger: result.ledger, app: result.app, report: result.report, status: 'migrated' };
      }

      const ledger = new Ledger({ now });
      ledger.ensureDefaultAccounts();
      await store.commit(ledger, {});
      return { store, ledger, app: {}, status: 'fresh' };
    }

    /* Lee el estado guardado. Devuelve null si el esquema v3 aún no existe. */
    async load() {
      const tx = this.db.transaction(STORES, 'readonly');
      const meta = await wrap(tx.objectStore('meta').get('meta'));
      if (!meta) return null;
      if (meta.schema !== SCHEMA) throw new StorageError('SCHEMA_UNSUPPORTED', 'Versión de datos no compatible: ' + meta.schema);
      const entries = await wrap(tx.objectStore('entries').getAll());
      const records = tx.objectStore('records');
      const data = { version: SCHEMA, entries };
      for (const key of COLLECTIONS) data[key] = (await wrap(records.get(key))) || [];
      const app = (await wrap(records.get('app'))) || {};
      const ledger = this.Ledger.fromJSON(data);
      this.persisted = new Map(entries.map((e) => [e.id, !!e.reversed]));
      return { ledger, app };
    }

    /* Guarda el estado completo en una sola transacción. Solo escribe movimientos nuevos o revertidos. */
    commit(ledger, app = {}) {
      const data = ledger.toJSON();
      const pending = data.entries.filter((e) => !this.persisted.has(e.id) || this.persisted.get(e.id) !== !!e.reversed);
      // Serializar todo ANTES de abrir la transacción: un valor no clonable no deja escrituras a medias.
      const ops = [];
      try {
        for (const e of pending) ops.push(['entries', structuredClone(e), undefined]);
        for (const key of COLLECTIONS) ops.push(['records', structuredClone(data[key]), key]);
        ops.push(['records', structuredClone(app || {}), 'app']);
        ops.push(['meta', { schema: SCHEMA, updatedAt: Date.now(), entryCount: data.entries.length }, 'meta']);
      } catch (e) {
        return Promise.reject(new StorageError('NOT_SERIALIZABLE', 'Hay datos que no se pueden guardar: ' + e.message));
      }
      return this._write(ops, () => {
        data.entries.forEach((e) => this.persisted.set(e.id, !!e.reversed));
      });
    }

    /* Sustituye todo el contenido (importación de copia v3). */
    replaceAll(ledger, app = {}) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['entries'], 'readwrite');
        tx.objectStore('entries').clear();
        tx.oncomplete = () => { this.persisted = new Map(); resolve(); };
        tx.onerror = () => reject(new StorageError('CLEAR_FAILED', tx.error && tx.error.message));
        tx.onabort = () => reject(new StorageError('CLEAR_ABORTED', 'No se pudo vaciar el almacén'));
      }).then(() => this.commit(ledger, app));
    }

    writeLegacyArchive(legacy, legacyHistory, report) {
      const archive = { takenAt: Date.now(), legacy, history: legacyHistory, report: { warnings: report.warnings, counts: report.counts } };
      const ops = [['legacy', structuredClone(archive), 'v2']];
      return this._write(ops);
    }

    /* Copia de respaldo del formato v3. La importación valida antes de reemplazar nada. */
    exportJSON(ledger, app = {}) {
      return JSON.stringify({ app: 'abaco', version: SCHEMA, exportedAt: Date.now(), ledger: ledger.toJSON(), data: app }, null, 2);
    }

    importJSON(text) {
      let payload;
      try { payload = JSON.parse(text); } catch (_) { throw new StorageError('BAD_JSON', 'El archivo no es una copia válida'); }
      if (!payload || payload.app !== 'abaco' || payload.version !== SCHEMA) throw new StorageError('UNSUPPORTED_BACKUP', 'Esta copia no es compatible con esta versión de Ábaco');
      const ledger = this.Ledger.fromJSON(payload.ledger); // lanza CORRUPT_DATA si no cuadra
      return { ledger, app: payload.data && typeof payload.data === 'object' ? payload.data : {} };
    }

    _write(ops, onDone) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORES, 'readwrite');
        try {
          for (const [store, value, key] of ops) {
            if (key === undefined) tx.objectStore(store).put(value);
            else tx.objectStore(store).put(value, key);
          }
        } catch (e) {
          try { tx.abort(); } catch (_) { /* ya abortada */ }
          return reject(new StorageError('WRITE_FAILED', e.message));
        }
        tx.oncomplete = () => { if (onDone) onDone(); resolve(); };
        tx.onerror = () => reject(new StorageError('WRITE_FAILED', tx.error && tx.error.message));
        tx.onabort = () => reject(new StorageError('WRITE_ABORTED', 'El guardado se canceló; tus datos anteriores siguen intactos'));
      });
    }
  }

  return { AbacoStore, StorageError, readLegacy, SCHEMA };
});
