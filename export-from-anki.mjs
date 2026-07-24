#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ankiUrl = "http://127.0.0.1:8765";
const deck = process.env.ANKI_DECK ?? "Default";
const limit = Number(process.env.ANKI_CARD_LIMIT ?? 60);
const outputDir = path.dirname(fileURLToPath(import.meta.url));

function decodeHtml(value = "") {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    middot: "·",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }
      return entities[entity.toLowerCase()] ?? match;
    })
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function anki(action, params = {}) {
  const response = await fetch(ankiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });

  if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

function extractCard(card) {
  const front = decodeHtml(card.fields.FrontText?.value ?? card.question);
  const back = card.fields.BackText?.value ?? card.answer;
  const meaningMatch = back.match(
    /<div[^>]*font-size:\s*1\.3em[^>]*>([\s\S]*?)<\/div>/i,
  );
  const exampleMatch = back.match(/<i>([\s\S]*?)<\/i>/i);

  return {
    german: front,
    english: decodeHtml(meaningMatch?.[1] ?? back).split("\n")[0],
    example: decodeHtml(exampleMatch?.[1] ?? ""),
  };
}

const query = `deck:"${deck.replaceAll('"', '\\"')}" is:due`;
const cardIds = (await anki("findCards", { query })).slice(0, limit);
const cards = (await anki("cardsInfo", { cards: cardIds })).map(extractCard);
const generatedAt = new Date().toISOString();

const text = [
  "GERMAN WALK TUTOR CURRENT DECK",
  "",
  `Cards: ${cards.length}`,
  `Source: Anki deck ${deck}, currently due cards`,
  `Updated: ${generatedAt}`,
  "",
  ...cards.flatMap((card, index) => [
    `CARD ${index + 1}`,
    `German: ${card.german}`,
    `English: ${card.english}`,
    ...(card.example ? [`Example: ${card.example}`] : []),
    "",
  ]),
].join("\n");

const json = JSON.stringify(
  { deck, generatedAt, selection: "currently due", cards },
  null,
  2,
);

const list = cards
  .map(
    (card) => `
      <li>
        <strong lang="de">${escapeHtml(card.german)}</strong>
        ${escapeHtml(card.english)}
        ${
          card.example
            ? `<br /><em lang="de">${escapeHtml(card.example)}</em>`
            : ""
        }
      </li>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>German Walk Tutor cards</title>
    <meta name="description" content="Current German-English cards exported from Anki." />
    <style>
      body { max-width: 46rem; margin: 4rem auto; padding: 0 1.25rem; color: #171713; background: #f4f1e9; font: 18px/1.6 system-ui, sans-serif; }
      h1 { font: 3rem/1 Georgia, serif; }
      li { margin: 1.5rem 0; }
      strong { display: block; font-size: 1.3rem; }
      em { color: #666258; }
      .meta { color: #666258; font-size: .85rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>German Walk Tutor</h1>
      <p>Current public test deck with ${cards.length} due cards from Anki.</p>
      <p class="meta">Updated ${escapeHtml(generatedAt)}</p>
      <ol>${list}
      </ol>
      <p><a href="cards.txt">Plain text</a> · <a href="cards.json">JSON</a></p>
    </main>
  </body>
</html>
`;

await Promise.all([
  writeFile(path.join(outputDir, "cards.txt"), text),
  writeFile(path.join(outputDir, "cards.json"), `${json}\n`),
  writeFile(path.join(outputDir, "index.html"), html),
]);

console.log(`Exported ${cards.length} due cards from ${deck}.`);
