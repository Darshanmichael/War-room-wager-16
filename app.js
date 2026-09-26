(function () {
  "use strict";

  const socket = io();

  let view = "home";
  let homeError = "";
  let joinName = "";
  let joinCode = "";
  let joining = false;
  let toastMsg = "";
  let toastTimer = null;

  let hostState = null;   // full state pushed to host
  let teamState = null;   // filtered state pushed to a team
  let myTeamId = localStorage.getItem("wrw_team_id") || null;

  // Tracks the "structural" shape of the last full render, so that a bare
  // timer tick (which arrives every second) doesn't tear down and rebuild
  // the DOM — that was destroying focus on the answer textarea and made
  // typing on mobile keyboards impossible.
  let lastStructuralKey = null;

  // ---------------- DOM helpers ----------------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((k) => {
      if (k === "class") node.className = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function showToast(msg) {
    toastMsg = msg;
    clearTimeout(toastTimer);
    renderFull();
    toastTimer = setTimeout(() => { toastMsg = ""; renderFull(); }, 2600);
  }

  function usedPoints(wagers) {
    return Object.values(wagers || {});
  }

  function statusLabel(status) {
    if (status === "active") return "LIVE";
    if (status === "paused") return "PAUSED";
    if (status === "review") return "REVIEW";
    if (status === "ended") return "ENDED";
    return "LOBBY";
  }

  // ---------------- Socket wiring ----------------
  socket.on("host:state", (state) => {
    hostState = state;
    if (view === "host") smartRender(hostStructuralKey(state));
  });
  socket.on("team:state", (state) => {
    teamState = state;
    if (view === "team") smartRender(teamStructuralKey(state));
  });

  function hostStructuralKey(state) {
    if (!state) return "none";
    const teamsKey = (state.teams || [])
      .map((t) => t.id + ":" + JSON.stringify(t.wagers) + ":" + JSON.stringify(t.answers) + ":" + JSON.stringify(t.results))
      .join("|");
    return [state.status, state.phase, state.currentIndex, teamsKey].join("::");
  }

  function teamStructuralKey(state) {
    if (!state || !state.me) return "none";
    const idx = String(state.currentIndex);
    const me = state.me;
    return [
      state.status,
      state.phase,
      state.currentIndex,
      me.wagers ? me.wagers[idx] : "-",
      me.answers ? (me.answers[idx] !== undefined ? "answered" : "-") : "-",
      me.score
    ].join("::");
  }

  function smartRender(newKey) {
    if (newKey !== lastStructuralKey) {
      lastStructuralKey = newKey;
      renderFull();
    } else {
      updateTimerInPlace();
    }
  }

  function updateTimerInPlace() {
    const state = view === "host" ? hostState : teamState;
    if (!state) return;
    const timer = state.timer;
    const fill = document.getElementById("timer-fill");
    const label = document.getElementById("timer-label");
    if (!fill || !label || !timer || !timer.total) return;
    const pct = Math.max(0, Math.min(100, (timer.remaining / timer.total) * 100));
    const urgent = timer.remaining <= Math.ceil(timer.total * 0.25);
    fill.style.width = pct + "%";
    fill.className = "timer-bar-fill" + (urgent ? " urgent" : "");
    const kindLabel = timer.kind === "wager" ? "TIME TO WAGER" : timer.kind === "answer" ? "TIME TO ANSWER" : "";
    label.textContent = kindLabel + " — " + timer.remaining + "s";
  }

  function rejoinIfNeeded() {
    if (myTeamId) {
      socket.emit("team:rejoin", { teamId: myTeamId }, (res) => {
        if (res && res.ok) { view = "team"; lastStructuralKey = null; renderFull(); }
        else { localStorage.removeItem("wrw_team_id"); myTeamId = null; renderFull(); }
      });
    }
  }
  socket.on("connect", rejoinIfNeeded);

  // ---------------- Actions ----------------
  function hostCreate() {
    socket.emit("host:create", {}, (res) => {
      if (res && res.ok) { view = "host"; lastStructuralKey = null; renderFull(); }
    });
  }

  function submitJoin() {
    homeError = "";
    const name = joinName.trim();
    const code = joinCode.trim();
    if (!name) { homeError = "Enter your team name."; renderFull(); return; }
    if (!code) { homeError = "Enter the joining code."; renderFull(); return; }
    joining = true; renderFull();
    socket.emit("team:join", { name, code }, (res) => {
      joining = false;
      if (res && res.ok) {
        myTeamId = res.teamId;
        localStorage.setItem("wrw_team_id", myTeamId);
        view = "team";
        lastStructuralKey = null;
        renderFull();
      } else {
        homeError = (res && res.error) || "Could not join.";
        renderFull();
      }
    });
  }

  function placeWager(n) {
    socket.emit("team:wager", { n });
  }

  function submitAnswer(text) {
    socket.emit("team:answer", { text });
  }

  function leaveHost() {
    hostState = null;
    lastStructuralKey = null;
    view = "home";
    renderFull();
  }

  // ---------------- Timer bar ----------------
  function timerBar(timer) {
    if (!timer || !timer.total) return null;
    const pct = Math.max(0, Math.min(100, (timer.remaining / timer.total) * 100));
    const urgent = timer.remaining <= Math.ceil(timer.total * 0.25);
    const kindLabel = timer.kind === "wager" ? "TIME TO WAGER" : timer.kind === "answer" ? "TIME TO ANSWER" : "";
    return el("div", { class: "timer-wrap" }, [
      el("div", { id: "timer-label", class: "timer-label" }, [kindLabel + " — " + timer.remaining + "s"]),
      el("div", { class: "timer-bar-bg" }, [
        el("div", { id: "timer-fill", class: "timer-bar-fill" + (urgent ? " urgent" : ""), style: "width:" + pct + "%" })
      ])
    ]);
  }

  // ---------------- Views ----------------
  function renderHome() {
    const wrap = el("div", { class: "home-wrap" });
    wrap.appendChild(el("div", { class: "panel" }, [
      el("p", { class: "panel-label" }, ["HOST"]),
      el("button", { class: "btn btn-solid", onclick: hostCreate }, ["Join as Host"])
    ]));
    wrap.appendChild(el("div", { class: "divider-word" }, ["OR"]));
    wrap.appendChild(el("div", { class: "panel" }, [
      el("p", { class: "panel-label" }, ["TEAM"]),
      el("div", { class: "field" }, [
        el("label", {}, ["Team name"]),
        el("input", { type: "text", value: joinName, placeholder: "e.g. Alpha Squad", oninput: (e) => { joinName = e.target.value; } })
      ]),
      el("div", { class: "field" }, [
        el("label", {}, ["Joining code"]),
        el("input", { type: "text", class: "code", value: joinCode, placeholder: "CODE", maxlength: "6", oninput: (e) => { joinCode = e.target.value; } })
      ]),
      homeError ? el("p", { class: "error-text" }, [homeError]) : null,
      el("button", { class: "btn", disabled: joining ? "true" : null, onclick: submitJoin }, [joining ? "Joining…" : "Join Game"])
    ]));
    return wrap;
  }

  function renderLeaderboard(teams) {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("p", { class: "panel-label" }, ["STANDINGS"]));
    const sorted = (teams || []).slice().sort((a, b) => b.score - a.score);
    if (sorted.length === 0) {
      panel.appendChild(el("p", { class: "empty-note" }, ["No teams yet."]));
      return panel;
    }
    const lb = el("div", { class: "leaderboard" });
    sorted.forEach((t, i) => {
      lb.appendChild(el("div", { class: "lb-row" }, [
        el("div", { class: "lb-rank" }, [String(i + 1)]),
        el("div", { class: "lb-name" }, [t.name]),
        el("div", { class: "lb-score" }, [t.score + " pts"])
      ]));
    });
    panel.appendChild(lb);
    return panel;
  }

  function renderHostReview() {
    const wrap = el("div", { class: "host-wrap" });
    wrap.appendChild(el("div", { class: "host-top" }, [
      el("div", { class: "code-badge" }, ["JOIN CODE", el("b", {}, [hostState.code || "------"])]),
      el("span", { class: "status-pill paused" }, ["REVIEW"])
    ]));
    wrap.appendChild(el("p", { class: "empty-note", style: "margin-bottom:14px;" }, [
      "All 10 questions are done. Review each team's wagers and typed answers below, mark Correct / Wrong, then reveal final standings."
    ]));
    wrap.appendChild(el("div", { class: "control-row" }, [
      el("button", { class: "btn btn-auto btn-solid", onclick: () => socket.emit("host:finishReview") }, ["Show Final Standings"])
    ]));

    const allQ = hostState.allQuestions || [];
    (hostState.teams || []).forEach((team) => {
      const panel = el("div", { class: "panel" });
      panel.appendChild(el("p", { class: "panel-label" }, [team.name + " — " + team.score + " pts"]));
      allQ.forEach((q, idx) => {
        const wager = team.wagers ? team.wagers[String(idx)] : undefined;
        const answer = team.answers ? team.answers[String(idx)] : undefined;
        const result = team.results ? team.results[String(idx)] : undefined;
        if (wager === undefined && answer === undefined) return;
        const row = el("div", { class: "review-row" });
        row.appendChild(el("div", { class: "review-q-label" }, ["Q" + (idx + 1) + " · " + q.topic + " — wagered " + (wager !== undefined ? wager : "—")]));
        row.appendChild(el("div", { class: "review-answer" }, [
          el("span", { class: "typed-answer-label" }, ["Their answer: "]),
          el("span", {}, [answer !== undefined ? answer : "(none)"])
        ]));
        row.appendChild(el("div", { class: "review-answer" }, [
          el("span", { class: "typed-answer-label" }, ["Benchmark: "]),
          el("span", {}, [q.answer])
        ]));
        if (result) {
          row.appendChild(el("span", { class: "judged-tag " + result }, [result === "correct" ? "✓ Marked Correct (+" + wager + ")" : "✗ Marked Wrong"]));
        } else {
          const jb = el("div", { class: "judge-btns" });
          jb.appendChild(el("button", { class: "btn btn-olive", onclick: () => socket.emit("host:judge", { teamId: team.id, verdict: "correct", questionIndex: idx }) }, ["Correct"]));
          jb.appendChild(el("button", { class: "btn btn-red", onclick: () => socket.emit("host:judge", { teamId: team.id, verdict: "wrong", questionIndex: idx }) }, ["Wrong"]));
          row.appendChild(jb);
        }
        panel.appendChild(row);
      });
      wrap.appendChild(panel);
    });

    wrap.appendChild(el("div", { style: "text-align:center;" }, [
      el("button", { class: "footer-link", onclick: leaveHost }, ["Exit host console"])
    ]));
    return wrap;
  }

  function renderHost() {
    const wrap = el("div", { class: "host-wrap" });
    if (!hostState) {
      wrap.appendChild(el("p", { class: "empty-note" }, ["Setting up your game…"]));
      return wrap;
    }
    const st = hostState.status;

    if (st === "review") return renderHostReview();

    wrap.appendChild(el("div", { class: "host-top" }, [
      el("div", { class: "code-badge" }, ["JOIN CODE", el("b", {}, [hostState.code || "------"])]),
      el("span", { class: "status-pill " + (st === "active" ? "live" : st === "paused" ? "paused" : st === "ended" ? "ended" : "") }, [statusLabel(st)])
    ]));

    const controls = el("div", { class: "control-row" });
    if (st === "lobby") {
      controls.appendChild(el("button", { class: "btn btn-solid", onclick: () => socket.emit("host:start") }, ["Start Quiz"]));
    } else if (st === "active" || st === "paused") {
      controls.appendChild(el("button", { class: "btn btn-olive", onclick: () => socket.emit(st === "paused" ? "host:resume" : "host:pause") }, [st === "paused" ? "Resume" : "Pause"]));
      controls.appendChild(el("button", { class: "btn btn-red", onclick: () => socket.emit("host:end") }, ["End Quiz"]));
    }
    wrap.appendChild(controls);

    if (st === "ended") {
      wrap.appendChild(renderLeaderboard(hostState.teams));
    } else if (st !== "lobby") {
      const q = hostState.question;
      const phase = hostState.phase;
      const qPanel = el("div", { class: "panel" });
      qPanel.appendChild(el("span", { class: "phase-tag" }, [
        phase === "wagering" ? "WAGERING" :
        phase === "awaiting_broadcast" ? "READY TO BROADCAST" : "QUESTION LIVE"
      ]));
      qPanel.appendChild(el("p", { class: "q-topic-label" }, [
        "QUESTION " + (hostState.currentIndex + 1) + " OF " + hostState.totalQuestions + (q ? " · " + q.format.toUpperCase() : "")
      ]));
      qPanel.appendChild(el("p", { class: "q-topic" }, [q ? q.topic : ""]));
      qPanel.appendChild(timerBar(hostState.timer));
      qPanel.appendChild(el("p", { class: "q-text" }, [q ? q.question : ""]));
      qPanel.appendChild(el("div", { class: "q-answer" }, ["Correct answer: " + (q ? q.answer : "")]));

      const qControls = el("div", { class: "control-row" });
      if (phase === "wagering") {
        qControls.appendChild(el("button", { class: "btn btn-auto btn-solid", onclick: () => socket.emit("host:broadcastQuestion") }, ["Broadcast Question Now"]));
      } else if (phase === "awaiting_broadcast") {
        qControls.appendChild(el("button", { class: "btn btn-auto btn-solid", onclick: () => socket.emit("host:broadcastQuestion") }, ["Broadcast Question to Teams"]));
      } else {
        const label = hostState.currentIndex + 1 >= hostState.totalQuestions ? "Finish Round" : "Next Question";
        qControls.appendChild(el("button", { class: "btn btn-auto btn-solid", onclick: () => socket.emit("host:next") }, [label]));
      }
      qPanel.appendChild(qControls);
      wrap.appendChild(qPanel);
    }

    const roster = el("div", { class: "panel" });
    roster.appendChild(el("p", { class: "panel-label" }, ["TEAMS (" + (hostState.teams || []).length + ")"]));
    if (!hostState.teams || hostState.teams.length === 0) {
      roster.appendChild(el("p", { class: "empty-note" }, ["No teams have joined yet. Share the code above."]));
    } else {
      hostState.teams.forEach((team) => {
        const row = el("div", { class: "team-row" });
        row.appendChild(el("div", { class: "team-name" }, [team.name]));
        row.appendChild(el("div", { class: "team-score" }, [team.score + " pts"]));

        if (st !== "lobby" && st !== "ended") {
          const idx = String(hostState.currentIndex);
          const wager = team.wagers ? team.wagers[idx] : undefined;
          const typedAnswer = team.answers ? team.answers[idx] : undefined;

          if (wager === undefined) {
            row.appendChild(el("span", { class: "wager-status" }, ["Waiting to wager…"]));
          } else if (typedAnswer === undefined) {
            row.appendChild(el("span", { class: "wager-status has-wager" }, ["Wagered " + wager + " — writing answer…"]));
          } else {
            row.appendChild(el("span", { class: "wager-status has-wager" }, ["Wagered " + wager + " — answer received ✓"]));
          }

          if (typedAnswer !== undefined) {
            row.appendChild(el("div", { class: "typed-answer" }, [
              el("span", { class: "typed-answer-label" }, ["Their answer: "]),
              el("span", {}, [typedAnswer])
            ]));
          }
        }

        const used = usedPoints(team.wagers);
        const strip = el("div", { class: "points-used-strip" });
        for (let n = 1; n <= 10; n++) {
          strip.appendChild(el("span", { class: "pu-chip" + (used.indexOf(n) !== -1 ? " used" : "") }, [String(n)]));
        }
        row.appendChild(strip);

        roster.appendChild(row);
      });
    }
    wrap.appendChild(roster);

    wrap.appendChild(el("div", { style: "text-align:center;" }, [
      el("button", { class: "footer-link", onclick: leaveHost }, ["Exit host console"])
    ]));

    return wrap;
  }

  function renderTeam() {
    const wrap = el("div", { class: "team-wrap" });
    if (!teamState) {
      wrap.appendChild(el("div", { class: "waiting-block" }, [el("div", { class: "pulse" }), el("p", {}, ["Connecting…"])]));
      return wrap;
    }
    const st = teamState.status;
    const me = teamState.me;

    wrap.appendChild(el("p", { class: "team-header" }, [me.name.toUpperCase()]));
    wrap.appendChild(el("p", { class: "team-scoreline" }, [me.score + " points"]));

    if (st === "paused") {
      wrap.appendChild(el("div", { class: "waiting-block" }, [el("div", { class: "pulse" }), el("p", {}, ["The host has paused the round. Hold tight."])]));
      return wrap;
    }
    if (st === "review") {
      wrap.appendChild(el("div", { class: "waiting-block" }, [el("div", { class: "pulse" }), el("p", {}, ["All questions are done. The host is reviewing every team's answers — final results coming soon."])]));
      return wrap;
    }
    if (st === "ended") {
      wrap.appendChild(el("p", {}, ["The quiz has ended. Final standings:"]));
      wrap.appendChild(renderLeaderboard([{ id: me.id, name: me.name, score: me.score }]));
      return wrap;
    }
    if (st === "lobby") {
      wrap.appendChild(el("div", { class: "waiting-block" }, [el("div", { class: "pulse" }), el("p", {}, ["Waiting for the host to start the quiz…"])]));
      return wrap;
    }

    const idx = teamState.currentIndex;
    const phase = teamState.phase;
    const myWager = me.wagers ? me.wagers[String(idx)] : undefined;
    const myAnswer = me.answers ? me.answers[String(idx)] : undefined;
    const used = usedPoints(me.wagers);

    wrap.appendChild(el("p", { class: "topic-banner" }, ["QUESTION " + (idx + 1) + " OF " + teamState.totalQuestions + " — TOPIC"]));
    wrap.appendChild(el("p", { class: "topic-name" }, [teamState.topic || ""]));
    wrap.appendChild(timerBar(teamState.timer));

    if (phase === "wagering") {
      if (myWager === undefined) {
        const grid = el("div", { class: "wager-grid" });
        [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]].forEach((rowNums) => {
          const row = el("div", { class: "wager-row" });
          rowNums.forEach((n) => {
            const isUsed = used.indexOf(n) !== -1;
            row.appendChild(el("button", { class: "wager-btn" + (isUsed ? " used" : ""), disabled: isUsed ? "true" : null, onclick: () => placeWager(n) }, [String(n)]));
          });
          grid.appendChild(row);
        });
        wrap.appendChild(el("p", { class: "wager-hint" }, ["Choose how many points to wager. Each number can only be used once. Auto-locks to your lowest available number if time runs out."]));
        wrap.appendChild(grid);
      } else {
        wrap.appendChild(el("div", { class: "locked-block" }, [
          el("div", { class: "locked-value" }, [String(myWager)]),
          el("div", { class: "locked-label" }, ["POINTS LOCKED IN — WAITING FOR THE QUESTION"])
        ]));
      }
    } else if (phase === "awaiting_broadcast") {
      wrap.appendChild(el("div", { class: "locked-block" }, [
        el("div", { class: "locked-value" }, [String(myWager !== undefined ? myWager : "—")]),
        el("div", { class: "locked-label" }, ["WAGER LOCKED — WAITING FOR THE HOST TO SHOW THE QUESTION"])
      ]));
    } else if (phase === "question") {
      wrap.appendChild(el("div", { class: "locked-block", style: "padding-top:0;" }, [
        el("div", { class: "locked-value" }, [String(myWager !== undefined ? myWager : "—")]),
        el("div", { class: "locked-label" }, ["POINTS ON THE LINE"])
      ]));
      wrap.appendChild(el("div", { class: "question-block" }, [el("p", { class: "q-text" }, [teamState.question || ""])]));
      if (myAnswer === undefined) {
        const box = el("textarea", { id: "answer-box", class: "answer-textarea", rows: "3", placeholder: "Type your team's answer…" });
        wrap.appendChild(el("div", { class: "answer-input-block" }, [
          box,
          el("button", { class: "btn btn-solid", style: "margin-top:10px;", onclick: () => submitAnswer(document.getElementById("answer-box").value) }, ["Submit Answer"])
        ]));
      } else {
        wrap.appendChild(el("div", { class: "answer-locked-note" }, [
          el("span", {}, ["Your answer: "]), el("b", {}, [myAnswer]),
          el("div", { class: "locked-label", style: "margin-top:8px;" }, ["LOCKED IN — WAITING FOR THE HOST"])
        ]));
      }
    }

    return wrap;
  }

  // ---------------- Root render ----------------
  function renderFull() {
    const app = document.getElementById("app");
    app.innerHTML = "";
    app.appendChild(el("div", { class: "brand-row" }, [el("div", { class: "brand-mark" })]));
    app.appendChild(el("h1", { class: "title" }, ["WAR ROOM ", el("span", { class: "wager" }, ["WAGER"])]));
    app.appendChild(el("p", { class: "subtitle" }, [
      view === "home" ? "COLLEGE QUIZ COMPETITION" : view === "host" ? "HOST CONSOLE" : "TEAM CONSOLE"
    ]));
    const screen = el("div", { class: "screen" });
    if (view === "home") screen.appendChild(renderHome());
    else if (view === "host") screen.appendChild(renderHost());
    else if (view === "team") screen.appendChild(renderTeam());
    app.appendChild(screen);
    if (toastMsg) app.appendChild(el("div", { class: "toast" }, [toastMsg]));
  }

  renderFull();
  if (myTeamId) { view = "team"; }
})();
