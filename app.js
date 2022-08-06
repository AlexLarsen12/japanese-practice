"use strict";
const express = require("express");
const app = express();

const multer = require("multer");
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(multer().none());

const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");

const fs = require("fs").promises;

const fetch = require("node-fetch");
const { create } = require("domain");
const { debuglog } = require("util");

const TSURUKAME = "5f281d83-1537-41c0-9573-64e5e1bee876";
const WANIKANI = "https://api.wanikani.com/v2/";

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

          // update any KANJI found!
          await updateKnownVocabulary(newWord.jp, newWord["kanji-composition"], db);

          // also maybe add vocab words if the vocab isn't known??
          let sentences = JSON.parse(newWord.sentences);
          for (let i = 0; i < sentences.length; i++) {
            for (let j = 0; j < sentences[i].vocab.length; j++) {
              let foundWord = (await db.all("SELECT * FROM Vocabulary WHERE jp = ?", sentences[i].vocab[j]))[0];

              if (!foundWord) {
                await db.run("INSERT INTO Vocabulary (jp) VALUES (?)", sentences[i].vocab[j]);
              }
            }
          }
        } else {
          let newWord = formatKanji(req.body);
          let qry = "INSERT INTO " + type + "(jp, en, known_readings, type, radical_composition, known_vocabulary, notes, source) VALUES (?, ?, ?, ? , ?, ?, ?, ?)";
          await db.all(qry, [newWord.jp, newWord.en, newWord["known-readings"],
          newWord.type, newWord["radical-composition"], newWord["known-vocabulary"], newWord.notes, newWord.source]);

          // update any RADICALS!!!
          await updateKnownKanji(newWord.jp, newWord["radical-composition"], db);
        }
        res.send("successful addition!");
      }
      await db.close();
    } catch(err) {
      res.status(500).send(err.message);
    }
  }
});

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
      if (!word.en) {
        word.en = req.body.en;
      }
      word.known_kanji = addToColumn(word.known_kanji, req.body["known-kanji"]);
      word.notes = addToColumn(word.notes, req.body.notes);
      word.source = addToColumn(word.source, req.body.source);

      await db.run("UPDATE " + table + " SET known_kanji = ?, notes = ?, source = ?, en = ? WHERE jp = ?",
                   [word.known_kanji, word.notes, word.source, word.en, word.jp]);

    } else if (table === KANJI) {

      word.en = addToColumn(word.en, req.body.en);
      word.known_readings = addToColumn(word.known_readings, req.body["known-readings"]);
      word.radical_composition = addToColumn(word.radical_composition, req.body["radical-composition"]);
      word.known_vocabulary = addToColumn(word.known_vocabulary, req.body["known-vocabulary"]);
      word.notes = addToColumn(word.notes, req.body.notes);
      word.source = addToColumn(word.source, req.body.source);

      await db.run("UPDATE " + table + " SET en = ?, known_readings = ?, radical_composition = ?, known_vocabulary = ?, notes = ?, source = ? WHERE jp = ?",
                   [word.en, word.known_readings, word.radical_composition, word.known_vocabulary, word.notes, word.source, word.jp]);

      await updateKnownKanji(req.body.jp, word.radical_composition, db);
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
      await updateKnownVocabulary(word.jp, word.kanji_composition, db);

      await db.run("UPDATE " + table + " SET en = ?, known_readings = ?, kanji_composition = ?, sentences = ?, notes = ?, source =?, word_type = ? WHERE jp = ?",
      [word.en, word.known_readings, word.kanji_composition, word.sentences, word.notes, word.source, word.word_type, word.jp]);

      let sentences = JSON.parse(word.sentences);
      for (let i = 0; i < sentences.length; i++) {
        let vocab = sentences[i].vocab;

        for (let j = 0; j < vocab.length; j++) {
          let foundWord = await db.get("SELECT * FROM Vocabulary WHERE jp = ?", vocab[j]);

          if (!foundWord) {
            await db.run("INSERT INTO Vocabulary (jp) VALUES (?)", vocab[j]);
          }
        }
      }
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

// not set up for multiple fetch calls in the beginning... so, do that now.
app.get("/syncWaniKani", async function(req, res) {
  try {
    let subjectType = req.query.type; // needs to be radical, kanji, vocabulary
    if (!(subjectType === "radical" || subjectType === "kanji" || subjectType === "vocabulary")) {
      throw new Error("u made an oopsies");
    }

    // initial fetches to get all the subject_ids that we need
    let subjects = await recursiveFetchTime(WANIKANI + "assignments?srs_stages=5,6,7,8,9&subject_types=" + subjectType, []);
    console.log(subjects.length);
    console.log("This should take... around " + (((1100 * subjects.length) + 2020) / 60000).toFixed(2) + " minutes");

    let bigSubjectObject = [];
    // my rates are limited to 60 per minute... RIP
    let delay = 1100 * ((subjects.length / 500) + 1);
    for (let i = 0; i < subjects.length; i++) {
      setTimeout(async function() {
        let subjectRequest = await fetch(WANIKANI + "subjects/" + subjects[i], {
          headers: {Authorization: "Bearer " + TSURUKAME}
        })
        subjectRequest = await subjectRequest.json();

        let subjectObj;
        if (subjectType === "radical") {
          subjectObj = createRadicalResponse(subjectRequest);
        } else if (subjectType === "kanji") {
          subjectObj = createKanjiResponse(subjectRequest);
        } else if (subjectType === "vocabulary") {
          subjectObj = createVocabularyResponse(subjectRequest);
        }

        bigSubjectObject.push(subjectObj);
        console.log("adding " + subjectObj.en + " " + subjectType + ". Number " + (i + 1) + " of " + subjects.length
                    + ". " + (((i+1) / subjects.length) * 100).toFixed(2) + "% complete");
      }, delay)
      delay += 1010
    }

    setTimeout(async function() {
      let filename = "radicals.txt";
      if (subjectType === "kanji") {
        filename = "kanji.txt";
      } else if (subjectType === "vocabulary") {
        filename = "vocabulary.txt";
      }

      await updateJSONFile(filename, bigSubjectObject)
      res.send(bigSubjectObject);
    }, delay + 1100);
  }
  catch (err) {
    res.status(500).send(err.message);
  }
});



// this part is quite messy simple due to the very similar setups of the radicals and kanji and vocabulary...
app.get('/syncTable', async function(req, res) {
  try {
    let subjectType = req.query.type; // needs to be radical, kanji, vocabulary
    if (!(subjectType === "radical" || subjectType === "kanji" || subjectType === "vocabulary")) {
      console.log(subjectType);
      throw new Error("u made an oopsies");
    }

    let db = await getDBConnection();

    let radicals = await fs.readFile("radicals.txt","utf8");
    radicals = JSON.parse(radicals);
    let kanjis = await fs.readFile("kanji.txt", "utf8");
    kanjis = JSON.parse(kanjis);
    let vocabulary = await fs.readFile("vocabulary.txt", "utf8");
    vocabulary = JSON.parse(vocabulary);

    let modifyCounter = 0;
    let addCounter = 0;
    if (subjectType === "radical") {
      for (let radical of radicals) {

        // adding in the correct known kanji
        let actuallyKnownKanji = [];
        for (let existingKanjiId of radical.kanji_ids) {
          let knownKanji = findSubject(existingKanjiId, kanjis);
          if (knownKanji) {
            actuallyKnownKanji.push(knownKanji.id);
          }
        }
        let kanjiFinal = [];
        for (let actuallyReallyKnownKanji of actuallyKnownKanji) {
          kanjiFinal.push(findSubject(actuallyReallyKnownKanji, kanjis).jp);
        }
        if (radical.jp !== null) {
          if (await db.all("SELECT * FROM Radical WHERE jp = ?", radical.jp).length !== 0) {
            await db.run("UPDATE Radical SET known_kanji = ? WHERE jp = ?", [JSON.stringify(kanjiFinal), radical.jp]);
            modifyCounter++;
           } else {
            await db.run("INSERT INTO Radical (jp, en, source) VALUES(?, ?, ?, ?)", [radical.jp, radical.en.toLowerCase(), radical.level]);
            addCounter++;
           }
        }
      }
    } else if (subjectType === "kanji") {
      for (let kanji of kanjis) {
        let kanjiEn = kanji.en.map(element => {
          return element.toLowerCase();
        });

        // can actually assume we know all the radicals!! (which is true);
        let radicalsList = [];
        for (let knownRadical of kanji.radical_ids) {
          radicalsList.push(findSubject(knownRadical, radicals).jp);
        }
        let radicalsListFinal = radicalsList.filter(element => {return element !== null});

        // aaaaaaaaaaaa
        let actuallyKnownVocab = [];
        for (let existingVocabId of kanji.vocabulary_ids) { // CAN'T ASSUME i KNOW ALL THE VOCABULARY :(
          let knownVocab = findSubject(existingVocabId, vocabulary);
          if (knownVocab) {
            actuallyKnownVocab.push(knownVocab.id);
          }
        }
        let vocabFinal = [];
        for (let actuallyReallyKnownVocab of actuallyKnownVocab) {
          vocabFinal.push(findSubject(actuallyReallyKnownVocab, vocabulary).jp);
        }

        if ((await db.all("SELECT * FROM Kanji WHERE jp = ?", kanji.jp)).length!== 0) {
          await db.run("UPDATE Kanji SET en = ?, known_readings = ?, radical_composition = ?, known_vocabulary = ?, source = ? WHERE jp = ?", [
            JSON.stringify(kanjiEn), JSON.stringify(kanji.known_readings), JSON.stringify(radicalsListFinal),
            JSON.stringify(vocabFinal), JSON.stringify(["WaniKani level " + kanji.level]), kanji.jp
          ]);
          modifyCounter++;
        } else {
          await db.run("INSERT INTO Kanji (jp, en, known_readings, radical_composition, known_vocabulary, source) VALUES(?, ?, ?, ?, ?, ?)", [
            kanji.jp, JSON.stringify(kanjiEn), JSON.stringify(kanji.known_readings),
            JSON.stringify(radicalsListFinal), JSON.stringify(vocabFinal), JSON.stringify(["WaniKani level " + kanji.level])
          ]);
          addCounter++;
        }
      }
    } else if (subjectType === "vocabulary") {
      for (let vocab of vocabulary) {
        let vocabEn = vocab.en.map(element => {
          return element.toLowerCase();
        });


        let kanjiList = [];
        for (let knownKanji of vocab.kanji_ids) {
          kanjiList.push(findSubject(knownKanji, kanjis).jp);
        }

        if ((await db.all("SELECT * FROM Vocabulary WHERE jp = ?", vocab.jp)).length !== 0) {
          await db.run("UPDATE Vocabulary SET en = ?, known_readings = ?, kanji_composition = ?, sentences = ?, source = ?, word_type = ? WHERE jp = ?", [
            JSON.stringify(vocabEn), JSON.stringify(vocab.known_readings), JSON.stringify(kanjiList),
            JSON.stringify(vocab.context_sentences), JSON.stringify(["WaniKani level " + vocab.level]),
            JSON.stringify(vocab.word_type), vocab.jp
          ]);
          modifyCounter++;
        } else {
          await db.run("INSERT INTO Vocabulary (jp, en, known_readings, kanji_composition, sentences, source, word_type) VALUES(?, ?, ?, ?, ?, ?, ?)", [
            vocab.jp, JSON.stringify(vocabEn), JSON.stringify(vocab.known_readings),
            JSON.stringify(kanjiList), JSON.stringify(vocab.context_sentences),
            JSON.stringify(["WaniKani level " + vocab.level]),
            JSON.stringify(vocab.word_type)
          ]);
          addCounter++;
        }
      }
    }
    res.send("modified " + modifyCounter + " and added " + addCounter + " of " + subjectType);
  } catch(err) {
    res.send(err.message);
  }
});

app.get("/funnyGoofyTest", async function(req, res) {
  let contents = await fetch(WANIKANI + "subjects?ids=723,1209,1252", {
    headers: {Authorization: "Bearer " + TSURUKAME}
  });
  contents = await contents.json();
  res.send(contents);
});


// passed in a LIST with everything, will return the object that is necessary.
function findSubject(subjectIdentifier, subjectList) {
  for (let i = 0; i < subjectList.length; i++) {
    if (subjectIdentifier === subjectList[i].id) {
      return subjectList[i];
    } else {
    }
  }
}


// combines ALL functionality.
async function actuallySyncThings() {
  // create big list
  // List will still contain some numbers instead of content, will need to figure this out...
  // write final thing to txt file
  // update tables with content
}

async function addKanjiToTable(subjects) {

}

async function addVocabularyToTable(subjects) {

}

async function addRadicalsToTable(subjects) {
  let counter = 0;
  let db = await getDBConnection();
  if (subjects[i].japanese !== null && (await db.all("SELECT * FROM Radical WHERE jp = ?", subjects[i].japanese)).length === 0) {
    let qry = "INSERT INTO Radical (jp, en, type, source) VALUES(?, ?, ?, ?)";
    await db.all(qry, [subjects[i].japanese, subjects[i].name.toLowerCase(), "radical", JSON.stringify(["Wanikani level " + subjects[i].level])]);
    counter++;
  }
  return counter;
}

function createRadicalResponse(radical) {
  return {
    en: radical.data.meanings[0].meaning,
    jp: radical.data.characters,
    level: radical.data.level,
    id: radical.id,
    kanji_ids: radical.data.amalgamation_subject_ids
  }
}

function createVocabularyResponse(vocab) {
  let resp = {
    id: vocab.id,
    jp: vocab.data.characters,
    kanji_ids: vocab.data.component_subject_ids,
    context_sentences: vocab.data.context_sentences,
    level: vocab.data.level,
    word_type: vocab.data.parts_of_speech
  }

  for (let entry of vocab.data.meanings) {
    if (!resp["en"]) {
      resp["en"] = [entry.meaning]
    } else {
      resp["en"] = resp["en"].concat(entry.meaning);
    }
  }

  for (let entry of vocab.data.readings) {
    if (!resp["known_readings"]) {
      resp["known_readings"] = [entry.reading]
    } else {
      resp["known_readings"] = resp["known_readings"].concat(entry.reading);
    }
  }
  return resp;
}

function createKanjiResponse(kanji) {
  let resp = {
    id: kanji.id,
    jp: kanji.data.characters,
    radical_ids: kanji.data.component_subject_ids,
    vocabulary_ids: kanji.data.amalgamation_subject_ids,
    level: kanji.data.level
  }

  for (let entry of kanji.data.meanings) {
    if (!resp["en"]) {
      resp["en"] = [entry.meaning]
    } else {
      resp["en"] = resp["en"].concat(entry.meaning);
    }
  }

  for (let entry of kanji.data.readings) {
    if (!resp["known_readings"]) {
      resp["known_readings"] = [entry.reading]
    } else {
      resp["known_readings"] = resp["known_readings"].concat(entry.reading);
    }
  }
  return resp;
}

async function updateJSONFile(filename, listData) {
  let fileContents = await fs.readFile(filename, "utf8");
  if (!fileContents) {
    await fs.writeFile(filename, JSON.stringify(listData, null, 2));
  } else {
    let newContents = JSON.parse(fileContents).concat(listData);
    await fs.writeFile(filename, JSON.stringify(newContents, null, 2));
  }
}

async function recursiveFetchTime(url, list) {
  if (url !== null) {
    let contents = await fetch(url, {
      headers: {Authorization: "Bearer " + TSURUKAME}
    });
    contents = await contents.json();

    for (let i = 0; i < contents.data.length; i++) {
      list.push(contents.data[i].data.subject_id)
    }

    await recursiveFetchTime(contents.pages.next_url, list)
    return list;
  }
}

/** -- helper functions -- */

// when we add kanji, we should update "known_kanji" in Radical table.
async function updateKnownKanji(kanji, radicalList, db) {
  radicalList = JSON.parse(radicalList);

  // want to loop through all the radical that make up this kanji.
  for (let i = 0; i < radicalList.length; i++) {
    let knownKanji = (await db.all("SELECT known_kanji FROM Radical WHERE jp = ?", radicalList[i]))[0];

    if (knownKanji) {
      knownKanji = JSON.parse(knownKanji.known_kanji);
      if (!knownKanji.includes(kanji)) {
        knownKanji.push(kanji); // add to the vocab list.
        await db.run("UPDATE Radical SET known_kanji = ? WHERE jp = ?", [JSON.stringify(knownKanji), radicalList[i]]);
      }
    } else { // roundabout - but the kanji does not exist... lets add it (even if it's empty)!
      await db.run("INSERT INTO Radical (jp, known_kanji) VALUES (?, ?)", [radicalList[i], [JSON.stringify([kanji])]]);
    }
  }
}

// when we add vocabulary, we should update "known_vocabulary" in Kanji table.
async function updateKnownVocabulary(vocab, kanjiList, db) {
  kanjiList = JSON.parse(kanjiList);

  // want to loop through all the kanji that make up this vocabulary.
  for (let i = 0; i < kanjiList.length; i++) {
    let knownVocabulary = (await db.all("SELECT known_vocabulary FROM Kanji WHERE jp = ?", kanjiList[i]))[0];

    if (knownVocabulary) {
      knownVocabulary = JSON.parse(knownVocabulary.known_vocabulary);
      if (!knownVocabulary.includes(vocab)) {
        knownVocabulary.push(vocab); // add to the vocab list.
        await db.run("UPDATE Kanji SET known_vocabulary = ? WHERE jp = ?", [JSON.stringify(knownVocabulary), kanjiList[i]]);
      }
    } else { // roundabout - but the kanji does not exist... lets add it (even if it's empty)!
      await db.run("INSERT INTO Kanji (jp, known_vocabulary) VALUES (?, ?)", [kanjiList[i], [JSON.stringify([vocab])]]);
    }
  }
}

function addToColumn(currentColumn, additionalContent) {
  let updatedList = JSON.parse(currentColumn);
  if (additionalContent) {
    updatedList = updatedList.concat(additionalContent.split("\\,"));
  }
  return JSON.stringify(updatedList);
}

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
