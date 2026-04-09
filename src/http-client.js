const axios = require("axios");
const { NineAnimeError } = require("./errors");
const { toAbsoluteUrl } = require("./utils/url");

class NineAnimeHttpClient {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000;
    this.staticHeaders = options.headers || {};
    this.headerProvider = typeof options.headerProvider === "function" ? options.headerProvider : null;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
      validateStatus: () => true,
      proxy: options.useEnvProxy ? undefined : false,
    });
  }

  makeUrl(pathname) {
    return toAbsoluteUrl(this.baseUrl, pathname) || String(pathname);
  }

  async _headers(extra = {}) {
    const dynamic = this.headerProvider ? await this.headerProvider() : {};
    return {
      ...this.staticHeaders,
      ...(dynamic || {}),
      ...extra,
    };
  }

  async get(url, config = {}) {
    const fullUrl = this.makeUrl(url);
    try {
      const res = await this.http.get(url, {
        ...config,
        headers: await this._headers({
          Referer: this.baseUrl + "/",
          ...(config.headers || {}),
        }),
      });

      if (res.status >= 400) {
        throw new NineAnimeError(`HTTP ${res.status} while fetching ${fullUrl}`, {
          status: res.status,
          url: fullUrl,
        });
      }

      return res.data;
    } catch (cause) {
      if (cause instanceof NineAnimeError) throw cause;
      throw new NineAnimeError(`Request failed: ${fullUrl}`, { cause, url: fullUrl });
    }
  }
}

module.exports = { NineAnimeHttpClient };

