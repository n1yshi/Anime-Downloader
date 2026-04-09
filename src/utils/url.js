function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return null;
  return String(baseUrl).replace(/\/+$/, "");
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return null;
  }
}

module.exports = {
  normalizeBaseUrl,
  toAbsoluteUrl,
};

