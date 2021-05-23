"use strict";

(function() {

  window.addEventListener("load", init);


  function init() {
    refreshDictionary();
    id("add-word").addEventListener("change", changeWordType);
    id("home").addEventListener("click", goHome);
    id("word-addition").addEventListener("click", goToWordModification);

    populateForm("radical");
  }

  function goToWordModification() {
    id("word-addition-parent").classList.remove("hidden");
    id("word-info").classList.add("hidden");
    id("dictionary").classList.add("hidden");
  }

  function changeWordType() {
    populateForm(this.value);
  }

  function goHome() {
    id("word-addition-parent").classList.add("hidden");
    id("word-info").classList.add("hidden");
    id("word-info").innerHTML = "";
    id("dictionary").classList.remove("hidden");
    id("")
  }

  function populateForm(type) {
    let form = id("word-input");
    form.innerHTML = "";

    let en = createInputElement("English", "en");
    let jp = createInputElement("Japanese", "jp");

    let submit = document.createElement("input");
    submit.type = "submit";
    submit.value = "add word!"
    submit.addEventListener("click", createEntry);

    form.appendChild(en);
    form.appendChild(jp);

    if (type === "kanji") {
      createKanjiForm(form);
    } else if (type === "vocabulary") {
      createVocabularyForm(form);
    }
    form.appendChild(submit);
  }

  function createVocabularyForm(form) {
    let knownReadings = createInputElement("Known Readings", "known-readings");
    let kanjiComposition = createInputElement("Kanji Composition", "kanji-composition");

    let spacer = document.createElement("p");
    spacer.textContent = " ---- SENTENCE INFORMATION BELOW ----"

    let sentencesEnglish = createInputElement("Sentences - English", "sentence-en");
    let sentencesJapanese = createInputElement("Sentences - Japanese", "sentence-jp");
    let vocabInSentences = createInputElement("Sentences - Vocab Involved", "sentence-vocab");

    form.appendChild(knownReadings);
    form.appendChild(kanjiComposition);
    form.appendChild(spacer);
    form.appendChild(sentencesEnglish);
    form.appendChild(sentencesJapanese);
    form.appendChild(vocabInSentences);
  }

  function createKanjiForm(form) {
    let knownReadings = createInputElement("Known Readings", "known-readings");
    let radicalComposition = createInputElement("Radical Composition", "radical-composition");
    let knownVocab = createInputElement("Known Vocabulary", "known-vocab");

    form.appendChild(knownReadings);
    form.appendChild(radicalComposition);
    form.appendChild(knownVocab);
  }

  function createInputElement(text, name) {
    let inputDiv = document.createElement("div");

    let inputDescriptor = document.createElement("p");
    inputDescriptor.textContent = text;

    let inputElement = document.createElement("input");
    inputElement.type = "text";
    inputElement.name = name;

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
    e.preventDefault();
    let params = new FormData(id("word-input"));
    params.append("type", id("add-word").value);
    fetch('/postWord', {method : "POST", body : params})
    .then(statusCheck)
    .then(function () {
      id("dictionary").innerHTML = "";
      refreshDictionary();
    })
    .catch(console.error);
  }

  function processWords(words) {
    id("known-words").textContent = words.length;
    for (let i = 0; i < words.length; i++) {
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
        for (let j = 1; j < words[i].en.length; j++) {
          english.textContent += ", " + words[i].en[j];
        }
      }
      container.appendChild(english);

      // FINALLY IF THERE ARE ANY READINGS (not radicals) PUT THEM HERE
      if (words[i].known_readings) {
        let pronounciation = document.createElement("p");

        pronounciation.textContent = words[i].known_readings[0];
        for (let j = 1; j < words[i].known_readings.length; j++) {
          pronounciation.textContent += ", " + words[i].known_readings[j];
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

  function populateWordInfo(word) {
    let parent = id("word-info");
    parent.classList.add(word.type);

    let jp = document.createElement("p");
    jp.textContent = word.jp;
    parent.appendChild(jp);

    let en = document.createElement("p");
    if (word.type === "radical") {
      en.textContent = word.en;
    } else {
      en.textContent = word.en[0];
      for (let i = 1; i < word.en.length; i++) {
        en.textContent += ", " + word.en[i];
      }
    }
    parent.appendChild(en);

    if (word.type === "vocabulary") {
      let readings = document.createElement("p");
      readings.textContent = word.known_readings[0];
      for (let i = 1; i < word.known_readings.length; i++) {
        readings.textContent += ", " + word.known_readings[i];
      }
      parent.appendChild(readings);

      let sentences = document.createElement("p");
      sentences.textContent = word.sentences[0].jp;
      for (let i = 1; i < word.sentences.length; i++) {
        sentences.textContent += ", " + word.sentences[i].jp
      }
      parent.appendChild(sentences);

      let kanji = document.createElement("p");
      kanji.textContent = word.kanji_composition[0];
      for (let i = 1; i < word.kanji_composition.length; i++) {
        kanji.textContent += ", " + word.kanji_composition[i];
      }
      parent.appendChild(kanji);
    } else if (word.type === "kanji") {
      let readings = document.createElement("p");
      readings.textContent = word.known_readings[0];
      for (let i = 1; i < word.known_readings.length; i++) {
        readings.textContent += ", " + word.known_readings[i];
      }
      parent.appendChild(readings);

      let vocab = document.createElement("p");
      vocab.textContent = word.known_vocabulary[0];
      for (let i = 1; i < word.known_vocabulary.length; i++) {
        vocab.textContent += ", " + word.known_vocabulary[i];
      }
      parent.appendChild(vocab);

      let radicals = document.createElement("p");
      radicals.textContent = word.radical_composition[0];
      for (let i = 1; i < word.radical_composition.length; i++) {
        radicals.textContent += ", " + word.radical_composition[i];
      }
      parent.appendChild(radicals);
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