"use strict";

(function() {

  window.addEventListener("load", init);

  function init() {
    refreshDictionary();
    id("add-word").addEventListener("change", changeWordType);
    id("search").addEventListener("input", searchWords);
    id("home").addEventListener("click", function() {
      id("word-info").innerHTML = "";
      openPage("dictionary");
    });
    id("word-addition").addEventListener("click", () => openPage("word-addition-parent"));
    id("study-btn").addEventListener("click", function() {
      studyRandomWord();
      openPage("study");
    });

    populateForm("radical");
  }

  function studyRandomWord() {
    fetch('/randomWord')
      .then(statusCheck)
      .then(res => res.json())
      .then(showRandomWord)
      .catch(console.error);
  }

  function showRandomWord(resp) {
    id("study").innerHTML = "";
    let parent = document.createElement("div");
    parent.className = "display-box";
    parent.classList.add(resp.type);

    let word = document.createElement("p");

    let studyType = Math.random();
    if (studyType >= 0.5) {
      word.textContent = resp.jp;
    } else {
      word.textContent = resp.en.toString();
    }
    parent.appendChild(word);

    let input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Guess here!";
    input.id = "submit-study";
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        checkAnswer(resp);
      }
    })

    parent.appendChild(input);
    id("study").appendChild(parent);
    id("submit-study").focus(); // can't focus earlier cause it's not on the DOM yet!
  }

  function checkAnswer(resp) {
    let listToMatch;

    if (resp.type === "radical") {
      listToMatch = [resp.en];
    } else {
      listToMatch = resp.en;
    }

    listToMatch.push(resp.jp);

    let dopamine = document.createElement("p");
    let matchMsg = "You didn't get it! Here are the meanings: " + listToMatch.toString();
    dopamine.style.color = "Red";
    for (let i = 0; i < listToMatch.length; i++) {
      if (id("submit-study").value.toString().toLowerCase().match(listToMatch[i].toLowerCase())) {
        matchMsg = "matched with: " + id("submit-study").value.toString().match(listToMatch[i]);
        dopamine.style.color = "Green";
      }
    }

    dopamine.textContent = matchMsg;
    id("study").appendChild(dopamine);
    setTimeout(function() {
      studyRandomWord();
    }, 2000);
  }

  function openPage(id) {
    let divs = document.querySelector("main").children;
    for (let i = 0; i < divs.length; i++) {
      divs[i].classList.add("hidden");
      if (divs[i].id === id) {
        divs[i].classList.remove("hidden");
      }
    }
  }

  function searchWords() {
    let words = id("dictionary").children;
    for (let i = 0; i < words.length; i++) {
      words[i].classList.add("hidden");
      let word = this.value.toLowerCase();
      for (let j = 0; j < words[i].children.length; j++) {
        if (words[i].children[j].textContent.match(word)) {
          words[i].classList.remove("hidden");
        }
      }
    }
  }

  function changeWordType() {
    populateForm(this.value);
  }

  function populateForm(type) {
    let form = id("word-input");
    form.innerHTML = "";

    let en = createInputElement("English", "en", "mouth");
    let jp = createInputElement("Japanese", "jp", "口");
    let notes = createInputElement("Additional Notes", "notes", "it kinda looks like a mouth!");
    jp.id = "jp";
    jp.addEventListener("input", function() {
      if (id("jp").children[1].value.trim().length === 0) {
        id("submit").disabled = true;
      } else {
        id("submit").disabled = false;
      }
    }); // quick fix. now cannot submit words without japanese. Should fix the error on backend too tbh.

    let submit = document.createElement("input");
    submit.type = "submit";
    submit.value = "Add/Modify word!"
    submit.addEventListener("click", createEntry);
    submit.disabled = true;
    submit.id = "submit";

    form.appendChild(en);
    form.appendChild(jp);
    form.appendChild(notes);

    let source = createInputElement("Source", "source", "WaniKani level 1");
    form.appendChild(source);
    if (type === "radical") {
      let knownKanji = createInputElement("Found in Kanji", "known-kanji", "口\\,四\\,右");
      form.appendChild(knownKanji);
    } else if (type === "kanji") {
      createKanjiForm(form);
    } else if (type === "vocabulary") {
      createVocabularyForm(form);
    }
    form.appendChild(submit);
  }

  function createVocabularyForm(form) {
    let knownReadings = createInputElement("Known Readings", "known-readings", "こう");
    let kanjiComposition = createInputElement("Kanji Composition", "kanji-composition", "口");
    let wordType = createInputElement("Word Type", "word-type", "noun");

    let spacer = document.createElement("p");
    spacer.textContent = " ---- SENTENCE INFORMATION BELOW ----"

    let sentencesEnglish = createInputElement("Sentences - English", "sentence-en", "There is some sauce on your mouth.");
    let sentencesJapanese = createInputElement("Sentences - Japanese", "sentence-jp", "口にソースがついていますよ");
    let sentencesJapaneseSimple = createInputElement("Sentences - Japanese - No Kanji", "jp-simple", "くちにソースがついていますよ");
    let vocabInSentences = createInputElement("Sentences - Vocab Involved", "sentence-vocab", "口");

    form.appendChild(knownReadings);
    form.appendChild(kanjiComposition);
    form.appendChild(wordType);
    form.appendChild(spacer);
    form.appendChild(sentencesEnglish);
    form.appendChild(sentencesJapanese);
    form.appendChild(sentencesJapaneseSimple);
    form.appendChild(vocabInSentences);
  }

  function createKanjiForm(form) {
    let knownReadings = createInputElement("Known Readings", "known-readings", "こう");
    let radicalComposition = createInputElement("Radical Composition", "radical-composition", "口");
    let knownVocab = createInputElement("Known Vocabulary", "known-vocabulary", "口\\,人口");

    form.appendChild(knownReadings);
    form.appendChild(radicalComposition);
    form.appendChild(knownVocab);

  }

  function createInputElement(text, name, placeholder) {
    let inputDiv = document.createElement("div");

    let inputDescriptor = document.createElement("p");
    inputDescriptor.textContent = text;

    let inputElement = document.createElement("input");
    inputElement.type = "text";
    inputElement.name = name;
    inputElement.placeholder = placeholder;


    inputDiv.appendChild(inputDescriptor);
    inputDiv.appendChild(inputElement);

    return inputDiv;
  }

  function refreshDictionary() {
    fetch('/allWords')
    .then(statusCheck)
    .then(resp => resp.json())
    .then(processWords)
    .catch(console.error);
  }

  function createEntry(e) {
    e.currentTarget.disabled = true;
    let url = "/postWord";

    e.preventDefault();
    let params = new FormData(id("word-input"));
    id("word-input").reset();
    params.append("type", id("add-word").value);

    if (id("action-select").value === "modify") {
      url = '/modifyWord';
    }
    fetch(url, {method : "POST", body : params})
    .then(statusCheck)
    .then(refreshDictionary)
    .catch(console.error);
  }

  function processWords(words) {
    words = words.reverse();
    id("known-words").textContent = words.length;
    id("dictionary").innerHTML = "";
    id("radical-count").textContent = "0";
    id("kanji-count").textContent = "0";
    id("vocabulary-count").textContent = "0";
    for (let i = 0; i < words.length; i++) {
      id(words[i].type + "-count").textContent = parseInt(id(words[i].type + "-count").textContent) + 1;

      let container = document.createElement("div");
      container.classList.add("box");
      container.classList.add(words[i].type);
      container.addEventListener("click", moreInfo);

      let english = document.createElement("p");
      let japanese = document.createElement("p");

      // ADD THE JAPANESE TO THE TOP
      japanese.textContent = words[i].jp;
      container.appendChild(japanese);

      // WE NEED TO ADD THE ENGLISH NOW!
      if (words[i].type === "radical") {
        english.textContent = words[i].en;
      } else {
        english.textContent = words[i].en[0];
        for (let j = 1; j < 1; j++) { // I only want to show top 1 results. If want to switch back -> words[i].en.length
          if (words[i].en[j]) {
            english.textContent += ", " + words[i].en[j];
          }
        }
      }
      container.appendChild(english);

      // FINALLY IF THERE ARE ANY READINGS (not radicals) PUT THEM HERE
      if (words[i].known_readings) {
        let pronounciation = document.createElement("p");

        pronounciation.textContent = words[i].known_readings[0];
        for (let j = 1; j < 1; j++) { // Only want to show top 1st reading. Want to switch back -> words[i].known_readings.length
          if (words[i].known_readings[j]) {
            pronounciation.textContent += ", " + words[i].known_readings[j];
          }
        }

        container.appendChild(pronounciation);
      }

      id("dictionary").appendChild(container);
    }
  }

  function moreInfo() {
    id("word-info").classList.remove("hidden");
    id("dictionary").classList.add("hidden");

    let word = this.children[0].textContent;
    let wordType = this.classList[1];
    fetch('/word/' + word + "?type=" + wordType)
    .then(statusCheck)
    .then(resp => resp.json())
    .then(populateWordInfo)
    .catch(console.error);
  }

  function removeWord() {
    let params = new FormData();
    params.append('type', this.classList[this.classList.length-1]); // this is also sus
    params.append('word', this.children[0].textContent.split(":")[1].trim());
    id("word-info").innerHTML = "";
    fetch('/removeWord', {method: "POST", body: params})
      .then(statusCheck)
      .then(resp => resp.text())
      .then(refreshDictionary)
      .then(() => openPage("dictionary"))
      .catch(console.error);
  }

  function populateWordInfo(word) {
    let parent = id("word-info");
    parent.className = "display-box"; // don't do this lol
    parent.classList.add(word.type);
    parent.addEventListener("dblclick", removeWord);

    let jp = document.createElement("p");
    jp.textContent = "Japanese: " + word.jp;
    parent.appendChild(jp);

    if (word.en) { // checks for radical...
      let en = document.createElement("p");
      en.textContent = "English: ";
      if (word.type === "radical") {
        en.textContent += word.en;
      } else {
        if (word.en.length !== 0) { // check to see if no english meanings... super sketchy fix this later
          en.textContent += word.en[0];
          for (let i = 1; i < word.en.length; i++) {
            en.textContent += ", " + word.en[i];
          }
        }
      }
      parent.appendChild(en);
    }

    if (word.type === "vocabulary") {
      if (word.known_readings.length !== 0) {
        let readings = document.createElement("p");
        readings.textContent = "Known Readings: " + word.known_readings[0];
        for (let i = 1; i < word.known_readings.length; i++) {
          readings.textContent += ", " + word.known_readings[i];
        }
        parent.appendChild(readings);
      }

      if (word.sentences.length !== 0) {
        let sentences = document.createElement("p");
        sentences.textContent = "Example Sentences: " + word.sentences[0].jp;
        for (let i = 1; i < word.sentences.length; i++) {
          sentences.textContent += ", " + word.sentences[i].jp
        }
        parent.appendChild(sentences);
      }

      if (word.kanji_composition.length !== 0) {
        let kanji = document.createElement("p");
        kanji.textContent = "Kanji Composition: " + word.kanji_composition[0];
        for (let i = 1; i < word.kanji_composition.length; i++) {
          kanji.textContent += ", " + word.kanji_composition[i];
        }
        parent.appendChild(kanji);
      }
    } else if (word.type === "kanji") {

      if (word.known_readings.length !== 0) {
        let readings = document.createElement("p");
        readings.textContent = "Known Readings: " + word.known_readings[0];
        for (let i = 1; i < word.known_readings.length; i++) {
          readings.textContent += ", " + word.known_readings[i];
        }
        parent.appendChild(readings);
      }

      if (word.known_vocabulary !== 0) {
        let vocab = document.createElement("p");
        vocab.textContent = "Found in Vocab: " + word.known_vocabulary[0];
        for (let i = 1; i < word.known_vocabulary.length; i++) {
          vocab.textContent += ", " + word.known_vocabulary[i];
        }
        parent.appendChild(vocab);
      }

      if (word.radical_composition !== 0) {
        let radical = document.createElement("p");
        radical.textContent = "Radical Composition: " + word.radical_composition[0];
        for (let i = 1; i < word.radical_composition.length; i++) {
          radical.textContent += ", " + word.radical_composition[i];
        }
        parent.appendChild(radical);
      }
    }
  }

  async function statusCheck(response) {
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  }

  function id(id) {
    return document.getElementById(id);
  }

})();