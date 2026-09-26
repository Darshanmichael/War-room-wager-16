const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Question bank (10 MBA-level, long-format clue questions)
// ---------------------------------------------------------------------------
const QUESTIONS = [
  {
    topic: "Derivatives & Risk",
    format: "Reverse Definition",
    question:
      "I am a second-order Greek, which means I don't measure price sensitivity directly — I measure how another sensitivity measure itself changes. Specifically, I track how much an option's delta shifts for every one-rupee or one-dollar move in the price of the underlying asset. I am at my highest when an option is at-the-money and close to expiry, which is exactly when traders find their hedges hardest to maintain. What am I?",
    answer: "Gamma"
  },
  {
    topic: "Financial Crises & Policy",
    format: "Timeline / Sequence",
    question:
      "In March of a certain year, a storied 85-year-old investment bank avoids collapse only through a Federal Reserve–brokered fire sale to a larger rival. Six months later, a nearly as old investment bank is denied a similar rescue and files for the largest bankruptcy in US history. That same month, an insurance conglomerate receives an emergency credit line worth $85 billion. Weeks later, Congress authorizes a $700 billion program to purchase distressed mortgage-backed assets. Name this October program.",
    answer: "TARP (Troubled Asset Relief Program)"
  },
  {
    topic: "Valuation",
    format: "Odd One Out",
    question:
      "A student lists four valuation tools: one compares share price to EPS, one compares enterprise value to EBITDA, one compares market value to book value, and one projects future dividends and discounts them to the present with no reference to comparable firms at all. Three belong to the same valuation family; one stands apart because it derives value independently. Identify the odd one out, and name the approach the other three share.",
    answer: "Dividend Discount Model is the odd one out — the other three (P/E, EV/EBITDA, P/B) are relative valuation multiples"
  },
  {
    topic: "Monetary Policy",
    format: "Read-Aloud Clue",
    question:
      "This is the interest rate at which a country's central bank lends short-term funds to commercial banks, against government securities as collateral, with an agreement to repurchase later. It's usually the first lever pulled to control inflation, and cutting it signals a push to stimulate a slowing economy. Which rate is being described?",
    answer: "Repo Rate"
  },
  {
    topic: "Corporate Finance — WACC",
    format: "Number / Stat Riddle",
    question:
      "A firm is capitalized with 60% equity and 40% debt. Cost of equity is 12%. Pre-tax cost of debt is 10%. Corporate tax rate is 30%. Using only these figures, what single number, central to every capital budgeting decision, do they combine to produce?",
    answer: "WACC = 10% → (0.6×12%) + (0.4×10%×(1−0.3)) = 7.2% + 2.8% = 10%"
  },
  {
    topic: "Asset Pricing Models",
    format: "Analogy / Comparison",
    question:
      "In CAPM, an asset's expected return is explained by its sensitivity to the overall market — systematic risk. Two researchers later found smaller and cheaper (low P/B) companies outperforming what CAPM predicted, and built a model to correct it. So exactly as CAPM is to Systematic Risk, their model is to ___?",
    answer: "Size and Value factors (SMB and HML) — the Fama-French Three-Factor Model"
  },
  {
    topic: "Corporate Finance",
    format: "Rebus / Wordplay",
    question:
      "A finance student represents one formula — blending cost of equity and cost of debt, weighted by how much of each a firm uses — with three symbols: a weighing scale (proportion), a stack of currency notes (cost), and a bank building (capital). ⚖️ + 💵 + 🏦 = ? What four-letter acronym is she illustrating?",
    answer: "WACC (Weighted Average Cost of Capital)"
  },
  {
    topic: "Behavioral Economics",
    format: "Mystery Quote",
    question:
      "Trained as a psychologist, he won the 2002 Nobel Memorial Prize in Economic Sciences for work with a collaborator (ineligible to share it posthumously) showing people rely on mental shortcuts that cause predictable errors in judgment. His 2011 book contrasts a fast, intuitive mode of thinking with a slow, deliberate one. Who is he?",
    answer: "Daniel Kahneman"
  },
  {
    topic: "Mergers & Acquisitions",
    format: "Progressive Reveal",
    question:
      "Clue 1: A defensive tactic letting existing shareholders (except the hostile acquirer) buy additional shares at a steep discount once the acquirer's stake crosses a set threshold, diluting them heavily. Clue 2: Colloquially named after a lethal substance, formally a 'shareholder rights plan', first used in the early 1980s.",
    answer: "Poison Pill"
  },
  {
    topic: "Technical Analysis",
    format: "Silhouette / Blur Reveal",
    question:
      "Picture a candlestick chart: a sharp near-vertical price move up, followed by a small tightly-converging symmetrical triangle of consolidation, followed by another sharp breakout continuing the same direction. Name this classic continuation pattern.",
    answer: "Pennant (Flag) Pattern"
  }
];

const WAGER_SECONDS = 20;
const ANSWER_SECONDS = 60;

// ---------------------------------------------------------------------------
// In-memory game state (single game/event at a time)
// ---------------------------------------------------------------------------
function freshGame() {
  return {
    code: null,
    status: "idle",       // idle | lobby | active | paused | ended
    phase: "wagering",    // wagering | awaiting_broadcast | question | results
    currentIndex: -1,
    timer: {
      running: false,
      remaining: 0,
      total: 0,
      kind: null,         // "wager" | "answer"
      handle: null
    },
    teams: {}             // teamId -> { id, name, socketId, score, wagers:{}, answers:{}, results:{} }
  };
}

let game = freshGame();

function randomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}

function usedPoints(team) {
  return Object.values(team.wagers || {});
}

function computeScore(team) {
  let score = 0;
  Object.keys(team.results || {}).forEach((idx) => {
    if (team.results[idx] === "correct" && typeof team.wagers[idx] === "number") {
      score += team.wagers[idx];
    }
  });
  return score;
}

function publicTeamList() {
  return Object.values(game.teams)
    .map((t) => ({
      id: t.id,
      name: t.name,
      score: computeScore(t),
      wagers: t.wagers,
      answers: t.answers,
      results: t.results
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function currentQuestion() {
  return QUESTIONS[game.currentIndex] || null;
}

function broadcastHost() {
  io.to("host").emit("host:state", {
    code: game.code,
    status: game.status,
    phase: game.phase,
    currentIndex: game.currentIndex,
    totalQuestions: QUESTIONS.length,
    question: currentQuestion(),
    allQuestions: QUESTIONS,
    timer: { running: game.timer.running, remaining: game.timer.remaining, total: game.timer.total, kind: game.timer.kind },
    teams: publicTeamList()
  });
}

function broadcastTeams() {
  Object.values(game.teams).forEach((t) => {
    if (!t.socketId) return;
    const q = currentQuestion();
    const showQuestionText = q && game.phase === "question";
    io.to(t.socketId).emit("team:state", {
      status: game.status,
      phase: game.phase,
      currentIndex: game.currentIndex,
      totalQuestions: QUESTIONS.length,
      topic: q ? q.topic : null,
      question: showQuestionText ? q.question : null,
      timer: { running: game.timer.running, remaining: game.timer.remaining, total: game.timer.total, kind: game.timer.kind },
      me: {
        id: t.id,
        name: t.name,
        score: computeScore(t),
        wagers: t.wagers,
        answers: t.answers,
        results: t.results
      }
    });
  });
}

function broadcastAll() {
  broadcastHost();
  broadcastTeams();
}

// ---------------------------------------------------------------------------
// Timer engine (pausable)
// ---------------------------------------------------------------------------
function clearTimer() {
  if (game.timer.handle) clearInterval(game.timer.handle);
  game.timer.handle = null;
  game.timer.running = false;
}

function startTimer(seconds, kind, onExpire) {
  clearTimer();
  game.timer.remaining = seconds;
  game.timer.total = seconds;
  game.timer.kind = kind;
  game.timer.running = true;
  game.timer.handle = setInterval(() => {
    if (game.status === "paused") return; // frozen while paused
    game.timer.remaining -= 1;
    if (game.timer.remaining <= 0) {
      clearTimer();
      onExpire();
    }
    broadcastAll();
  }, 1000);
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------
function beginWagerWindow() {
  game.phase = "wagering";
  startTimer(WAGER_SECONDS, "wager", () => {
    // Auto-lock lowest available wager for any team that hasn't wagered
    const idx = String(game.currentIndex);
    Object.values(game.teams).forEach((t) => {
      if (t.wagers[idx] !== undefined) return;
      const used = usedPoints(t);
      for (let n = 1; n <= 10; n++) {
        if (used.indexOf(n) === -1) {
          t.wagers[idx] = n;
          break;
        }
      }
    });
    game.phase = "awaiting_broadcast";
    broadcastAll();
  });
  broadcastAll();
}

function broadcastQuestionToTeams() {
  if (game.phase !== "awaiting_broadcast" && game.phase !== "wagering") return;
  game.phase = "question";
  startTimer(ANSWER_SECONDS, "answer", () => {
    const idx = String(game.currentIndex);
    Object.values(game.teams).forEach((t) => {
      if (t.answers[idx] === undefined) t.answers[idx] = "[No Answer Submitted]";
    });
    broadcastAll();
  });
  broadcastAll();
}

function revealResults() {
  // No longer used during live play — judging happens in the end-of-round review screen.
}

function nextQuestion() {
  // If teams are mid-answer, lock in blanks for anyone who hasn't submitted yet before moving on.
  if (game.phase === "question") {
    const idx = String(game.currentIndex);
    Object.values(game.teams).forEach((t) => {
      if (t.answers[idx] === undefined) t.answers[idx] = "[No Answer Submitted]";
    });
  }
  const next = game.currentIndex + 1;
  if (next >= QUESTIONS.length) {
    game.status = "review";
    game.phase = "wagering";
    clearTimer();
    broadcastAll();
    return;
  }
  game.currentIndex = next;
  beginWagerWindow();
}

function finishReview() {
  game.status = "ended";
  clearTimer();
  broadcastAll();
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  socket.on("host:create", (_payload, cb) => {
    game = freshGame();
    game.code = randomCode();
    game.status = "lobby";
    socket.join("host");
    if (cb) cb({ ok: true, code: game.code });
    broadcastAll();
  });

  socket.on("host:start", () => {
    if (game.status !== "lobby") return;
    game.status = "active";
    game.currentIndex = 0;
    beginWagerWindow();
  });

  socket.on("host:broadcastQuestion", () => {
    broadcastQuestionToTeams();
  });

  socket.on("host:revealResults", () => {
    revealResults();
  });

  socket.on("host:finishReview", () => {
    finishReview();
  });

  socket.on("host:judge", ({ teamId, verdict, questionIndex }) => {
    const t = game.teams[teamId];
    if (!t) return;
    const idx = String(questionIndex !== undefined ? questionIndex : game.currentIndex);
    if (verdict !== "correct" && verdict !== "wrong") return;
    t.results[idx] = verdict;
    broadcastAll();
  });

  socket.on("host:next", () => {
    nextQuestion();
  });

  socket.on("host:pause", () => {
    if (game.status === "active") game.status = "paused";
    broadcastAll();
  });

  socket.on("host:resume", () => {
    if (game.status === "paused") game.status = "active";
    broadcastAll();
  });

  socket.on("host:end", () => {
    game.status = "ended";
    clearTimer();
    broadcastAll();
  });

  socket.on("team:join", ({ name, code }, cb) => {
    name = (name || "").trim();
    code = (code || "").trim();
    if (!game.code || code !== game.code) {
      if (cb) cb({ ok: false, error: "No game found with that code." });
      return;
    }
    if (!name) {
      if (cb) cb({ ok: false, error: "Enter a team name." });
      return;
    }
    const id = "t_" + Math.random().toString(36).slice(2, 10);
    game.teams[id] = {
      id,
      name,
      socketId: socket.id,
      score: 0,
      wagers: {},
      answers: {},
      results: {}
    };
    socket.join("teams");
    socket.data.teamId = id;
    if (cb) cb({ ok: true, teamId: id });
    broadcastAll();
  });

  socket.on("team:rejoin", ({ teamId }, cb) => {
    const t = game.teams[teamId];
    if (!t) {
      if (cb) cb({ ok: false });
      return;
    }
    t.socketId = socket.id;
    socket.join("teams");
    socket.data.teamId = teamId;
    if (cb) cb({ ok: true });
    broadcastAll();
  });

  socket.on("team:wager", ({ n }) => {
    const teamId = socket.data.teamId;
    const t = game.teams[teamId];
    if (!t || game.phase !== "wagering" || game.status !== "active") return;
    const idx = String(game.currentIndex);
    if (t.wagers[idx] !== undefined) return;
    if (usedPoints(t).indexOf(n) !== -1) return;
    if (n < 1 || n > 10) return;
    t.wagers[idx] = n;
    broadcastAll();
  });

  socket.on("team:answer", ({ text }) => {
    const teamId = socket.data.teamId;
    const t = game.teams[teamId];
    if (!t || game.phase !== "question") return;
    const idx = String(game.currentIndex);
    if (t.answers[idx] !== undefined) return;
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    t.answers[idx] = trimmed;
    broadcastAll();
  });

  socket.on("disconnect", () => {
    // Teams can reconnect via team:rejoin; we keep their data.
  });
});

server.listen(PORT, () => {
  console.log("War Room Wager listening on port " + PORT);
});
