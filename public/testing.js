"use strict";
(function() {
  window.addEventListener("load", init);

  function init() {
    createPitchGraph(1, 0);
    createPitchGraph(1, 1);
    createPitchGraph(4, 0);
    createPitchGraph(4, 1);
    createPitchGraph(4, 2);
    createPitchGraph(4, 3);
    createPitchGraph(4, 4);
    createPitchGraph(5, 3);
  }

  function createPitchGraph(moraCount, pitchDownStep) {
    let mainBox = document.createElement("div");
    mainBox.classList.add("main-box");

    let passedDownstep = false;
    for (let i = 1; i <= moraCount; i++) {
      let column = document.createElement("div");
      column.classList.add("column");

      let mora1 = document.createElement("div");
      mora1.classList.add("mora");
      let mora2 = document.createElement("div");
      mora2.classList.add("mora");

      column.appendChild(mora1);
      column.appendChild(mora2);
      mainBox.appendChild(column);

      if (i === 1 && pitchDownStep !== 1) {
        mora1.classList.add("off");
        mora2.classList.add("on");
      } else if (i === 1) {
        mora1.classList.add("on");
        mora2.classList.add("off");
        passedDownstep = true;
      }

      if (i > 1 && !passedDownstep) {
        mora1.classList.add("on");
        mora2.classList.add("off");
        if (i === pitchDownStep) passedDownstep = true;
      } else if (i !== 1 && passedDownstep) {
        mora1.classList.add("off");
        mora2.classList.add("on");
      }
    }
    let particleColumn = document.createElement("div");
    particleColumn.classList.add("column");
    let mora1 = document.createElement("div");
    mora1.classList.add("mora");
    let mora2 = document.createElement("div")
    mora2.classList.add("mora");

    if (pitchDownStep === 0) {
      mora1.classList.add("end");
      mora2.classList.add("off");
    } else {
      mora1.classList.add("off");
      mora2.classList.add("end");
    }
    particleColumn.appendChild(mora1);
    particleColumn.appendChild(mora2);
    mainBox.appendChild(particleColumn);
    document.body.appendChild(mainBox);

    let moras = mainBox.querySelectorAll(".mora.on,.mora.end");
    let moraCenters = []
    for (let mora of moras) moraCenters.push([mora.getBoundingClientRect().left + (mora.getBoundingClientRect().width / 2), mora.getBoundingClientRect().top + (mora.getBoundingClientRect().height / 2)]);
    console.log(moraCenters);
    for (let i = 0; i < moraCenters.length -1; i++) {
      let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      let line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      svg.classList.add("mySVG");
      line.setAttribute("x1", moraCenters[i][0]);
      line.setAttribute("x2", moraCenters[i+1][0]);
      line.setAttribute("y1", moraCenters[i][1]);
      line.setAttribute("y2", moraCenters[i+1][1]);
      line.classList.add("line");
      svg.appendChild(line);
      mainBox.querySelectorAll(".column")[i].prepend(svg);
    }
  }
})();