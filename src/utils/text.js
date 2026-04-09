function cleanText(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

module.exports = { cleanText };

