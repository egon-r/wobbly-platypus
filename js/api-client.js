/**
 * api-client.js — Virtual API client for ai-demo.
 *
 * Tries live backend (/api/v1/) first. Falls back to static
 * snapshot files (/api/vV1/) served from GH Pages.
 *
 * Usage:
 *   const api = new ApiClient();
 *   await api.init();               // detect backend
 *   console.log(api.mode);          // "live" | "static"
 *   const tables = await api.getTables();
 *   const data   = await api.getTable("common.agents");
 *   const schema = await api.getSchema();
 *
 * The client mirrors a REST API — same paths for both modes:
 *   /api/v1/health   vs  /api/vV1/health
 *   /api/v1/tables   vs  /api/vV1/tables
 *   /api/v1/table/X  vs  /api/vV1/table/X.json
 */
(function (root) {
  "use strict";

  var ApiClient = function (opts) {
    opts = opts || {};
    this.liveURL = opts.liveURL || "/api/v1/";
    this.staticURL = opts.staticURL || "/api/vV1/";
    this._base = null;       // resolved after init
    this.mode = "unknown";   // "live" | "static" | "error"
    this.health = null;      // health check response
    this._initPromise = null;
  };

  /**
   * Detect backend availability. Call once at startup.
   * Returns a promise that resolves to the mode string.
   */
  ApiClient.prototype.init = function () {
    if (this._initPromise) return this._initPromise;
    var self = this;

    this._initPromise = tryHealth(self.liveURL)
      .then(function (health) {
        self.mode = "live";
        self._base = self.liveURL;
        self.health = health;
        return "live";
      })
      .catch(function () {
        // Fallback to static
        self.mode = "static";
        self._base = self.staticURL;
        self.health = null;
        return "static";
      });

    return this._initPromise;
  };

  /**
   * Current base URL for all API calls.
   */
  ApiClient.prototype.baseURL = function () {
    if (!this._base) throw new Error("ApiClient not initialized — call init() first");
    return this._base;
  };

  // ── Endpoints ───────────────────────────────────────────────────

  /** Fetch list of tables: { tables: string[], count: number } */
  ApiClient.prototype.getTables = function () {
    return this._fetchJSON("tables.json").then(function (r) {
      return r.tables || r;
    });
  };

  /** Fetch full schema: { "schema.table": [{ name, type, ... }, ...] } */
  ApiClient.prototype.getSchema = function () {
    return this._fetchJSON("schema.json");
  };

  /** Fetch rows for a specific table: [{ col: val, ... }, ...] */
  ApiClient.prototype.getTable = function (tableName) {
    return this._fetchJSON("table/" + encodeURIComponent(tableName) + ".json");
  };

  /** Fetch snapshot manifest */
  ApiClient.prototype.getManifest = function () {
    return this._fetchJSON("manifest.json");
  };

  /** Health check info */
  ApiClient.prototype.getHealth = function () {
    return this._fetchJSON("health.json");
  };

  /**
   * Run a query against the live backend only.
   * Throws if in static mode.
   */
  ApiClient.prototype.query = function (sql) {
    if (this.mode !== "live") {
      return Promise.reject(new Error("query() requires live backend — currently in " + this.mode + " mode"));
    }
    var url = this.baseURL() + "query?sql=" + encodeURIComponent(sql);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Query failed: " + r.status);
      return r.json();
    });
  };

  // ── Internal ────────────────────────────────────────────────────

  /** Fetch a JSON resource relative to the current base URL */
  ApiClient.prototype._fetchJSON = function (path) {
    var url = this.baseURL() + path;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("API error " + r.status + " for " + url);
      return r.json();
    });
  };

  // ── Health check helper ─────────────────────────────────────────

  /** Try HEAD to a URL with a timeout. Resolves on 2xx, rejects on failure. */
  function tryHealth(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 3000);

    return fetch(url + "health.json", {
      method: "GET",  // HEAD doesn't work on static file servers; use GET
      signal: controller.signal,
    }).then(function (r) {
      clearTimeout(timer);
      if (r.ok) return r.json();
      throw new Error("Health check failed: " + r.status);
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ── Export ──────────────────────────────────────────────────────
  root.ApiClient = ApiClient;

})(typeof window !== "undefined" ? window : this);
