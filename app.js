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
const fs_sync = require("fs");

const fetch = require("node-fetch");
const e = require("express");
const { Console } = require("console");
const { response } = require("express");

const TSURUKAME = "5f281d83-1537-41c0-9573-64e5e1bee876";
const WANIKANI = "https://api.wanikani.com/v2/";

const WORD_TYPES = ["Radical", "Kanji", "Vocabulary"];
const VOCAB = "Vocabulary";
const KANJI = "Kanji";
const RADICAL = "Radical";


// These are super easy ways to have a global object that stores a subject_id => object with good info.
// only question is how do we keep it up to date after the server is initialized.
const WORDS_DICT = createDict(["radicals.txt", "kanji.txt", "vocabulary.txt"]);

// find out if there's a better way to do this.... because await is giving me problems.
function createDict(files) {
  let  dict = {}
  for (let file of files) {
    let content = JSON.parse(fs_sync.readFileSync(file, "utf8"));
    for (let word of content) {
      dict[word.id] = word;
    }
  }
  return dict;
}

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


// helperfunction for the "get all words endpoint";
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

// should rename, but basically it will ADD a new word based on the forms in the front-end.
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


// new endpoint (should maybe be post) that will try to see if you got the word right
// https://en.wikipedia.org/wiki/Levenshtein_distance
app.get("/matchCloseness", async function(req, res) {
  let word = "calisthenics";
  let misspelling = "calisthenist"

  res.send("lol");
})

// will modify a known word in the database.
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

// will remove a known word from the database.
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


// grabs a random word (can be vocab kanji or radical). Usually used with testing function.
app.get("/randomWord", async function(req, res) {
  try {
    let words = await getAllWords();
    res.json(words[Math.floor(Math.random() * words.length)]);
  } catch(err) {
    res.status(500).send("There's an error!");
  }
});


// used to SYNC completely WaniKani and my program. Doesn't work with large batches,
// and should never need to be used again. Also it only ADDS on to existing .txt files so you
// may get a lot of duplicated unless you completely wipe the .txt files. It is meant more as a
// blank slate sync.
app.post("/syncWaniKani", async function(req, res) {
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
        let subjectRequest = await fetch(WANIKANI + "subjects/" + subjects[i].subject_id, { // THIS COULD BE BROKEN.. MADE CHANGES TO recursiveFetchTime;
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

// used to actually sync the information from the .txt files into my database.
// realisitcally should never be used again as long as I maintain the current website.
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

// the thing I use to test different endpoints. Most of the code does very specific things and I
// should save all of it in somewhere  for future use. Most of it is to test functionality of
// wanikani but you know how it is.
app.get("/funnyGoofyTest", async function(req, res) {
  // useful info: the number corresponds to the last high tone mora. (I thinki)
  // 0: 平板式: starts low, goes UP. There is no high pitch mora so
  // 1: 頭高型: starts high, and the first mora is the last high pitch morea so it goes down and stays down.
  // 2-6: 尾高型 or 仲間型: the last high pitch mora hapens at mora 2-6, then it goes down!.



  // process the pitchAccents
  let data = (await fs.readFile("pitchAccents.txt", "utf8")).split("\n");


  let counter = 0;
  let reseponseData = [];
  let pitchLookup = {};
  for (let line of data) { // GO THROUGH EACH READING INDIVIDUALLY

    let lineData = line.split("\t");
    pitchLookup[lineData[0] + "\t" + lineData[1]] = {
      kanji: lineData[0],
      hiragana: lineData[1],
      pitchInfo: lineData[2]
    } // should have a whole lookup with all the right things!
  }


// big money question: should I add this info now to the database?
// or just look up and send back each time it's requested?


  // time to do a lookup for all the readings of each thing!
  // so this works mostly well
  for (let key of Object.keys(WORDS_DICT)) {
    let vocab = WORDS_DICT[key];
    if (vocab.context_sentences) { // sketchy way to find out if it's vocabulary!!
      for (let reading of vocab.known_readings) {
        let wordPitchInfo = pitchLookup[vocab.jp + "\t" + reading]; // want to try to find the combo! but this won't catch everything
        if (!wordPitchInfo) wordPitchInfo = pitchLookup[vocab.jp.replace(/する$/, "") + "\t" + reading.replace(/する$/, "")]; // checking する verbs
        if (!wordPitchInfo) wordPitchInfo = pitchLookup[allHiragana(vocab.jp) + "\t" + allHiragana(reading)];
        if (!wordPitchInfo) wordPitchInfo = pitchLookup[allKatakana(vocab.jp) + "\t" + allKatakana(reading)];
        // fun fact: This still doesn't catch everything! cool!
        if (wordPitchInfo) {
          reseponseData.push({
            vocab_kanji: vocab.jp,
            vocab_reading: reading,
            pitch_accent: wordPitchInfo.pitchInfo,
          });
          counter++;
        } else {
          console.log("Sorry this doesn't have pitch accent!: " + vocab.jp + " (" + reading + ")");
        }
      }
    }
  }
  console.log(counter);
  res.json(reseponseData);
});

// uses a fun little thing
function allHiragana(phrase) {
  let list = [...phrase] // basically makes a list out of the phrase.
  return list.map(char => char.charCodeAt(0)).map(char => (12449 <= char && char <= 12534) ? char - 96 : char).map(char => String.fromCharCode(char)).join("");
}

function allKatakana(phrase) {
  let list = [...phrase] // basically makes a list out of the phrase.
  return list.map(char => char.charCodeAt(0)).map(char => (12353 <= char && char <= 12438) ? char + 96 : char).map(char => String.fromCharCode(char)).join("");
}

app.get("/testingDBRehaul", async function(req, res) {
  let db = await getDBConnection();
  let counter = 0;
  for (let key of Object.keys(WORDS_DICT)) {
    let word = WORDS_DICT[key];
    if (typeof(word.en) === "string" && word.jp !== null) { // word is a radical and don't want null!
      // await db.run("INSERT INTO English (english, characters, type) VALUES (?, ?, ?)", [word.en.toLowerCase(), word.jp, "radical"]);
      // await db.run("INSERT INTO Kanji (characters, type) VALUES (?, ?)", [word.jp, "radical"]);

      // for (let kanjiId of word.kanji_ids) {
      //   if (WORDS_DICT[kanjiId]) { // we know the kanji so we can add it to the database
      //     await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [WORDS_DICT[kanjiId].jp, word.jp]);
      //   }
      // }
      // await db.run("INSERT INTO Source (characters, source, type) VALUES (?, ?, ?)", [word.jp, "WaniKani level " + word.level, "radical"]);
      // counter++;
    } else if (word.vocabulary_ids) { // word is a kanji
      // we can skip kanji-radical interactions because it was already handled in the previous cases.
      // await db.run("INSERT INTO Kanji (characters, type) VALUES (?, ?)", [word.jp, "kanji"]);
      // for (let en of word.en) {
      //   en = en.toLowerCase();
      //   await db.run("INSERT INTO English (english, characters, type) VALUES (?, ?, ?)", [en, word.jp, "kanji"]);
      // }
      // for (let reading of word.known_readings) {
      //   await db.run("INSERT INTO Readings (reading, characters, type) VALUES (?, ?, ?)", [reading, word.jp, "kanji"]);
      // }
      // await db.run("INSERT INTO Source (characters, source, type) VALUES (?, ?, ?)", [word.jp, "WaniKani level " + word.level, "kanji"]);
    } else if (word.context_sentences) { // word is a vocabulary
      for (let kanjiId of word.kanji_ids) {
        await db.run("INSERT INTO Vocabulary (characters, vocab) VALUES (?, ?)", [WORDS_DICT[kanjiId].jp, word.jp]);
      }
      // await db.run("INSERT INTO Kanji (characters, type) VALUES (?, ?)", [word.jp, "vocabulary"]);
      // for (let en of word.en) {
      //   en = en.toLowerCase();
      //   await db.run("INSERT INTO English (english, characters, type) VALUES (?, ?, ?)", [en, word.jp, "vocabulary"]);
      // }
      // for (let reading of word.known_readings) {
      //   await db.run("INSERT INTO Readings (reading, characters, type) VALUES (?, ?, ?)", [reading, word.jp, "vocabulary"]);
      // }
      // for (let sentence of word.context_sentences) {
      //   await db.run("INSERT INTO Sentences (characters, en, jp) VALUES (?, ?, ?)", [word.jp, sentence.en, sentence.jp]);
      // }
      // for (let wordType of word.word_type) {
      //   await db.run("INSERT Into WordType (characters, type) VALUES (?, ?)", [word.jp, wordType]);
      // }
      // await db.run("INSERT INTO Source (characters, source, type) VALUES (?, ?, ?)", [word.jp, "WaniKani level " + word.level, "vocabulary"]);
      // counter++;
    }
  }
  res.json(counter);

  // QUERY FOR RADICAL W/ EXAMPLE
  /*
    SELECT k.characters, k.type, e.english, r.characters AS "known_kanji", s.source,
    k.first_unlocked, k.last_studied, k.correct, k.wrong, k.longest_streak,
    (SELECT n.note from Notes n WHERE n.characters = k.characters) AS "note"
    FROM Kanji k, English e, Radicals r, Source s
    WHERE k.characters = e.characters AND k.type = e.type
    AND k.characters = r.radical
    AND k.characters = s.characters AND k.type = s.type
    AND k.type != "kanji"
    AND k.type != "vocabulary"
    AND k.characters = "人";
  */

  // QUERY FOR KANJI W/ EXAMPLE
  /*
    SELECT k.characters, k.type, e.english, r.reading, rad.radical, v.vocab, s.source,
    k.first_unlocked, k.last_studied, k.correct, k.wrong, k.current_streak, k.longest_streak
    (SELECT n.note from Notes n WHERE n.characters = k.characters) AS "note"
    FROM Kanji k, English e, Readings r, Radicals rad, Vocabulary v, Source s
    WHERE k.characters = e.characters AND k.type = e.type
    AND k.characters = r.characters AND k.type = r.type
    AND k.characters = s.characters AND k.type = s.type
    AND r.characters = rad.characters
    AND r.characters = v.characters
    AND k.type != "vocabulary"
    AND k.type != "radical"
    AND k.characters = "大"
  */

  // QUERY FOR RADICXALS W/ EXAMPLE
  /*
    SELECT k.characters, k.type, e.english, r.reading, v.characters, s.source, w.type, sen.jp, sen.en,
    k.first_unlocked, k.last_studied, k.correct, k.wrong, k.current_streak, k.longest_streak,
    (SELECT n.note from Notes n WHERE n.characters = k.characters) AS "note"
    FROM Kanji k, English e, Readings r, Vocabulary v, Sentences sen, Source s, WordType w
    WHERE k.characters = e.characters AND k.type = e.type
    AND k.characters = r.characters AND k.type = r.type
    AND k.characters = v.vocab
    AND k.characters = sen.characters
    AND k.characters = s.characters AND k.type = s.type
    AND k.characters = w.characters
    AND k.type != "kanji"
    AND k.type != "radical"
    AND k.characters = "手"
  */


  // let contents = await db.all(qry, ["kanji", "大", "%大%"]);

  // let wordObj = {
  //   en: [],
  //   known_readings: [],
  //   type: "kanji",
  //   radical_composition: [],
  //   known_vocabulary: [],
  //   sources: []
  // }
  // for (let row of contents) {
  //   if (!wordObj.en.includes(row.english)) wordObj.en.push(row.english);
  //   if (!wordObj.known_readings.includes(row.reading)) wordObj.known_readings.push(row.reading);
  //   if (!wordObj.radical_composition.includes(row.radical)) wordObj.radical_composition.push(row.radical);
  //   if (!wordObj.known_vocabulary.includes(row.vocab)) wordObj.known_vocabulary.push(row.vocab);
  //   if (!wordObj.sources.includes(row.source)) wordObj.sources.push(row.source);
  // }
  // res.json(wordObj);
});


// unlessing I'm learning 60+ new words (guru+) with each fetch... this should run fine.
app.get("/updateLastVisited",  async function(req, res) {
  let updatedDate = (await fs.readFile("lastUpdated.txt", "utf-8")).split("\n");
  let lastDate = updatedDate[updatedDate.length - 1]; // should be: updatedDate.length - 1, but for testing it's 0
  // do stuff from last date onward...

  let url = WANIKANI + "assignments?updated_after=" + lastDate;
  let assignments = await recursiveFetchTime(url, []); // hopefully this takes only like... 3 fetches max.


  let addedWords = [];
  // we have all of our assignments!!
  for (let entry of assignments) {
    let addedWord = await checkSubjectAndGrabIfDoesntExist(entry)
    if (Object.keys(addedWord).length !== 0) {
      addedWords.push(addedWord);
    }
  }

  // we've updated everything so we can say the last time we updated!
  let now = (new Date()).toISOString();
  await fs.appendFile("lastUpdated.txt", "\n" + now);

  res.json({
    last_updated: now,
    length: addedWords.length,
    words: addedWords
  });
});

// this function name is no longer aptly named. It does a lot of stuff. Need to refactor.
async function checkSubjectAndGrabIfDoesntExist(subject) {
  let subjectType = subject.data.subject_type;
  let returnWord = {};
  if(WORDS_DICT[subject.data.subject_id]) { // word exists, can basically ignore.
    console.log("I already know this " + subjectType + "(" + WORDS_DICT[subject.data.subject_id].jp + "). The new SRS level is: " + subject.data.srs_stage);
  } else { // new word moment
    console.log("");
    console.log("This " + subjectType + " is new! It's SRS is now: " + subject.data.srs_stage);
    if (subject.data.srs_stage >= 5) {
      console.log("Since the " + subjectType + " is higher than 5, it's at least Guru! And I can consider it learned!");
      let newWord = await fetch(WANIKANI + "subjects/" + subject.data.subject_id, {
        headers: {Authorization: "Bearer " + TSURUKAME}
      });
      newWord = await newWord.json();
      console.log("The new learned word is: " + newWord.data.characters);

      // THE WORD IS UPDATED NOW IN THE THING
      let finalThing
      if (subjectType === "radical") {
        finalThing = createRadicalResponse(newWord);
        updateJSONFile("radicals.txt", [finalThing]);
      } else if (subjectType === "kanji") {
        finalThing = createKanjiResponse(newWord);
        updateJSONFile("kanji.txt", [finalThing]);

      } else if (subjectType === "vocabulary") {
        finalThing = createVocabularyResponse(newWord)
        updateJSONFile("vocabulary.txt", [finalThing]);
      }
      WORDS_DICT[newWord.id] = finalThing; // making sure our internal state is the same thing as our words!


      let db = await getDBConnection();
      if (subjectType === "radical") {
        // can't assume we know all the kanji yet, so we just need the one's that we know!
        let kanjiList = [];
        for (let kanji of finalThing.kanji_ids) {
          if (WORDS_DICT[kanji]) {
            kanjiList.push(WORDS_DICT[kanji].jp);
          }
        }

        // simple insert into database
        await db.run("INSERT INTO Radical (jp, en, known_kanji, source) VALUES(?, ?, ?, ?)", [
          finalThing.jp, finalThing.en, JSON.stringify(kanjiList),
           JSON.stringify(["WaniKani level " + finalThing.level])
        ]);

        // now update the kanji that have this radical!
        for (let kanji of kanjiList) {
          let results = await db.get("SELECT * FROM Kanji WHERE jp = ?", [kanji]);
          if (results) { // it exists and we need to update
            let dbRadicalList = JSON.parse(results.radical_composition);
            if (!dbRadicalList.includes(finalThing.jp)) {
              dbRadicalList.push(finalThing.jp);
            }
            await db.run("UPDATE Kanji SET radical_composition = ? WHERE jp = ?", [JSON.stringify(dbRadicalList), kanji]);
          } else { // it doesn't exist and we need to INSERT a new kanji just for it to be there.
            console.log("welp idk this kanji yet!");
          }
        }

      } else if (subjectType === "kanji") {
        // can ignore radical because they have to be guru+ (at one point) if I'm adding a vocab
        let vocabList = [];
        for (let vocab of finalThing.vocabulary_ids) {
          if (WORDS_DICT[vocab]) {
            vocabList.push(WORDS_DICT[vocab].jp);
          }
        } // now have a LIST of all the vocabulary involved with our kanji! we can add to the table.

        // simple insertion into database. can assume we know all radicals because that's the only way to unlock the kanji.
        await db.run("INSERT INTO Kanji (jp, en, known_readings, radical_composition, known_vocabulary, source VALUES(?, ?, ?, ?, ?, ?)", [
          finalThing.jp, JSON.stringify(finalThing.en), JSON.stringify(finalThing.known_readings,
            JSON.stringify(finalThing.radical_ids.map(id => WORDS_DICT[id]).jp),
            JSON.stringify(vocabList),  JSON.stringify["WaniKani level " + finalThing.level])
        ]);

        //welp... now we need to update both RADICAL and VOCAB to have this kanji.
        for (let radical of finalThing.radical_ids) {
          let results = await db.get("SELECT * FROM Radical WHERE jp = ?", [WORDS_DICT[radical].jp]);
          if (results) { // it exists and we might need to update
            let dbKanjiList = JSON.parse(results.known_kanji);
            if (!dbKanjiList.includes(finalThing.jp)) {
              dbKanjiList.push(finalThing.jp);
            }
            await db.run("UPDATE Radical SET known_kanji = ? WHERE jp = ?", [JSON.stringify(dbKanjiList), WORDS_DICT[radical].jp]);
          } else { // it doesn't exist and we need to INSERT a new kanji just for it to be there.
            console.log("welp idk this radical yet!"); // this should be impossible.
          }
        }

        for (let vocab of vocabList) {
          let results = await db.get("SELECT * FROM Kanji WHERE jp = ?", [vocab]);
          if (results) { // it exists and we might need to update
            let dbKanjiList = JSON.parse(results.kanji_composition);
            if (!dbKanjiList.includes(finalThing.jp)) {
              dbKanjiList.push(finalThing.jp);
            }
            await db.run("UPDATE Vocabulary SET kanji_composition = ? WHERE jp = ?", [JSON.stringify(dbKanjiList), vocab]);
          } else { // it doesn't exist and we need to INSERT a new kanji just for it to be there.
            console.log("welp idk this vocab yet!");
          }
        }

      } else if (subjectType === "vocabulary") {

        // cringe fix but I think it works. Update: IT DOESN't
        let actualContextSentences = [];
        console.log(finalThing.context_sentences);
        for (let sentence of finalThing.context_sentences) {
          console.log(sentence);
          actualContextSentences.push[{
            en: sentence.en,
            jp: sentence.ja
          }];
        };
        let lowerCaseReadings = finalThing.en.map(word => word.toLowerCase());

        // WAIT..... can't insert new stuff without fixing the sentences lol.
        // simple insert into database. We can assume we know all the kanji_ids because that's the only way to unlock them.
        await db.run("INSERT INTO Vocabulary (jp, en, known_readings, kanji_composition, sentences, source, word_type) VALUES(?, ?, ?, ?, ?, ?, ?)", [
          finalThing.jp, JSON.stringify(lowerCaseReadings), JSON.stringify(finalThing.known_readings),
          JSON.stringify(finalThing.kanji_ids.map(id => WORDS_DICT[id].jp)), JSON.stringify(actualContextSentences),
          JSON.stringify(["WaniKani level " + finalThing.level]), JSON.stringify(finalThing.word_type)
        ]);

        // now update the kanji that have this vocab!!
        for (let kanji of finalThing.kanji_ids) {
          let results = await db.get("SELECT * FROM Kanji WHERE jp = ?", [WORDS_DICT[kanji].jp]);
          if (results) { // it exists and we need to update
            let dbVocabList = JSON.parse(results.known_vocabulary);
            if (!dbVocabList.includes(finalThing.jp)) {
              dbVocabList.push(finalThing.jp);
            }
            await db.run("UPDATE Kanji SET known_vocabulary = ? WHERE jp = ?", [JSON.stringify(dbVocabList), WORDS_DICT[kanji].jp]);
          } else { // it doesn't exist and we need to INSERT a new kanji just for it to be there.
            console.log("welp idk this kanji yet!");
          }
        }
      }
      returnWord.jp = newWord.data.characters;
      returnWord.subject_type = subjectType;
    } else {
      console.log("This " + subjectType + " does not have a WaniKani SRS level of 5 or higher, so it cannot be considered learned!");
    }
    console.log("");
  }
  return returnWord;
}
/*
{
  subject_type (string) -- ALL
  subject_id (integer/string) -- ALL
  jp (string) -- ALL
  en (list/string) - ALL (string only for radical)
  known_kanji (list) -- only RADICAL
  source (list) -- ALL
  known_readings -- KANJI and VOCAB
  radical_composition -- only KANJI
  known_vocabulary -- only KANJI
  kanji_composition -- only VOCAB
  sentences -- only VOCAB
  word_type -- only VOCAB
}
*/

app.get("")


// passed in a LIST with everything, will return the object that is necessary.
function findSubject(subjectIdentifier, subjectList) {
  for (let i = 0; i < subjectList.length; i++) {
    if (subjectIdentifier === subjectList[i].id) {
      return subjectList[i];
    } else {
    }
  }
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


// should make this general so I can use it for any request that queries the API
async function recursiveFetchTime(url, list) {
  if (url !== null) {
    let contents = await fetch(url, {
      headers: {Authorization: "Bearer " + TSURUKAME}
    });
    contents = await contents.json();

    for (let i = 0; i < contents.data.length; i++) {
      list.push(contents.data[i]); //can also do contents.data[i].data if we need less info
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
    filename: "japanese.db",
    driver: sqlite3.Database
  });
  return db;
}

app.use(express.static('public'));
const PORT = process.env.PORT || 8080;
app.listen(PORT);
