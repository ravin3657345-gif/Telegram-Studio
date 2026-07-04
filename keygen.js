#!/usr/bin/env node
// Генератор лицензионных ключей для Telegram Studio
// Использование: node keygen.js [количество]
// Пример:        node keygen.js 10

// Алгоритм совпадает с src-tauri/src/commands/license.rs
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME  = 0x01000193;
const SECRET_XOR = 0x4B455953; // "KEYS"

function fnv1a(str) {
  let h = FNV_OFFSET;
  for (const c of str) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return (h ^ SECRET_XOR) >>> 0;
}

function encodeCheck(hash) {
  const base = CHARSET.length;
  let n = hash;
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += CHARSET[n % base];
    n = Math.floor(n / base);
  }
  return out;
}

function randomGroup() {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return s;
}

function generateKey() {
  const g1 = randomGroup();
  const g2 = randomGroup();
  const g3 = encodeCheck(fnv1a(g1 + g2));
  return `TELEGA-${g1}-${g2}-${g3}`;
}

function validateKey(key) {
  const parts = key.split("-");
  if (parts.length !== 4 || parts[0] !== "TELEGA") return false;
  const [, g1, g2, g3] = parts;
  if (g1.length !== 5 || g2.length !== 5 || g3.length !== 5) return false;
  return encodeCheck(fnv1a(g1 + g2)) === g3;
}

const count = parseInt(process.argv[2]) || 1;

console.log(`\nТелеграм Студио — генератор ключей`);
console.log(`Генерирую ${count} ключ(ей)...\n`);

for (let i = 0; i < count; i++) {
  const key = generateKey();
  const valid = validateKey(key);
  console.log(`${key}  ${valid ? "✓" : "✗"}`);
}

console.log();
