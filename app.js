"use strict";

const express = require("express");
const app = express();

const multer = require("multer");
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(multer().none());

const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");

const WORD_TYPES = ["Radical", "Kanji", "Vocabulary"];
const VOCAB = "Vocabulary";
const KANJI = "Kanji";
const RADICAL = "Radical";

// Returns the word that is specified. Requires also query parameter of "type" to be passed in.
// "type" can be - "vocabulary", "kanji", or "radical".
app.get('/word/:word', async function(req, res) {
  let type = req.query["type"];
  if (!type) {
    res.type("text");
    res.status(400).send("Please input a type!");
  } else {
    let word = req.params.word;
    // line below makes sure the type in proper format for querying database. (proper table)
    type = type.toLowerCase().charAt(0).toUpperCase() + type.slice(1);

    try {
      if (!WORD_TYPES.includes(type)) {
        res.type("text");
        res.status(400).send("Sorry, this word type is unrecognized");
      } else {
          let resp = await getWord(type, word);

          if (resp) {
            resp = formatResponse(resp, type);
            res.json(resp);
          } else {
            res.type("text");
            res.status(400).send("Word isn't known yet!!!");
          }
      }
    } catch(err) {
      res.status(500).send(err);
    }
  }
});

// returns all words in a list!
app.get("/allWords", async function(req, res) {
  try {
    res.json(await getAllWords());
  } catch(err) {
    res.type("text");
    res.status(500).send(err);
  }
});

async function getAllWords() {
  let db = await getDBConnection();
  let radical = await db.all("SELECT * FROM Radical ORDER BY first_unlocked");

  let kanji = await db.all("SELECT * FROM Kanji ORDER BY first_unlocked");
  for (let i = 0; i < kanji.length; i++) {
    kanji[i] = formatResponse(kanji[i], KANJI);
  }

  let vocab = await db.all("SELECT * FROM Vocabulary ORDER BY first_unlocked");
  for (let i = 0 ; i < vocab.length; i++) {
    vocab[i] = formatResponse(vocab[i], VOCAB);
  }

  return radical.concat(kanji.concat(vocab));
}

app.post("/postWord", async function (req, res) {
  res.type("text");

  // this line is to uppercase everything to be in the Table format.
  let type = req.body.type.toLowerCase().charAt(0).toUpperCase() + req.body.type.slice(1);

  if (!WORD_TYPES.includes(type)) {
    res.status(400).send("Unrecognized word type");
  } else {
    try {
      let db = await getDBConnection();

      // really long line below just checks to see if the word exists!
      if ((await db.all("SELECT * FROM " + type + " WHERE jp = ?", req.body.jp)).length !== 0) {
        res.type("text").status(400).send("this word already exists!");
      } else {
        if (type === RADICAL) {
          let newWord = formatRadical(req.body);
          let qry = "INSERT INTO " + type + "(jp, en, type, known_kanji, notes, source) VALUES(?, ?, ?, ?, ?, ?)";
          await db.all(qry, [newWord.jp, newWord.en, newWord.type, newWord["known-kanji"], newWord.notes, newWord.source]);
        } else if (type === VOCAB) {
          let newWord = formatVocabulary(req.body);
          let qry = "INSERT INTO " + type + "(jp, en, known_readings, type, kanji_composition, sentences, word_type, notes, source) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";
          await db.all(qry, [newWord.jp, newWord.en, newWord["known-readings"],
          newWord.type, newWord["kanji-composition"], newWord.sentences, newWord["word-type"], newWord.notes, newWord.source]);
        } else {
          let newWord = formatKanji(req.body);
          let qry = "INSERT INTO " + type + "(jp, en, known_readings, type, radical_composition, known_vocabulary, notes, source) VALUES (?, ?, ?, ? , ?, ?, ?, ?)";
          await db.all(qry, [newWord.jp, newWord.en, newWord["known-readings"],
          newWord.type, newWord["radical-composition"], newWord["known-vocabulary"], newWord.notes, newWord.source]);
        }
        res.send("successful addition!");
      }
      await db.close();
    } catch(err) {
      res.status(500).send("uh oh you done F'd up");
    }
  }
});

function addToColumn(currentColumn, additionalContent) {
  let updatedList = JSON.parse(currentColumn);
  if (additionalContent) {
    updatedList = updatedList.concat(additionalContent.split("\\,"));
  }
  return JSON.stringify(updatedList);
}

app.post('/modifyWord', async function(req, res) {
  try {
    let db = await getDBConnection();

    let table = req.body.type.toLowerCase().charAt(0).toUpperCase() + req.body.type.slice(1);
    let word = (await db.all("SELECT * FROM " + table + " WHERE jp = ?", req.body.jp))[0];
    if (!word) { // indexing into empty array gives _undefined_
      throw new Error("LOL this word doesn't exist");
    }

    if (table === RADICAL) {
      // can just ignore any english passed in!
      word.known_kanji = addToColumn(word.known_kanji, req.body["known-kanji"]);
      word.notes = addToColumn(word.notes, req.body.notes);
      word.source = addToColumn(word.source, req.body.source);

      await db.run("UPDATE " + table + " SET known_kanji = ?, notes = ?, source = ? WHERE jp = ?",
                   [word.known_kanji, word.notes, word.source, word.jp]);
    } else if (table === KANJI) {

      word.en = addToColumn(word.en, req.body.en);
      word.known_readings = addToColumn(word.known_readings, req.body["known-readings"]);
      word.radical_composition = addToColumn(word.radical_composition, req.body["known-readings"]);
      word.known_vocabulary = addToColumn(word.known_vocabulary, req.body["known-vocabulary"]);
      word.notes = addToColumn(word.notes, req.body.notes);
      word.source = addToColumn(word.source, req.body.source);

      await db.run("UPDATE " + table + " SET en = ?, known_readings = ?, radical_composition = ?, known_vocabulary = ?, notes = ?, source = ? WHERE jp = ?",
                   [word.en, word.known_readings, word.radical_composition, word.known_vocabulary, word.notes, word.source, word.jp]);
    } else if (table === VOCAB) {

      word.en = addToColumn(word.en, req.body.en);
      word.known_readings = addToColumn(word.known_readings, req.body["known-readings"]);
      word.kanji_composition = addToColumn(word.kanji_composition, req.body["kanji-composition"]);
      word.notes = addToColumn(word.notes, req.body.notes);
      word.source = addToColumn(word.source, req.body.source);
      word.word_type = addToColumn(word.word_type, req.body["word-type"]);

      word.sentences= JSON.parse(word.sentences);
      if (req.body["sentence-jp"].split("\\,")[0] !== "") { // if there's a sentence
        for (let i = 0; i < req.body["sentence-jp"].split("\\,").length; i++) { //assume clients aren't idiots
          let sentenceObj = {};
          sentenceObj.en = req.body["sentence-en"].split("\\,")[i];
          sentenceObj.jp = req.body["sentence-jp"].split("\\,")[i];
          sentenceObj["jp_simple"] = req.body["jp-simple"].split("\\,")[i];
          sentenceObj.vocab = req.body["sentence-vocab"].split("\\,")[i].split("*");

          word.sentences.push(sentenceObj);
        }
      }
      word.sentences = JSON.stringify(word.sentences);

      await db.run("UPDATE " + table + " SET en = ?, known_readings = ?, kanji_composition = ?, sentences = ?, notes = ?, source =?, word_type = ? WHERE jp = ?",
      [word.en, word.known_readings, word.kanji_composition, word.sentences, word.notes, word.source, word.word_type, word.jp]);
    }
    await db.close();
    res.json(word);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post('/removeWord', async function(req, res) {

  try {
    let db = await getDBConnection();
    let type = req.body.type;
    type = type.toLowerCase().charAt(0).toUpperCase() + type.slice(1);
    if (!WORD_TYPES.includes(type)) {
      res.status(400).send("WORD TYPE NOT RECOGNIZED");
    } else {
      await db.run("DELETE FROM " + type + " WHERE jp = ?", req.body.word);
      res.send("nice work brother");
    }
    await db.close();
  } catch(err) {
    res.status(500).send("whoa bro stop messing up");
  }
});

app.get("/randomWord", async function(req, res) {
  try {
    let words = await getAllWords();
    res.json(words[Math.floor(Math.random() * words.length)]);
  } catch(err) {
    res.status(500).send("There's an error!");
  }
});


/** -- helper functions -- */

function formatRadical(radical) {
  let word = {};

  word.en = radical.en;
  word.jp = radical.jp;
  word.type = radical.type;
  word["notes"] = !radical["notes"].split("\\,")[0] ? "[]" : JSON.stringify(radical["notes"].split("\\,"));
  word["source"] = !radical["source"].split("\\,")[0] ? "[]" : JSON.stringify(radical["source"].split("\\,"));
  word["known-kanji"] = !radical["known-kanji"].split("\\,")[0] ? "[]" : JSON.stringify(radical["known-kanji"].split("\\,"));

  return word;
}

function formatVocabulary(vocab) {
  let word = {};

  word.en = !vocab.en.split("\\,")[0] ? "[]" : JSON.stringify(vocab.en.split("\\,"));
  word.jp = vocab.jp;
  word.type = vocab.type;
  word["known-readings"] = !vocab["known-readings"].split("\\,")[0] ? "[]" : JSON.stringify(vocab["known-readings"].split("\\,"));
  word["kanji-composition"] = !vocab["kanji-composition"].split("\\,")[0] ? "[]" : JSON.stringify(vocab["kanji-composition"].split("\\,"));
  word["notes"] = !vocab["notes"].split("\\,")[0] ? "[]" : JSON.stringify(vocab["notes"].split("\\,"));
  word["source"] = !vocab["source"].split("\\,")[0] ? "[]" : JSON.stringify(vocab["source"].split("\\,"));
  word["word-type"] = !vocab["word-type"].split("\\,")[0] ? "[]" : JSON.stringify(vocab["word-type"].split("\\,"));

  word.sentences = [];

  if (vocab["sentence-jp"].split("\\,")[0] !== "") {
    for (let i = 0; i < vocab["sentence-jp"].split("\\,").length; i++) {
      let sentenceObj = {};
      sentenceObj.jp = vocab["sentence-jp"].split("\\,")[i];
      sentenceObj.en = vocab["sentence-en"].split("\\,")[i];
      sentenceObj["jp_simple"] = vocab["jp-simple"].split("\\,")[i];

      let vocabArr = [];
      for (let j = 0; j < vocab["sentence-vocab"].split("\\,")[i].split("*").length; j++) {
        vocabArr.push(vocab["sentence-vocab"].split("\\,")[i].split("*")[j]);
      }
      sentenceObj.vocab = vocabArr;
      word.sentences.push(sentenceObj);
    }
  }
  word.sentences = JSON.stringify(word.sentences);

  return word;
}

function formatKanji(kanji) {
  let word = {};

  word.en = !kanji.en.split("\\,")[0] ? "[]" : JSON.stringify(kanji.en.split("\\,"));
  word.jp = kanji.jp;
  word.type = kanji.type;

  word["known-readings"] = !kanji["known-readings"].split("\\,")[0] ? "[]" : JSON.stringify(kanji["known-readings"].split("\\,"));
  word["radical-composition"] = !kanji["radical-composition"].split("\\,")[0] ? "[]" : JSON.stringify(kanji["radical-composition"].split("\\,"));
  word["known-vocabulary"] = !kanji["known-vocabulary"].split("\\,")[0] ? "[]" : JSON.stringify(kanji["known-vocabulary"].split("\\,"));
  word["notes"] = !kanji["notes"].split("\\,")[0] ? "[]" : JSON.stringify(kanji["notes"].split("\\,"));
  word["source"] = !kanji["source"].split("\\,")[0] ? "[]" : JSON.stringify(kanji["source"].split("\\,"));

  return word;
}

function formatResponse(response, type) {
  if (type === KANJI) {
    response.en = JSON.parse(response.en);
    response.known_readings = JSON.parse(response.known_readings);
    response.radical_composition = JSON.parse(response.radical_composition);
    response.known_vocabulary = JSON.parse(response.known_vocabulary);
  } else if (type === VOCAB) {
    response.en = JSON.parse(response.en);
    response.known_readings = JSON.parse(response.known_readings);
    response.kanji_composition = JSON.parse(response.kanji_composition);
    response.sentences = JSON.parse(response.sentences);
    response.word_type = JSON.parse(response.word_type);
  } else if (type === RADICAL) {
    response.known_kanji = JSON.parse(response.known_kanji);
  }
  response.notes = JSON.parse(response.notes);
  response.source = JSON.parse(response.source);
  return response;
}

async function getWord(table, word) {
  let db = await getDBConnection();
  let qry = "SELECT * FROM " + table + " WHERE jp = ?";
  let results = await db.all(qry, word);
  await db.close();
  return results[0];
}

async function getDBConnection() {
  const db = await sqlite.open({
    filename:"japanese.db",
    driver: sqlite3.Database
  });
  return db;
}

app.use(express.static('public'));
const PORT = process.env.PORT || 8080;
app.listen(PORT);
