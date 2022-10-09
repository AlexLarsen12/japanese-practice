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
const { ALL } = require("dns");
const e = require("express");

const TSURUKAME = "5f281d83-1537-41c0-9573-64e5e1bee876";
const WANIKANI = "https://api.wanikani.com/v2/";

const WORD_TYPES = ["radical", "kanji", "vocabulary"];

// possible keys: (this format holds for all entrances/removals to the database.)
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
// known_vocabulary
// jp
const KEY_TO_QUERY = JSON.parse(fs_sync.readFileSync("infoFiles/queryData.json"));
// large note: For the above ^^, I am to assume that the order of the ?'s go like this:
// [jp (of the word being inserted), otherinfo, type (if needed)].
// with it set up like this, we are able to correctly write the above queries.

// used to handle internal things like updating the kanji_ids when adding a new word.
const TARGET_TYPES = {
  "radical_composition": {type: "radical", alternate: "kanji_ids"},
  "kanji_composition": {type: "kanji", alternate:"vocabulary_ids"},
  "known_vocabulary": {type:"vocabulary", alternate:"vocabulary_ids"},
  "known_kanji": {type:"kanji", alternate:"kanji_ids"}
}

// This is a super easy way to have a global object that stores a subject_id => object with good info.
// only question is how do we keep it up to date after the server is initialized.
const ID_TO_WORD = JSON.parse(fs_sync.readFileSync("infoFiles/idToSubject.json", "utf-8"));

// dictionary that goes word -> type -> id (whole object)
const WORD_TO_ID = JSON.parse(fs_sync.readFileSync("infoFiles/subjectToId.json", "utf8"));

// a brief summary of all the words.
const ALL_WORDS = JSON.parse(fs_sync.readFileSync("infoFiles/allWords.json", "utf8"));

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
// update 9/27/2022: only works with the allWords.json file.
// Only sends back the japanese, the english, and the readings.
app.get("/allWords", async function(req, res) {
  try {
    res.json(JSON.parse((await fs.readFile("infoFiles/allWords.json"))));
  } catch(err) {
    res.type("text").status(500).send(err.message);
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

// new endpoint (should maybe be post) that will try to see if you got the word right
// https://en.wikipedia.org/wiki/Levenshtein_distance
// unfinished.
app.get("/matchCloseness", async function(req, res) {
  let word = "calisthenics";
  let misspelling = "calisthenist"

  res.send("lol");
})

// the thing I use to test different endpoints. Most of the code does very specific things and I
// should save all of it in somewhere  for future use. Most of it is to test functionality of
// wanikani but you know how it is.
app.get("/funnyGoofyTest", async function(req, res) {
});

// updated 9/27/2022. should work functionally decent!
app.post("/addWord", async function (req, res) {
  res.type("text");
  try {
    let jp = req.body.jp;
    let type = req.body.type;

    if (!jp || !type) throw new Error("The japanese and the type are the only required parameters to add a new word.");
    if (!WORD_TYPES.includes(type)) throw new Error("This is an unrecognized word type");

    let db = await getDBConnection();
    let existingWord = await db.get("SELECT * FROM Kanji WHERE characters = ? AND type = ?", [jp, type]);
    if (existingWord) throw new Error(jp + " is an already known " + type + ". Are you trying to modify this word?");

    let subject = req.body;
    for (let key of Object.keys(subject)) if (isJson(subject[key])) subject[key] = JSON.parse(subject[key]);
    subject.id = createUniqueId(jp + type);

    // this part is f*cked...
    translateStrings(subject);
    await addToDatabase(type, subject, db);
    await writeToAllWords(subject, type);
    await writeToSubjectInformation(subject, subject.id, type);

    await db.close();
    res.send("New " + type + " added: " + jp);
  } catch (err) {
    res.status(500).send(err.message);
  }
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
    for (let key of Object.keys(req.body)) {
      req.body[key] = JSON.parse(req.body[key]);
      let subject = req.body;

      for (let content of subject[key]) {
        if (!WORD_TO_ID[jp][type][key]) WORD_TO_ID[jp][type][key] = [];
        if (!WORD_TO_ID[jp][type][key].includes(content)) {
          WORD_TO_ID[jp][type][key].push(content);
          ID_TO_WORD[WORD_TO_ID[jp][type].id][key] = WORD_TO_ID[jp][type][key];

          let newId = WORD_TO_ID[jp][type].id; // this needs to be updated somehow...
          // also this logic below assumes that the kanji/radical/vocabulary is known to me. whoopy.
          if (key === "radical_composition") {
            let targetId = WORD_TO_ID[content]["radical"];
            addLink(content, "radical", targetId, key, newId);
          }
          if (key === "known_kanji" || key === "kanji_composition") {
            let targetId = WORD_TO_ID[content]["kanji"];
            addLink(content, "kanji", targetId, key, newId);
          }
          if (key === "known_vocabulary") {
            let targetId = WORD_TO_ID[content]["vocabulary"];
            addLink(content, "vocabulary", targetId, key, newId);
          }
          await fs.writeFile("infoFiles/idToSubject.json", JSON.stringify(ID_TO_WORD, null, 2));
          await fs.writeFile("infoFiles/subjectToId.json", JSON.stringify(WORD_TO_ID, null, 2));

          // ugh need to update ALL_WORDS;
          if (key === "known_readings" || key === "en") {
            ALL_WORDS[getIndexOfSubject(jp, type)][key].push(content);
            await fs.writeFile("infoFiles/allWords.json", JSON.stringify(ALL_WORDS, null, 2));
          }

          // I have to create the proper thing content will be a string or an object.
          let additions = [jp];
          if (typeof(content) === "string") {
            additions.push(content);
          } else {
            // this is an object and loop through the keys.
            Object.keys(content).forEach(key => additions.push(content[key]));
          }
          if (KEY_TO_QUERY[key].needType) additions.push(type);
          await db.run(KEY_TO_QUERY[key].insertQuery, additions);
        }
      }
    }

    res.json(WORD_TO_ID[jp][type]);
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
    for (let key of Object.keys(KEY_TO_QUERY)) {
      let queryParams = KEY_TO_QUERY[key].needType ? [subjectTypeCombo.characters, subjectTypeCombo.type] : [subjectTypeCombo.characters];
      await db.run(KEY_TO_QUERY[key].deleteQuery, queryParams);
    }

    // note: does NOT remove references to the item in kanji_ids, vocabulary_ids, radical_ids. Can change later if necessary.
    ALL_WORDS.splice(getIndexOfSubject(subjectTypeCombo.characters, subjectTypeCombo.type), 1);
    await fs.writeFile("infoFiles/allWords.json", JSON.stringify(ALL_WORDS, null, 2));

    let id = WORD_TO_ID[subjectTypeCombo.characters][subjectTypeCombo.type].id;
    delete ID_TO_WORD[id];
    await fs.writeFile("infoFiles/idToSubject.json", JSON.stringify(ID_TO_WORD, null, 2));

    delete WORD_TO_ID[subjectTypeCombo.characters][subjectTypeCombo.type];
    if (Object.keys(WORD_TO_ID[subjectTypeCombo.characters]).length === 0) delete WORD_TO_ID[subjectTypeCombo.characters]; //remove the reference entirely.
    await fs.writeFile("infoFiles/subjectToId.json", JSON.stringify(WORD_TO_ID, null, 2));

    await db.close();
    res.type("text").send("Successfully deleted the " + subjectTypeCombo.type + ": " + subjectTypeCombo.characters + " from the website.");
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

  let addedWords = []; // we have all the assignments, so we can start adding.
  let db = await getDBConnection();
  for (let entry of assignments) {
    let wordToBeAdded = await findIfSubject(entry);
    if (wordToBeAdded) {
      await addToDatabase(entry.data.subject_type, wordToBeAdded, db);
      await writeToAllWords(wordToBeAdded, entry.data.subject_type);
      await writeToSubjectInformation(wordToBeAdded, wordToBeAdded.id, entry.data.subject_type);
      addedWords.push({jp: wordToBeAdded.jp, type:entry.data.subject_type});
    }
  }
  // we've updated everything so we can say the last time we updated!
  let now = (new Date()).toISOString();
  await fs.appendFile("infoFiles/lastUpdated.txt", "\n" + now);

  await db.close();
  res.json({assignments_checked: assignments.length, last_updated: now, length: addedWords.length, words: addedWords
  });
});

/** -- helper functions -- */

function translateStrings(subject) {
  for (let key of Object.keys(TARGET_TYPES)) {
    if (subject[key]) {  // we have one of the types...
      let newList = [];
      for (let str of subject[key]) {
        if (WORD_TO_ID[str]) {
          if (WORD_TO_ID[str][TARGET_TYPES[key].type]) { // if we know this thing.
            if (!WORD_TO_ID[str][TARGET_TYPES[key].type][TARGET_TYPES[key].alternate].includes(subject.id)) {
              WORD_TO_ID[str][TARGET_TYPES[key].type][TARGET_TYPES[key].alternate].push(subject.id);
              ID_TO_WORD[WORD_TO_ID[str][TARGET_TYPES[key].type].id][TARGET_TYPES[key].alternate].push(subject.id);
            }
            newList.push(WORD_TO_ID[str][TARGET_TYPES[key].type].id); // assumes that the thing is known...
          } else {
            // newList.push(createUniqueId(str + TARGET_TYPES[key].type));
            // we are doing this to account for the fact that it may not exist, but we want to know about it in the future.
          }
        }
      }
      subject[key] = newList;
    }
  }
}

function addLink(target, targetType, targetId, targetList, newId) {
  // we're adding to either kanji_ids, radical_ids, or vocabulary_ids.
  if (!WORD_TO_ID[target][targetType][targetList].includes(newId))
    WORD_TO_ID[target][targetType][targetList].push(newId);
  if (!ID_TO_WORD[targetId][targetList].includes(newId))
    ID_TO_WORD[targetId][targetList].push(newId);
}

function getIndexOfSubject(word, type) {
  for (let i = 0; i < ALL_WORDS.length; i++) {
    if (ALL_WORDS[i].jp === word && ALL_WORDS[i].type === type) return i;
  }
  return -1;
}

function isJson(str) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

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
// known_vocabulary
// jp (this isn't in addToDatabase)
// EVERYTHING NEEDS TO BE IN A LIST EXCEPT FOR JP.
async function addToDatabase(type, subject, db) {
  let fakeSubject = JSON.parse(JSON.stringify(subject)); // necessary because I want to make changes for the sake of adding to the DB but not in backend.
  if (!subject["pitch_data"] && type === "vocabulary" && subject["known_readings"]) addPitchDataToObject(fakeSubject);
  if (fakeSubject["en"]) fakeSubject["en"] = fakeSubject["en"].map(en => en.toLowerCase());
  fakeSubject["jp"] = [fakeSubject["jp"]];


  for (let key of Object.keys(KEY_TO_QUERY)) { // it's easier to go through the keys I allow it rather than what the body sends me.
    if (fakeSubject[key]) { // need to make sure the key exists.
      if (Object.keys(TARGET_TYPES).includes(key)) fakeSubject[key] = translateIds(fakeSubject[key]); // translate from IDs to the string
      for (let i = 0; i < fakeSubject[key].length; i++) {
        let additions = key === "jp" ? [] : [fakeSubject["jp"]];
        if (typeof(fakeSubject[key][i]) === "string") {
            additions.push(fakeSubject[key][i]);
        } else {
          Object.keys(fakeSubject[key][i]).forEach(secondKey => additions.push(fakeSubject[key][i][secondKey]));
        }
        if (KEY_TO_QUERY[key].needType) additions.push(type);
        await db.run(KEY_TO_QUERY[key].insertQuery, additions);
      }
    }
  }
  renameKey("known_kanji", "kanji_ids", subject);
  renameKey("radical_composition", "radical_ids", subject);
  renameKey("known_vocabulary", "vocabulary_ids", subject);
  renameKey("kanji_composition", "kanji_ids", subject);
  return subject;
}

function addPitchDataToObject(subject) {
  let newPitchData = [];
  for (let reading of subject["known_readings"]) {
    let pitchInfo = findPitchInfo(subject["jp"], reading);
    if (pitchInfo) newPitchData.push({"reading": pitchInfo.hiragana, "pitch": pitchInfo.pitchInfo});
  }
  if (newPitchData.length !== 0) subject["pitch_data"] = newPitchData;
} // this works in place so don't need to return.

// used to translate the list of kanji/radical/vocab ids to the strings themselves.
// returns a new list of the currently KNOWN of the above.
function translateIds(idList) {
  let newList = [];
  for (let id of idList) {
    if (ID_TO_WORD[id]) newList.push(ID_TO_WORD[id].jp);
  }
  return newList;
}

async function writeToAllWords(subject, type) {
  let knownReadings = subject["known_readings"] ? subject["known_readings"] : [];
  let en = subject.en ? subject.en : [];
  ALL_WORDS.push({jp: subject.jp, type: type, en: en.map(en => en.toLowerCase()), known_readings: knownReadings});
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
function createUniqueId(string) {
  let hash = hashCode(string);
  while (ID_TO_WORD[hash]) hash = hashCode(string += "xd");
  return hash;
}

function hashCode(string){
  var hash = 0;
  for (var i = 0; i < string.length; i++) {
      var code = string.charCodeAt(i);
      hash = ((hash<<5)-hash)+code;
      hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) * -1;
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
      return createResponse(newWord)
    } else {
      console.log("This " + subjectType + " does not have a WaniKani SRS level of 5 or higher, so it cannot be considered learned!")
    };
  };
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
    en: subject.data.meanings.map(meaning => meaning.meaning) // now turns the RADICALS.JSON radicals to have a list with their meanings.
  }
  if (subject.data.context_sentences) subjectObject.context_sentences = subject.data.context_sentences;
  if (subject.data.parts_of_speech) subjectObject.word_type = subject.data.parts_of_speech;
  if (subject.data.readings) subjectObject.known_readings = subject.data.readings.map(reading => reading.reading);
  if (subject.data.component_subject_ids) subjectObject.component_ids = subject.data.component_subject_ids;
  if (subject.data.amalgamation_subject_ids) subjectObject.amalgamation_ids = subject.data.amalgamation_subject_ids;

  if (subject["object"] === "radical") {
    renameKey("amalgamation_ids", "known_kanji", subjectObject);
  } else if (subject["object"] === "kanji") {
    renameKey("amalgamation_ids", "known_vocabulary", subjectObject);
    renameKey("component_ids", "radical_composition", subjectObject);
  } else if (subject["object"] === "vocabulary") {
    renameKey("component_ids", "kanji_composition", subjectObject);
  }
  return subjectObject;
}

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
