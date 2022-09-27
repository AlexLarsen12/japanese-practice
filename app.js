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
const { runInNewContext } = require("vm");
const { deepStrictEqual } = require("assert");

const TSURUKAME = "5f281d83-1537-41c0-9573-64e5e1bee876";
const WANIKANI = "https://api.wanikani.com/v2/";

const WORD_TYPES = ["radical", "kanji", "vocabulary"];
const TABLES = ["English", "Kanji", "Notes", "PitchInfo", "Radicals", "Readings", "Sentences",
                "Source", "Vocabulary", "WordType"]; // might be useful??

const KEY_TO_QUERY = {
  en: {
    query: "INSERT INTO English (characters, en) VALUES (?, ?)"
  }
}

// BIG NOTE: YOU HAVE THE FOLLOWING DATA THAT NEEDS TO BE IN SYNC
//
// ID_TO_WORD
// WORD_TO_ID
// ALL_WORDS
// japanese-new.db
//
// anytime you make ANY modification to ANYTHING. (adding/removing/etc),
// these 4 need to be in sync in some way.

// This is a super easy way to have a global object that stores a subject_id => object with good info.
// only question is how do we keep it up to date after the server is initialized.
const ID_TO_WORD = JSON.parse(fs_sync.readFileSync("infoFiles/idToSubject.json"));

// dictionary that goes word -> type -> id (whole object)
const WORD_TO_ID = JSON.parse(fs_sync.readFileSync("infoFiles/subjectToId.json"));

// a brief summary of all the words.
const ALL_WORDS = JSON.parse(fs_sync.readFileSync("infoFiles/allWords.json"));

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

// Returns the word that is specified. Requires also query parameter of "type" to be passed in.
// "type" can be - "vocabulary", "kanji", or "radical".
// UPDATED TO WORK WITH JAPANESE NEW.db 8/24/2022
app.get('/word/:word', async function(req, res) {
  try {
    let type = req.query["type"];
    if (!type) throw new Error("Please input a type!!");
    if (!WORD_TYPES.includes(type)) throw new Error("Sorry this word type is unrecognized");

    let db = await getDBConnection();
    let word = req.params.word;
    let resp = await getWord(type, word, db);
    await db.close();
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
    let randomWord = await getWord(target.type, target.characters); // returns a lot of information, could be useless?
    await db.close();
    res.json(randomWord);
  } catch(err) {
    res.type("text").status(500).send(err.message);
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

// updated 9/26/2022. Adds a new word to the back-end.
// requires the post input to be in a specific way, and assumes everything
// (besides jp and type) are in a list.
app.post("/addWord", async function (req, res) {
  res.type("text");
  try {
    if (!req.body.jp || !req.body.type) throw new Error("You must have at least the japanese and the type to add a new word");
    if (!WORD_TYPES.includes(req.body.type)) throw new Error("This is an unrecognized word type");

    let db = await getDBConnection();
    let wordCheck = await db.get("SELECT * FROM Kanji WHERE characters = ? AND type = ?", [req.body.jp, req.body.type]);
    if (wordCheck) throw new Error(req.body.jp + " is an already known " + req.body.type);

    let jp = req.body.jp;
    let type = req.body.type;

    delete req.body.jp;
    delete req.body.type;
    for (let key of Object.keys(req.body)) req.body[key] = JSON.parse(req.body[key]); // make it iterable

    // need to add the word to the database.
    await addToDatabase(jp, type, req.body, db);

    req.body.jp = jp; // we want it back onto the body! because this should be added to both files.

    let potentialLists = [{subjects: req.body.kanji_ids, type:"kanji", key:"kanji_ids"},
    {subjects:req.body.vocaulary_ids, type:"vocabulary", key:"vocabulary_ids"},
    {subjects: req.body.radical_ids, type:"radical", key:"radical_ids"}];

    for (let list of potentialLists) {
      if (list.subjects) { // we have a list in the first place
        for (let i = 0; i < list.subjects.length; i++) {
          if (WORD_TO_ID[list.subjects[i]][list.type]) { // we have this one :)
            req.body[list.key][i] = WORD_TO_ID[list.subjects[i]][list.type].id;
          } else {
            // uh oh we don't have this one! gotta create it maybe.
          }
        }
      }
    }

    // the words are properly formatted now!
    await writeToAllWords(req.body, type);

    // need to create a new unused ID
    let newId = createUniqueId();
    req.body.id = newId;
    await writeToSubjectInformation(req.body, newId, type);

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
});

// will modify (basically add to) a known word in the database.
app.post('/modifyWord', async function(req, res) {
  try {
    let jp = req.body.jp;
    let type = req.body.type;

    if (!jp || !type) throw new Error("Please include the japanese and the type.");
    let db = await getDBConnection();
    if (!(await db.get("SELECT * FROM Kanji WHERE characters = ? AND type = ?", [jp, type])))
      throw new Error("This word isn't known yet. Consider adding this word!");

    delete req.body.jp;
    delete req.body.type;
    for (let key of Object.keys(req.body)) req.body[key] = JSON.parse(req.body[key]);

    if (subject.en)
    if (subject.sources) {
      console.log(WORD_TO_ID[jp][type].sources);
    }
    if (subject.notes)
    if (subject["known_kanji"])
    if (subject["known_readings"])
    if (subject["radical_composition"])
    if (subject["known_vocabulary"])
    if (subject["kanji_composition"])
    if (subject["word_type"])
    if (subject["context_sentences"])
    if (subject["pitch_data"])

    res.json(req.body);
  } catch (err) {
    res.status(500).type("text").send("You probably messed up your inputs: " + err.message);
  }
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

    // update ALL_WORDS, ID_TO_WORD, WORD_TO_ID
    ALL_WORDS.forEach((subject, index, obj) => {
      if (subject.jp === subjectTypeCombo.characters && subject.type === subjectTypeCombo.type) obj.splice(index, 1);
    });
    await fs.writeFile("infoFiles/allWords.json", JSON.stringify(ALL_WORDS, null, 2));

    let id = WORD_TO_ID[subjectTypeCombo.characters][subjectTypeCombo.type].id;
    delete ID_TO_WORD[id];
    await fs.writeFile("infoFiles/idToSubject.json", JSON.stringify(ID_TO_WORD, null, 2));

    delete WORD_TO_ID[subjectTypeCombo.characters][subjectTypeCombo.type];
    if (Object.keys(WORD_TO_ID[subjectTypeCombo.characters]).length === 0) delete WORD_TO_ID[subjectTypeCombo.characters]; //remove the reference entirely.
    await fs.writeFile("infoFiles/subjectToId.json", JSON.stringify(WORD_TO_ID, null, 2));

    res.type("text").send("Successfully deleted the " + subjectTypeCombo.type + ": " + subjectTypeCombo.characters + " from the database.");
  } catch(err) {
    res.status(500).type("text").send(err.message);
  }
});

// SUPER UNTESTED AS OF 9/26/2022. It should work, but we know how that goes. MAKE SURE TO GIT
// PUSH BEFORE EVER CALLING THIS.
// unlessing I'm learning 60+ new words (guru+) with each fetch... this should run fine.
app.get("/updateLastVisited",  async function(req, res) {
  let updatedDate = (await fs.readFile("infoFiles/lastUpdated.txt", "utf-8")).split("\n");
  let lastDate = updatedDate[updatedDate.length - 1];

  let url = WANIKANI + "assignments?updated_after=" + lastDate;
  let assignments = await recursiveFetchTime(url, []); // hopefully this takes only like... 3 fetches max.

  let addedWords = [];
  // we have all of our assignments!!

  let db = await getDBConnection();
  for (let entry of assignments) {
    let wordToBeAdded = await findIfSubject(entry);
    if (wordToBeAdded) {
      await addToDatabase(wordToBeAdded.jp, entry.data.subject_type, wordToBeAdded, db);
      await writeToAllWords(wordToBeAdded, wordToBeAdded.type);
      await writeToSubjectInformation(wordToBeAdded, wordToBeAdded.id, entry.data.subject_type);
      addedWords.push({jp: wordToBeAdded.jp, type:entry.data.subject_type});
    }
  }

  // we've updated everything so we can say the last time we updated!
  let now = (new Date()).toISOString();
  await fs.appendFile("infoFiles/lastUpdated.txt", "\n" + now);

  await db.close();
  res.json({
    assignments_checked: assignments.length,
    last_updated: now,
    length: addedWords.length,
    words: addedWords
  });
});

/** -- helper functions -- */

// assumes I have a perflectly_formatted thing.
// possible keys:
// en
// source
// notes
// known_kanji
// radical_composition
// word_type
// context_sentences
// pitch_data
// known_readings
// kanji_composition
//
// weirdly enough does NOT require jp to be in the subject.
async function addToDatabase(jp, type, subject, db) {
  await db.run("INSERT INTO Kanji (characters, type) VALUES (?, ?)", [jp, type]);
  if (subject.en) await subject.en.forEach(async en => await db.run("INSERT INTO English (english, characters, type) VALUES (?, ?, ?)", [en, jp, type]));
  if (subject.source) await subject.sources.forEach(async source => await db.run("INSERT INTO Source (characters, source, type) VALUES (?, ?, ?)", [jp, source, type]));
  if (subject.notes) await subject.notes.forEach(async note => await db.run("INSERT INTO Notes (characters, type, note) VALUES (?, ?, ?)", [jp, type, note]));
  if (subject["known_kanji"]) await subject["known_kanji"].forEach(async kanji => await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [kanji, jp]));
  if (subject["known_readings"]) await subject["known_readings"].forEach(async reading => await db.run("INSERT INTO Readings (reading, characters, type) VALUES (?, ?, ?)", [reading, jp, type]));
  if (subject["radical_composition"]) await subject["radical_composition"].forEach(async radical => await db.run("INSERT INTO Radicals (characters, radical) VALUES (?, ?)", [jp, radical]));
  if (subject["known_vocabulary"]) await subject["known_vocabulary"].forEach(async vocab => await db.run("INSERT INTO Vocabulary (characters, vocab) VALUES (?, ?)", [jp, vocab]));
  if (subject["kanji_composition"]) await subject["kanji_composition"].forEach(async kanji => await db.run("INSERT INTO Vocabulary (characters, vocab) VALUES (?, ?)", [kanji, jp]));
  if (subject["word_type"]) await subject["word_type"].forEach(async wordType => await db.run("INSERT INTO WordType (characters, type) VALUES (?, ?)", [jp, wordType]));
  if (subject["context_sentences"]) await subject["context_sentences"].forEach(async sen => await db.run("INSERT INTO Sentences (characters, en, jp) VALUES (?, ?, ?)", [jp. sen.en, sen.ja]));

  // THIS HAS A SPECIFIC WAY YOU NEED TO ENTER THE PITCHINFO. IF IT DOESN'T EXIST. I WILL LOOKIT UP MYSELF.
  if (subject["pitch_data"]) {
    await subject["pitch_data"].forEach(async info => await db.run("INSERT INTO PitchInfo (characters, reading, pitch) VALUES (?, ?, ?)", [jp, info.reading, info.pitch]));
  } else if (type === "vocabulary" && subject["known_readings"]) {
    for (let reading of subject["known_readings"]) {
      let pitchInfo = findPitchInfo(jp, reading);
      if (pitchInfo) await db.run("INSERT INTO PitchInfo (characters, reading, pitch) VALUES (?, ?, ?)", [jp, reading, pitchInfo.pitchInfo]);
    }
  }
  renameKey("known_kanji", "kanji_ids", subject);
  renameKey("radical_composition", "radical_ids", subject);
  renameKey("known_vocabulary", "vocabulary_ids", subject);
  renameKey("kanji_composition", "kanji_ids", subject);
  return subject // this is probably unnecessary since I think it will edit in-place, but i'll keep for now.
}

async function writeToAllWords(subject, type) {
  let knownReadings = subject["known_readings"] ? subject["known_readings"] : [];
  let en = subject.en ? subject.en : [];
  ALL_WORDS.push({jp: subject.jp, type: type, en: en, known_readings: knownReadings});
  await fs.writeFile("infoFiles/allWords.json", JSON.stringify(ALL_WORDS, null, 2));
}

async function writeToSubjectInformation(subject, id, type) {
  ID_TO_WORD[id] = subject;
  await fs.writeFile("infoFiles/idToSubject.json", JSON.stringify(ID_TO_WORD, null, 2));

  WORD_TO_ID[subject.jp] ? WORD_TO_ID[subject.jp][type] = subject : WORD_TO_ID[subject.jp] = {[type]:subject};
  await fs.writeFile("infoFiles/subjectToId.json", JSON.stringify(WORD_TO_ID, null, 2));
}

// hopefully this doesn't have to run too often
// My unique id's will be negative since the ids for WaniKani are all positive.
function createUniqueId() {
  let num = Math.floor(Math.random() * 10000 * -1);
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
    return wordObj;
  }
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
        renameKey("amalgamation_ids", "known_kanji", finalThing);
      } else if (subjectType === "kanji") {
        renameKey("amalgamation_ids", "known_vocabulary", finalThing);
        renameKey("component_ids", "radical_composition", finalThing);
      } else if (subjectType === "vocabulary") {
        renameKey("component_ids", "kanji_composition", finalThing);
      }
      return finalThing;
    } else {
      console.log("This " + subjectType + " does not have a WaniKani SRS level of 5 or higher, so it cannot be considered learned!")
    };
  }
  console.log("");
}

function renameKey(old, newname, obj) {
  if (obj[old]) {
    obj[newname] = obj[old];
      delete obj[old];
  }
}

function createResponse(subject) {
  let subjectObject = {
    jp: subject.data.characters,
    source: ["WaniKani level " + subject.data.level], // recently updated.
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
