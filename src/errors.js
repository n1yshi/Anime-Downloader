class NineAnimeError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "NineAnimeError";
    this.cause = meta.cause;
    this.status = meta.status;
    this.url = meta.url;
  }
}

module.exports = { NineAnimeError };

