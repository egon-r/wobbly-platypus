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
    this.version = opts.version || "";
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

    this._initPromise = tryHealth(self.liveURL, self.version)
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
   * Measure ping (ms) to the backend.
   * In live mode, measures actual round-trip time.
   * In static mode, returns 0 (no real network latency to measure).
   */
  ApiClient.prototype.ping = function () {
    var self = this;
    var start = Date.now();
    return this.getHealth().then(function () {
      return Date.now() - start;
    });
  };

  /**
   * Get aggregate status: table count, row count, generated_at timestamp.
   * Works in both live and static modes.
   */
  ApiClient.prototype.getStatus = function () {
    return this._fetchJSON("status.json").then(function (s) {
      return {
        tables: s.total_tables,
        rows: s.total_rows,
        generated_at: s.generated_at,
        hash: s.hash
      };
    });
  };

  /**
   * Run a query against the live backend only.
   * Throws if in static mode.
   */
  ApiClient.prototype.query = function (sql) {
    if (this.mode !== "live") {
      return Promise.reject(new Error("query() requires live backend — currently in " + this.mode + " mode"));
    }
    var url = versionize(this.baseURL() + "query?sql=" + encodeURIComponent(sql), this.version);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Query failed: " + r.status);
      return r.json();
    });
  };

  // ── Internal ────────────────────────────────────────────────────

  /** Append version param for cache busting on deploy */
  function versionize(url, ver) {
    if (!ver) return url;
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return url + sep + "v=" + encodeURIComponent(ver);
  }

  /** Fetch a JSON resource relative to the current base URL */
  ApiClient.prototype._fetchJSON = function (path) {
    var url = versionize(this.baseURL() + path, this.version);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("API error " + r.status + " for " + url);
      return r.json();
    });
  };

  // ── Health check helper ─────────────────────────────────────────

  /** Try GET health.json with timeout. Resolves on 2xx, rejects on failure. */
  function tryHealth(url, ver) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 3000);
    var healthURL = versionize(url + "health.json", ver);

    return fetch(healthURL, {
      method: "GET",
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
