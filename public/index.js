"use strict";

(function() {
  const FONT_STYLES = ["noto-serif-jp", "kosugi-maru", "rampart-one", "zen-maru-gothic",
                       "reggae-one", "rocknroll-one", "yuki-boku"];

  window.addEventListener("load", init);

  function init() {
    document.querySelector("body").classList.add(FONT_STYLES[Math.floor(Math.random() * FONT_STYLES.length)]);
    refreshDictionary();
    id("add-word").addEventListener("change", changeWordType);
    id("search").addEventListener("input", searchWords);
    id("home").addEventListener("click", function() {
      id("word-info").innerHTML = "";
      openPage("dictionary");
      id("search").value = "";
      searchWords();
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

    if (resp.type === "radical") {
      word.textContent = resp.jp;
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

    listToMatch = resp.en;

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
      let word = id("search").value.toLowerCase();
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
      if (words[i].known_readings.length !== 0) {
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
    parent.innerHTML = "";
    parent.className = "display-box"; // don't do this lol
    parent.classList.add(word.type);

    let jp = document.createElement("p");
    jp.textContent = "Japanese: " + word.jp;
    parent.appendChild(jp);

    let en = createTextBox(word.en, "English: ");
    if (en) parent.appendChild(en);

    if (word.type === "radical") {
      let knownKanji = createTextBox(word.known_kanji, "Known Kanji: ");
      if (knownKanji) {
        parent.appendChild(knownKanji);
        createSpans(knownKanji, "kanji-clickable");
      }

    } else if (word.type === "kanji") {
      let knownReadings = createTextBox(word.known_readings, "Known Readings: ");
      if (knownReadings) parent.appendChild(knownReadings);

      let knownVocab = createTextBox(word.known_vocabulary, "Known Vocabulary: ");
      if (knownVocab) {
        parent.appendChild(knownVocab);
        createSpans(knownVocab, "vocabulary-clickable");
      }

      let radicalComposition = createTextBox(word.radical_composition, "Radical Composition: ");
      if (radicalComposition) {
        parent.appendChild(radicalComposition);
        createSpans(radicalComposition, "radical-clickable");
      }

    } else if (word.type === "vocabulary") {
      let knownReadings = createTextBox(word.known_readings, "Known Readings: ");
      if (knownReadings) parent.appendChild(knownReadings);

      let kanjiComposition = createTextBox(word.kanji_composition, "Kanji Composition: ");
      if (kanjiComposition) {
        parent.appendChild(kanjiComposition);
        createSpans(kanjiComposition, "kanji-clickable");
      }

      if (word.sentences.length > 0) {
        let sentenceDiv = document.createElement("div");
        let paragraph = document.createElement("p");
        paragraph.textContent = "Sentences:"
        sentenceDiv.appendChild(paragraph);

        for (let i = 0; i < word.sentences.length; i++) {
          let sentenceParent = document.createElement("div");

          let sentenceJp = document.createElement("p");
          sentenceJp.textContent = "Japanese: ";

          // go through and also make each kanji clickable? this section SCUFFED
          const regex = /[ぁ-ゔゞァ-・ヽヾ゛゜ー。！？、「」]/
          for (let character of word.sentences[i].jp) {
            if (!character.match(regex)) { // probably a kanji?
              let textNode = createSpan(character, "kanji-clickable");
              sentenceJp.insertAdjacentElement("beforeend",  textNode);
            } else {
              sentenceJp.appendChild(document.createTextNode(character));
            }
          }
          sentenceParent.appendChild(sentenceJp);

          let sentenceEng = document.createElement("p");
          sentenceEng.textContent = "English: " + word.sentences[i].en;
          sentenceParent.appendChild(sentenceEng);

          // I accidentally updated all entries and they don't have the information below.. I might
          // be able to add it back but definitely won't be doing so now.

          // let vocab = document.createElement("p");
          // vocab.textContent = "Vocab involved: " + word.sentences[i].vocab.toString();
          // sentenceParent.appendChild(vocab);
          // createSpans(vocab, "vocabulary-clickable");

          // let sentenceJpEz = document.createElement("p");
          // sentenceJpEz.textContent = "Japanese - No Kanji: " + word.sentences[i]["jp_simple"];
          // sentenceParent.appendChild(sentenceJpEz);

          sentenceDiv.appendChild(sentenceParent);
          sentenceDiv.appendChild(document.createElement("br"));
        }
        parent.appendChild(sentenceDiv);
      }

      let wordType = createTextBox(word.word_type, "Word Type: ");
      if (wordType) parent.appendChild(wordType);
    }

    console.log(word);
    let notes = createTextBox(word.notes, "Notes: ");
    if (notes) parent.appendChild(notes);

    let source = createTextBox(word.source, "Source: ");
    if (source) parent.appendChild(source);

    let modifyBtn = document.createElement("button");
    modifyBtn.textContent = "Click here to modify!";
    modifyBtn.addEventListener("click", function() {
      id("action-select").value = "modify";
      id("add-word").value = word.type;
      id("word-addition-parent").classList.remove("hidden");
      populateForm(word.type);
      id("jp").children[1].value = word.jp;
      id("submit").disabled = false;
    }); // this is ridiculously scuffed.
    parent.appendChild(modifyBtn);

    // let deleteBtn = document.createElement("button");
    // deleteBtn.textContent = "DELETE THIS WORD!";
    // deleteBtn.addEventListener("dblclick", removeWord);
    // parent.appendChild(deleteBtn);
    // do not let anyone delete anything for now because why??
  }

  // takes a phrase/word/etc to be turned into a CLICKABLE span.
  // you can just += this to whatever element's innerHTML you need to add it to.
  function createSpan(p, type) {
    let span = document.createElement("span");
    span.classList.add(type);
    span.textContent = p;
    span.addEventListener("click", fetchMoreInfoFromSpan);
    return span;
  }

  function createSpans(p, type) {
    let prependPart = p.textContent.split(":")[0];

    let list = p.textContent.split(":")[1].split(",");
    p.textContent = ": ";
    for (let i = 0; i < list.length; i++) {
      list[i] = list[i].trim();

      p.innerHTML += "<span class='" + type + "'>" + list[i] + "</span>, "; // this is sketchy as well!
    }
    p.innerHTML = prependPart + p.innerHTML.substring(0, p.innerHTML.length - 2); // to avoid fenceposting

    // come back
    for (let i = 0; i < p.querySelectorAll("span").length; i++) {
      p.querySelectorAll("span")[i].addEventListener("click", fetchMoreInfoFromSpan);
    }
  }

  function fetchMoreInfoFromSpan() {
    let word = this.textContent;
    let wordType = this.classList[0].split("-")[0];

    fetch('/word/' + word + "?type=" + wordType)
      .then(statusCheck)
      .then(resp => resp.json())
      .then(populateWordInfo)
      .catch(wordNotFound);
  }

  function wordNotFound(err) {
    id("word-info").innerHTML = "";
    let p = document.createElement("p");
    p.textContent = err;

    id("word-info").appendChild(p);
  }

  function createTextBox(content, text) {
    if (content.length > 0) {
      if (typeof(content) === "string") content = [content]; // making the radical be a list!
      let p = document.createElement("p");
      p.textContent = text + content[0];
      for (let i = 1; i < content.length; i++) {
        p.textContent += ", " + content[i];
      }
      return p;
    } else {
      return null;
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