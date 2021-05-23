DROP TABLE IF EXISTS Radicals;
CREATE TABLE Radicals(
  id INTEGER NOT NULL PRIMARY KEY,
  jp VARCHAR(100),
  en VARCHAR(100),
  type VARCHAR(100),
  last_studied DATE DEFAULT CURRENT_TIMESTAMP,
  correct INTEGER DEFAULT 0,
  wrong INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0
);

DROP TABLE IF EXISTS Kanji;
CREATE TABLE Kanji(
  id INTEGER NOT NULL PRIMARY KEY,
  jp VARCHAR(100),
  en VARCHAR(100),
  known_readings VARCHAR(100),
  type VARCHAR(100),
  radical_composition VARCHAR(100),
  known_vocabulary VARCHAR(100),
  last_studied DATE DEFAULT CURRENT_TIMESTAMP,
  correct INTEGER DEFAULT 0,
  wrong INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0
);

DROP TABLE IF EXISTS Vocabulary;
CREATE TABLE Vocabulary(
  id INTEGER NOT NULL PRIMARY KEY,
  jp VARCHAR(100),
  en VARCHAR(100),
  known_readings VARCHAR(100),
  type VARCHAR(100),
  kanji_composition VARCHAR(100),
  sentences TEXT,
  last_studied DATE DEFAULT CURRENT_TIMESTAMP,
  correct INTEGER DEFAULT 0,
  wrong INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0
);

INSERT INTO Radicals(jp, en, type) VALUES("大", "big", "radical");
INSERT INTO Kanji(jp, en, known_readings, type, radical_composition, known_vocabulary) VALUES("大", '["big", "large"]', '["たい", "だい"]', "kanji", '["大"]', '["大人"]');
INSERT INTO Vocabulary(jp, en, known_readings, type, kanji_composition, sentences) VALUES("大人", '["adult","mature"]', '["おとな"]', "vocabulary", '["大","人"]',
  '[{"jp":"これは、大人のりょうきんです","en":"This is the adult price.","vocab":["大人"]}, {"jp":"大人は三人だけです", "en":"There are only three adults.","vocab":["大人","三","人"]}, {"jp":"大人たちはいざかやにいった", "en":"The adults went to an izakaya.","vocab":["大人"]}]');