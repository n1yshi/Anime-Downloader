function requireNonEmptyString(value, name) {
  const s = String(value ?? "").trim();
  if (!s) {
    throw new TypeError(`${name} is required and must be a non-empty string.`);
  }
  return s;
}

module.exports = { requireNonEmptyString };

