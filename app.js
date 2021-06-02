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
    // line below makes sure it's in proper format for querying database.
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
    let db = await getDBConnection();
    let radical = await db.all("SELECT * FROM Radical");

    let kanji = await db.all("SELECT * FROM Kanji");
    for (let i = 0; i < kanji.length; i++) {
      kanji[i] = formatResponse(kanji[i], KANJI);
    }

    let vocab = await db.all("SELECT * FROM Vocabulary");
    for (let i = 0 ; i < vocab.length; i++) {
      vocab[i] = formatResponse(vocab[i], VOCAB);
    }

    res.json(radical.concat(kanji).concat(vocab));
  } catch(err) {
    res.type("text");
    res.status(500).send(err);
  }
});

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
          let qry = "INSERT INTO " + type + "(jp, en, type) VALUES(?, ?, ?)";
          await db.all(qry, [req.body.jp, req.body.en, req.body.type]);
        } else if (type === VOCAB) {
          let newWord = formatVocabulary(req.body);
          let qry = "INSERT INTO " + type + "(jp, en, known_readings, type, kanji_composition, sentences) VALUES(?, ?, ?, ?, ?, ?)";
          await db.all(qry, [newWord.jp, newWord.en, newWord["known-readings"],
          newWord.type, newWord["kanji-composition"], newWord.sentences]);
        } else {
          let newWord = formatKanji(req.body);
          let qry = "INSERT INTO " + type + "(jp, en, known_readings, type, radical_composition, known_vocabulary) VALUES (?, ?, ?, ? , ?, ?)";
          await db.all(qry, [newWord.jp, newWord.en, newWord["known-readings"],
          newWord.type, newWord["radical-composition"], newWord["known-vocabulary"]]);
        }
        res.send("successful addition!");
      }
      await db.close();
    } catch(err) {
      res.status(500).send("uh oh you done F'd up");
    }
  }
});

app.post('/modifyWord', async function(req, res) {
  try {
    let db = await getDBConnection();

    let table = req.body.type.toLowerCase().charAt(0).toUpperCase() + req.body.type.slice(1);
    let word = (await db.all("SELECT * FROM " + table + " WHERE jp = ?", req.body.jp));
    if (word.length === 0) {
      throw new Error("LOL this word doesn't exist"); // FIGURE OUT A BETTER WAY TO THROW ERRORS.
    }
    word = word[0];

    if (table === RADICAL) {
      res.status(400).send("Cannot add meanings to radicals. There should be one primary meaning only");
    } else if (table === KANJI) {
      console.log(req.body);
      word.en = JSON.parse(word.en);
      let enAddition = req.body.en.split("\\,");
      if (enAddition[0] !== "") {
        word.en = word.en.concat(enAddition);
      }
      word.en = JSON.stringify(word.en);

      word.known_readings = JSON.parse(word.known_readings);
      let readingAddition = req.body["known-readings"].split("\\,");
      if (readingAddition[0] !== "") {
        word.known_readings = word.known_readings.concat(readingAddition);
      }
      word.known_readings = JSON.stringify(word.known_readings);

      word.radical_composition = JSON.parse(word.radical_composition);
      let radicalAddition = req.body["radical-composition"].split("\\,");
      if (radicalAddition[0] !== "") {
        word.radical_composition = word.radical_composition.concat(radicalAddition);
      }
      word.radical_composition = JSON.stringify(word.radical_composition);

      word.known_vocabulary = JSON.parse(word.known_vocabulary);
      let vocabAddition = req.body["known-vocabulary"].split("\\,");
      if (vocabAddition[0] !== "") {
        word.known_vocabulary = word.known_vocabulary.concat(vocabAddition);
      }
      word.known_vocabulary = JSON.stringify(word.known_vocabulary);

      await db.run("UPDATE " + table + " SET en = ?, known_readings = ?, radical_composition = ?, known_vocabulary = ? WHERE jp = ?",
                   [word.en, word.known_readings, word.radical_composition, word.known_vocabulary, word.jp]);
      res.json(word);
    } else if (table === VOCAB) {
      res.json(word);
    }
    await db.close();
  } catch (err) {
    console.log(err);
    res.status(500).send("error time boys");
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
  let table = WORD_TYPES[Math.floor(Math.random() * WORD_TYPES.length)];

  try {
    let db = await getDBConnection();
    let results = await db.all("SELECT * FROM " + table);
    res.json(results[Math.floor(Math.random() * results.length)]);
  } catch(err) {
    res.status(500).send("There's an error!");
  }
});


/** -- helper functions -- */

function formatVocabulary(vocab) {
  let word = {};

  word.en = JSON.stringify(vocab.en.split("\\,"));
  word.jp = vocab.jp;
  word.type = vocab.type;
  word["known-readings"] = JSON.stringify(vocab["known-readings"].split("\\,"));
  word["kanji-composition"] = JSON.stringify(vocab["kanji-composition"].split("\\,"));
  word.sentences = [];

  for (let i = 0; i < vocab["sentence-jp"].split("\\,").length; i++) {
    let sentenceObj = {};
    sentenceObj.jp = vocab["sentence-jp"].split("\\,")[i];
    sentenceObj.en = vocab["sentence-en"].split("\\,")[i];

    let vocabArr = [];
    for (let j = 0; j < vocab["sentence-vocab"].split("\\,")[i].split("*").length; j++) {
      vocabArr.push(vocab["sentence-vocab"].split("\\,")[i].split("*")[j]);
    }
    sentenceObj.vocab = vocabArr;
    word.sentences.push(sentenceObj);
  }
  word.sentences = JSON.stringify(word.sentences);

  return word;
}

function formatKanji(kanji) {
  let word = {};

  word.en = JSON.stringify(kanji.en.split("\\,"));
  word.jp = kanji.jp;
  word.type = kanji.type;

  word["known-readings"] = JSON.stringify(kanji["known-readings"].split("\\,"));
  word["radical-composition"] = JSON.stringify(kanji["radical-composition"].split("\\,"));
  word["known-vocabulary"] = JSON.stringify(kanji["known-vocabulary"].split("\\,"));

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
  }
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
