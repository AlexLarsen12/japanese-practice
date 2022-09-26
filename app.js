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
const { allowedNodeEnvironmentFlags } = require("process");
const e = require("express");
const { create } = require("domain");
// const { rawListeners } = require("process");
// const { type } = require("os");
// const e = require("express");

const TSURUKAME = "5f281d83-1537-41c0-9573-64e5e1bee876";
const WANIKANI = "https://api.wanikani.com/v2/";

const WORD_TYPES = ["radical", "kanji", "vocabulary"];
const TABLES = ["English", "Kanji", "Notes", "PitchInfo", "Radicals", "Readings", "Sentences",
                "Source", "Vocabulary", "WordType"]; // might be useful??
const FILE_NAMES = ["infoFiles/radical.json", "infoFiles/kanji.json", "infoFiles/vocabulary.json"]

// BIG NOTE: YOU HAVE THE FOLLOWING DATA THAT NEEDS TO BE IN SYNC
//
// ID_TO_WORD
// WORD_TO_ID
// allWords.json
// vocabulary.json/kanji.json/radicals.json
// japanese-new.db
//
// anytime you make ANY modification to ANYTHING. (adding/removing/etc),
// these 5 need to be in sync in some way.

// This is a super easy way to have a global object that stores a subject_id => object with good info.
// only question is how do we keep it up to date after the server is initialized.
const ID_TO_WORD = createIdToWordDict();
function createIdToWordDict() {
  let  dict = {}
  for (let file of FILE_NAMES) {
    let content = JSON.parse(fs_sync.readFileSync(file, "utf8"));
    for (let word of content) dict[word.id] = word;
  }
  return dict;
}
// WE RE-CREATE THE DICT EVERY TIME WE LOAD THE PAGE. IT IS BASED OFF OF THE FILES.

// THIS INFORMATION SHOULD _NEVER_ CHANGE
const PITCH_INFO = createPitchInfoDict();
function createPitchInfoDict() {
  if (!fs_sync.existsSync("infoFiles/pitchLookup.json")) {
    // process the pitchAccents
    let data = (fs_sync.readFileSync("infoFiles/pitchAccents.txt", "utf8")).split("\n");

    let pitchLookup = {};
    for (let line of data) { // GO THROUGH EACH READING INDIVIDUALLY
      let lineData = line.split("\t");
      pitchLookup[lineData[0] + "\t" + lineData[1]] = {
        kanji: lineData[0],
        hiragana: lineData[1],
        pitchInfo: lineData[2]
      } // should have a whole lookup with all the right things!
    }

    fs_sync.writeFileSync("infoFiles/pitchLookup.json", JSON.stringify(pitchLookup, null, 2), "utf8");
    return pitchLookup;
  } else {
    return JSON.parse(fs_sync.readFileSync("infoFiles/pitchLookup.json", "utf8"));
  }
}

let WORD_TO_ID = createWordToIdDictionary();
function createWordToIdDictionary() {
  let dict = {};
  for (let type of WORD_TYPES) {
    let contents = JSON.parse(fs_sync.readFileSync("infoFiles/" + type + ".json", "utf-8"));
    for (let word of contents) {
      dict[word.jp] ? dict[word.jp][type] = word: dict[word.jp] = {[type]: word};
    }
  }
  return dict;
}

// Returns the word that is specified. Requires also query parameter of "type" to be passed in.
// "type" can be - "vocabulary", "kanji", or "radical".
// UPDATED TO WORK WITH JAPANESE NEW.db 8/24/2022
app.get('/word/:word', async function(req, res) {
  try {
    let type = req.query["type"];
    if (!type) throw new Error("Please input a type!!");
    if (!WORD_TYPES.includes(type)) throw new Error("Sorry this word type is unrecognized");

    let word = req.params.word;
    let resp = await getWord(type, word);
    if (!resp) throw new Error("This word isn't known yet!!!");
    res.json(resp);
  } catch(err) {
    res.type("text").status(500).send(err.message);
  }
});

// returns all words in a list!
// updated 9/19/2022... This is way faster if an obj does exist. I don't quite like that there are
// a bajillion objects that need to be updated independently now, so will maybe look for a fix for that
// in the future.
// Only sends back the japanese, the english, and the readings.
app.get("/allWords", async function(req, res) {
  try {
    await fs.access("infoFiles/allWords.json");
    res.json(JSON.parse(await fs.readFile("infoFiles/allWords.json")));
  } catch(err) {
    if (err.code === "ENOENT") {
      let db = await getDBConnection();
      let allWords = []

      let subjects = await db.all("SELECT * FROM Kanji ORDER BY type DESC, first_unlocked DESC");
      for (let subject of subjects) {
        allWords.push({
          jp: subject.characters,
          type: subject.type,
          en: (await db.all("SELECT * FROM English WHERE characters = ? AND type = ?", subject.characters, subject.type)).map(line => line.english),
          known_readings: (await db.all("SELECT * FROM Readings WHERE characters = ? AND type =?", subject.characters, subject.type)).map(line => line.reading)
        })
      }
      await fs.writeFile("infoFiles/allWords.json", JSON.stringify(allWords, null, 2));
      res.json(allWords);
    } else {
      res.type("text").status(500).send(err.message);
    }
  }
});

// grabs a random word (can be vocab kanji or radical).
// returns ALL information!
app.get("/randomWord", async function(req, res) {
  try {
    let db = await getDBConnection(); // maybe
    let words = await db.all("SELECT * FROM Kanji WHERE type ='radical'");
    let target = words[Math.floor(Math.random() * words.length)];
    res.json(await getWord(target.type, target.characters, db)); // returns a lot of information, could be useless?
  } catch(err) {
    res.status(500).send(err.message);
  }
});
// should maybe make this grab from the object if it exists??

// new endpoint (should maybe be post) that will try to see if you got the word right
// https://en.wikipedia.org/wiki/Levenshtein_distance
// unfinished.
app.get("/matchCloseness", async function(req, res) {
  let word = "calisthenics";
  let misspelling = "calisthenist"

  res.send("lol");
})

// updated 8/27/2022. Blanket add that doesn't care about the type of the word. Should maybe make it more generic
// so I can use this to "MODIFY" but idk...
// should rename, but basically it will ADD a new word based on the forms in the front-end.
app.post("/addWord", async function (req, res) {
  // ASSUMING ALL ENTRIES ARE IN A LIST PLEASE PUT THEM IN A LIST.
  res.type("text");
  try {
    if (!req.body.jp || !req.body.type) throw new Error("You must have at least the japanese and the type to add a new word");
    if (!WORD_TYPES.includes(req.body.type)) throw new Error("This is an unrecognized word type");

    let wordCheck = await db.get("SELECT * FROM Kanji WHERE characters = ? AND type = ?", [req.body.jp, req.body.type]);
    if (wordCheck) throw new Error(req.body.jp + " is an already known " + req.body.type);

    let db = await getDBConnection();
    let jp = req.body.jp;
    let type = req.body.type;

    await db.run("INSERT INTO Kanji (characters, type) VALUES (?, ?)", [jp, type]);
    if(req.body.en) await req.body.en.forEach(async en => await db.run("INSERT INTO English (english, characters, type) VALUES (?, ?, ?)", [en, jp, type]));
    if (req.body.sources) await req.body.sources.forEach(async source => await db.run("INSERT INTO Source (characters, source, type) VALUES (?, ?, ?)", [jp, source, type]));
    if (req.body.notes) await req.body.notes.forEach(async note => await db.run("INSERT INTO Notes (characters, type, note) VALUES (?, ?, ?)", [jp, type, note]));
    if (req.body["known-kanji"]) await req.body["known-kanji"].forEach(async kanji => await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [kanji, jp]));
    if (req.body["known-readings"]) await req.body["known-readings"].forEach(async reading => await db.run("INSERT INTO Readings (reading, characters, type) VALUES (?, ?, ?)", [reading, jp, type]));
    if (req.body["radical-composition"]) await req.body["radical-composition"].forEach(async radical => await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [jp, radical]))
    if (req.body["known-vocabulary"]) await req.body["known-vocabulary"].forEach(async vocab => await db.run("INSERT INTO Vocabulary (characters, vocab) VALUES (?, ?)", [jp, vocab]))
    if (req.body["kanji-composition"]) await req.body["kanji-composition"].forEach(async kanji => await db.run("INSERT INTO Vocabulary (characters, vocab) VALUES (?, ?)", [kanji, jp]));
    if (req.body["word-type"]) await req.body["word-type"].forEach(async wordType => await db.run("INSERT INTO WordType (characters, type) VALUES (?, ?)", [jp, wordType]));
    if (req.body.sentences) await req.body.sentences.forEach(async sen => await db.run("INSERT INTO Sentences (characters, en, jp) VALUES (?, ?, ?)", [jp. sen.en, sen.jp]));

    // THIS HAS A SPECIFIC WAY YOU NEED TO ENTER THE PITCHINFO. IF IT DOESN'T EXIST. I WILL LOOKIT UP MYSELF.
    if (req.body["pitch-data"]) {
      await req.body["pitch-data"].forEach(async info => await db.run("INSERT INTO PitchInfo (characters, reading, pitch) VALUES (?, ?, ?)", [jp, info.reading, info.pitch]));
    } else if (type === "vocabulary") {
      for (reading of req.body["known-readings"]) {
        let pitchInfo = pitchLookup(jp, reading);
        if (pitchInfo) await db.run("INSERT INTO PitchInfo (characters, reading, pitch) VALUES (?, ?, ?)", [jp, reading, pitchInfo.pitchInfo]);
      }
    }

    // need to add words to , and the respective .json file...
    // should be a new word. ALL CONTAINED WITHIN BODY
    let knownReadings = req.body["known-readings"] ? req.body["known-readings"] : [];
    let en = req.body.en ? req.body.en : [];
    let allWords = JSON.parse(await fs.readFile("infoFiles/allWords.json", "utf-8"));
    allWords.push({jp: jp, type: type, en: en, known_readings: knownReadings});
    await fs.writeFile("infoFiles/allWords.json", JSON.stringify(allWords, null, 2));

    delete req.body.type; // this key is no longer needed to be added to the next parts
    // (plus the key is saved in the type variable)

    // need to create a new unused ID
    let newId = createUniqueId();
    req.body.id = newId;
    ID_TO_WORD[newId] = req.body;
    await updateJSONFile("infoFiles/" + type + ".json", [req.body]);
    // somehow need to actually go from the kanji themselves... to find the ID...
    // currently does not do this.

    await db.close();
    res.send("New " + type + " added: " + jp);
  } catch(err) {
    res.status(500).send(err.message);
  }
});

// the thing I use to test different endpoints. Most of the code does very specific things and I
// should save all of it in somewhere  for future use. Most of it is to test functionality of
// wanikani but you know how it is.
app.get("/funnyGoofyTest", async function(req, res) {
  // a
});

// OUTDATED (and deleted) AS OF 9/20/2022
// will modify a known word in the database.
app.post('/modifyWord', async function(req, res) {
});

// will remove a known word from the website in its entirity. should be working as of 9/25/2022.
// requires a word and the type to remove.
app.post('/removeWord', async function(req, res) {
  try {
    if (!req.body.jp) throw new Error("Please add a subject to remove.");
    if (!WORD_TYPES.includes(req.body.type)) throw new Error("You must also include the type of subject you wish to remove.");

    let db = await getDBConnection();
    let subjectTypeCombo = await db.get("SELECT * FROM Kanji WHERE characters = ? AND type = ?", [req.body.jp, req.body.type])
    if (!subjectTypeCombo) throw new Error("This subject/type combination is not currently known");
    // now my error checking is done.

    // run through every table in the DB and just try to delete any record of its existence.
    // need to be careful on the tables that have no reference to a "type" cuz it could screw it up.
    await db.run("DELETE FROM Kanji WHERE characters = ? AND type = ?", [subjectTypeCombo.characters, subjectTypeCombo.type]);
    await db.run("DELETE FROM English WHERE characters =? AND type = ?", [subjectTypeCombo.characters, subjectTypeCombo.type]);
    await db.run("DELETE FROM Notes WHERE characters =? AND type = ?", [subjectTypeCombo.characters, subjectTypeCombo.type]);
    await db.run("DELETE FROM Readings WHERE characters =? AND type = ?", [subjectTypeCombo.characters, subjectTypeCombo.type]);
    await db.run("DELETE FROM Source WHERE characters =? AND type = ?", [subjectTypeCombo.characters, subjectTypeCombo.type]);
    if (req.body.type === "radical") {
      await db.run("DELETE FROM Radicals WHERE radical = ?", [subjectTypeCombo.characters]);
    } else if (req.body.type === "kanji") {
      await db.run("DELETE FROM Radicals WHERE characters = ?", [subjectTypeCombo.characters]);
      await db.run("DELETE FROM Vocabulary WHERE characters = ?", [subjectTypeCombo.characters]);
    } else if (req.body.type === "vocabulary") {
      await db.run("DELETE FROM PitchInfo WHERE characters = ?", [subjectTypeCombo.characters]);
      await db.run("DELETE FROM Sentences WHERE characters = ?", [subjectTypeCombo.characters]);
      await db.run("DELETE FROM Vocabulary WHERE vocab = ?", [subjectTypeCombo.characters]);
      await db.run("DELETE FROM WordType WHERE characters = ?", [subjectTypeCombo.characters]);
    }

    let wordId = await removeFromFile("infoFiles/" + subjectTypeCombo.type + ".json", subjectTypeCombo.characters);
    if (wordId) delete ID_TO_WORD[wordId]; // I don't like this solution... I don't know if it works either.
    await removeFromFile("infoFiles/allWords.json", subjectTypeCombo.characters, subjectTypeCombo.type);
    // above should probably (untested) DELETE from everything.

    res.type("text").send("Successfully deleted the " + subjectTypeCombo.type + ": " + subjectTypeCombo.characters + " from the database.");
  } catch(err) {
    res.status(500).type("text").send(err.message);
  }
});

// SUPER UNTESTED AS OF 9/25/2022. It should work, but we know how that goes. MAKE SURE TO GIT
// PUSH BEFORE EVER CALLING THIS.
// unlessing I'm learning 60+ new words (guru+) with each fetch... this should run fine.
app.get("/updateLastVisited",  async function(req, res) {
  let updatedDate = (await fs.readFile("infoFiles/lastUpdated.txt", "utf-8")).split("\n");
  let lastDate = updatedDate[updatedDate.length - 1];

  let url = WANIKANI + "assignments?updated_after=" + lastDate;
  let assignments = await recursiveFetchTime(url, []); // hopefully this takes only like... 3 fetches max.

  let addedWords = [];
  // we have all of our assignments!!
  for (let entry of assignments) {
    let addedWord = await findIfSubject(entry);
    if (addedWord) {
      ID_TO_WORD[addedWord.id] = addedWord; // making sure our internal state is the same thing as our words!
      WORD_TO_ID[addedWord.jp] ?  WORD_TO_ID[addedWord.jp][entry.data.subject_type] = addedWord : WORD_TO_ID[addedWord.jp] = {[entry.data.subject_type]: addedWord};
      await addWordToDBFromWaniKani(addedWord, entry.data.subject_type);
      addedWords.push({jp: addedWord.jp, type: entry.data.subject_type});
    }
    // this is largely untested. as of 9/26/2022 update. Caution ahead!
  }

  // we've updated everything so we can say the last time we updated!
  let now = (new Date()).toISOString();
  await fs.appendFile("infoFiles/lastUpdated.txt", "\n" + now);

  res.json({
    assignments_checked: assignments.length,
    last_updated: now,
    length: addedWords.length,
    words: addedWords
  });
});

/** -- helper functions -- */

// hopefully this doesn't have to run too often
// My unique id's will be negative since the ids for WaniKani are all positive.
function createUniqueId() {
  let num = Math.floor(Math.random() * 1000);
  while (ID_TO_WORD[num]) num = (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) * -1;
  return num;
}

// so this is the crude method I've come up with for finding the mora of a reading. I think it works... but I'm not sure.
function countMora(reading) {
    let mora = 0;
    reading = allHiragana(reading);
    for (let characters of reading) {
      if (!characters.match(/[ぁぃぅぇぉょゃゅゎ]/)) mora++;
    }
    return mora;
}

// removes a word from the given file (vocabulary/kanji/radical).
// also returns the subjects ID so you can properly remove it from ID_TO_WORD
async function removeFromFile(filename, wordToRemove, type) {
  let subjectId;
  let currentSubjects = JSON.parse(await fs.readFile(filename, "utf8"));
  console.log(currentSubjects.length);
  let filteredSubjects = currentSubjects.filter(subject => {
    if (subject.jp !== wordToRemove && !type) return subject;
    if (subject.jp !== wordToRemove || type && subject.jp === wordToRemove && subject.type !== type) return subject;
    subjectId = subject.id;
  })
  console.log(filteredSubjects.length);
  await fs.writeFile(filename, JSON.stringify(filteredSubjects, null, 2));
  return subjectId;
}

// for a SPECIFIC reading.
function findPitchInfo(kanji, reading) {
  let wordPitchInfo = PITCH_INFO[kanji + "\t" + reading] // try to find the combo in here, but it won't work for everything
  if (!wordPitchInfo) wordPitchInfo = PITCH_INFO[kanji.replace(/する$/, "") + "\t" + reading.replace(/する$/, "")]; // checking する verbs
  if (!wordPitchInfo) wordPitchInfo = PITCH_INFO[allHiragana(kanji) + "\t" + allHiragana(reading)];
  if (!wordPitchInfo) wordPitchInfo = PITCH_INFO[allKatakana(kanji) + "\t" + allKatakana(reading)];
  // fun fact, this doesn't get everything :(
  return wordPitchInfo;
}

// will return a word with COMPLETE INFORMATIONof any type and any word. Will return nothing if can't find
async function getWord(type, word, db) {
  if (!db) db = await getDBConnection();
  let data = await db.get("SELECT * FROM Kanji WHERE characters = ? AND type = ?", [word, type]);
  if (data) {
    let wordObj = {
      jp: data.characters,
      type: type,
      en: (await db.all("SELECT * FROM English WHERE characters = ? AND type = ?", data.characters, type)).map(line => line.english),
      last_studied: data.last_studied,
      correct: data.correct,
      wrong: data.wrong,
      current_streak: data.current_streak,
      longest_streak: data.longest_streak,
      first_unlocked: data.first_unlocked,
      notes: (await db.all("SELECT * FROM Notes WHERE characters = ? AND type = ?", data.characters, type)).map(line => line.note),
      source: (await db.all("SELECT * FROM Source WHERE characters = ? AND type = ?", data.characters, type)).map(line => line.source)
    }

    if (type === "kanji" || type === "vocabulary") wordObj.known_readings =  (await db.all("SELECT * FROM Readings WHERE characters = ? AND type = ?", [data.characters, type])).map(line => line.reading);
    if (type === "radical") {
      wordObj.known_kanji = (await db.all("SELECT * FROM Radicals WHERE radical = ?", data.characters)).map(line => line.characters);
    } else if (type === "kanji") {
      wordObj.radical_composition = (await db.all("SELECT * FROM Radicals WHERE characters = ?", data.characters)).map(line => line.radical);
      wordObj.known_vocabulary =  (await db.all("SELECT * FROM Vocabulary WHERE characters = ? ", data.characters)).map(line => line.vocab);
    } else if (type === "vocabulary") {
      wordObj.kanji_composition = (await db.all("SELECT * FROM Vocabulary WHERE vocab = ?", data.characters)).map(line => line.characters);
      wordObj.word_type = (await db.all("SELECT * FROM WordType WHERE characters = ?", data.characters)).map(line => line.type);
      wordObj.sentences = (await db.all("SELECT * FROM Sentences WHERE characters = ?", data.characters)).map(line => {return {en: line.en, jp: line.jp}});
      wordObj.pitch_data = (await db.all("SELECT * FROM PitchInfo WHERE characters = ?", data.characters)).map(line => {return {reading: line.reading, pitch: line.pitch}});
    }
    await db.close();
    return wordObj;
  }
  await db.close();
}

// uses a fun little thing
function allHiragana(phrase) {
  let list = [...phrase] // basically makes a list out of the phrase.
  return list.map(char => char.charCodeAt(0)).map(char => (12449 <= char && char <= 12534) ? char - 96 : char).map(char => String.fromCharCode(char)).join("");
}

function allKatakana(phrase) {
  let list = [...phrase] // basically makes a list out of the phrase.
  return list.map(char => char.charCodeAt(0)).map(char => (12353 <= char && char <= 12438) ? char + 96 : char).map(char => String.fromCharCode(char)).join("");
}

async function addWordToDBFromWaniKani(finalThing, subjectType) {
   let db = await getDBConnection();
   await db.run("INSERT INTO Kanji (characters, type) VALUES (?, ?)", [finalThing.jp, subjectType]);
   await db.run("INSERT INTO Source (characters, source, type) VALUES (?, ?, ?)", [finalThing.jp, "WaniKani level: " + finalThing.level, subjectType]);

   if (subjectType === "radical") finalThing.en = [finalThing.en]; //maybe should stay consistent with this being a list or not.
   let lowerCaseReadings = finalThing.en.map(word => word.toLowerCase());
   await lowerCaseReadings.forEach(async en => await db.run("INSERT INTO English (english, characters, type) VALUES (?, ?, ?)", [en, finalThing.jp, subjectType]));

  let allWords = JSON.parse(await fs.readFile("infoFiles/allWords.json"));
  let word = {
    jp: finalThing.jp,
    type: subjectType,
    en: lowerCaseReadings
  };
  finalThing.known_readings ? (word.known_readings = finalThing.known_readings) : word.known_readings = [];
  allWords.push(word);
  await fs.writeFile("infoFiles/allWords.json", JSON.stringify(allWords, null, 2));
  // this is a VERY scuffed way to update this for every word added. I don't really like it, but it should
  // keep things up to date for now.

   if (subjectType === "radical") {
     await finalThing.kanji_ids.forEach(async kanjiId => { if (ID_TO_WORD[kanjiId]) await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [ID_TO_WORD[kanjiId].jp, finalThing.jp])});

   } else if (subjectType === "kanji") {
     await finalThing.radical_ids.forEach(async radicalId => {
      if (ID_TO_WORD[radicalId].jp !== null) {
        await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [finalThing.jp, ID_TO_WORD[radicalId].jp])
      }
    }); //don't want to add the radicals that don't exist.

     await finalThing.vocabulary_ids.forEach(async vocabId => { if (ID_TO_WORD[vocabId]) await db.run("INSERT INTO Radicals (characters, vocab) VALUES (?, ?)", [finalThing.jp, ID_TO_WORD[vocabId].jp])});
     await finalThing.known_readings.forEach(async reading => await db.run("INSERT INTO Readings (reading, characters, type) VALUES (?, ?, ?)", [reading, finalThing.jp, subjectType]));

   } else if (subjectType === "vocabulary") {
     await finalThing.known_readings.forEach(async reading => await db.run("INSERT INTO Readings (reading, characters, type) VALUES (?, ?, ?)", [reading, finalThing.jp, subjectType]));
     await finalThing.word_type.forEach(async wordType => await db.run("INSERT INTO WordType (characters, type) VALUES (?, ?)", [finalThing.jp, wordType]));
     await finalThing.kanji_ids.forEach(async kanjiId => await db.run("INSERT INTO Vocabulary (characters, vocab) VALUES (?, ?)", [ID_TO_WORD[kanjiId].jp, finalThing.jp]));

     for (let reading of finalThing.known_readings) {
       let pitchInfo = findPitchInfo(finalThing.jp, reading);
       if (pitchInfo) await db.run("INSERT INTO PitchInfo (characters, reading, pitch) VALUES (?, ?, ?)", finalThing.jp, reading, pitchInfo.pitchInfo);
     }
     await finalThing.context_sentences.forEach(async sentence => await db.run("INSERT INTO Sentences (characters, en, jp) VALUES (?, ?, ?)", [finalThing.jp, sentence.en, sentence.ja]));
     // NOTE FOR ABOVE. THIS USES THE KEY "ja" FOR SENTENCES. THIS WILL NOT WORK ON THE PREVIOUSLY KNWON WORDS BUT THIS ISN'T FOR THAT SO IT SHOULD BE FINE.
   }
}

async function findIfSubject(subject) {
  let subjectType = subject.data.subject_type;

  if (ID_TO_WORD[subject.data.subject_id]) { // I know this word
    console.log("I already know this " + subjectType + "(" + ID_TO_WORD[subject.data.subject_id].jp +
    "). It doesn't need to be added to the database, but the new SRS level is " + subject.data.srs_stage);
    if (subject.data.srs_stage < 5) console.log("The SRS is below WaniKani's 'proficent' range, you might want to focus on this word!");
  } else { // new word moment;
    if (subject.data.srs_stage >= 5) { // the majority of work was done here.
      console.log("This " + subjectType + " is new! It's SRS is now: " + subject.data.srs_stage);
      console.log("Since the " + subjectType + " is higher than 5, it's at least Guru! And I can consider it learned!");
      let newWord = await fetch(WANIKANI + "subjects/" + subject.data.subject_id, {
        headers: {Authorization: "Bearer " + TSURUKAME}
      });
      newWord = await newWord.json();
      console.log("The new learned word is: " + newWord.data.characters);
      console.log("");

      let finalThing = createResponse(newWord); // NEW ADDITION 9/25/2022.
      if (subjectType === "radical") {
        renameKey("amalgamation_ids", "kanji_ids", finalThing);
        updateJSONFile("infoFiles/radicals.json", [finalThing]); // while testing don't want to add to the json file yet.
      } else if (subjectType === "kanji") {
        renameKey("amalgamation_ids", "vocabulary_ids", finalThing);
        renameKey("component_ids", "radical_ids", finalThing);
        updateJSONFile("infoFiles/kanji.json", [finalThing]);
      } else if (subjectType === "vocabulary") {
        renameKey("component_ids", amalgamation_ids, finalThing);
        updateJSONFile("infoFiles/vocabulary.json", [finalThing]);
      }
      return finalThing;
    } else {
      console.log("This " + subjectType + " does not have a WaniKani SRS level of 5 or higher, so it cannot be considered learned!")
    };
  }
  console.log("");
}

function renameKey(old, newname, obj) {
  obj[newname] = obj[old];
  delete obj[old];
}

function createResponse(subject) {
  let subjectObject = {
    jp: subject.data.characters,
    level: subject.data.level,
    id: subject.id,
    en: subject.meanings.map(meaning => meaning.meaning) // now turns the RADICALS.JSON radicals to have a list with their meanings.
  }
  if (subject.data.context_sentences) subjectObject.context_sentences = subject.data.context_sentences;
  if (subject.data.parts_of_speech) subjectObject.word_type = subject.data.parts_of_speech;
  if (subject.data.readings) subjectObject.known_readings = subject.readings.map(reading => reading.reading);
  if (subject.data.component_subject_ids) subjectObject.component_ids = subject.data.component_subject_ids;
  if (subject.data.amalgamation_subject_ids) subjectObject.amalgamation_ids = subject.data.amalgamation_subject_ids;
  return subjectObject;
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

async function getDBConnection() {
  const db = await sqlite.open({
    filename: "japanese-new.db",
    driver: sqlite3.Database
  });
  return db;
}

app.use(express.static('public'));
const PORT = process.env.PORT || 8080;
app.listen(PORT);
