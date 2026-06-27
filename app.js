const STORAGE_KEYS = {
  session: "maogai.quiz.session",
  wrongbook: "maogai.quiz.wrongbook",
  overrides: "maogai.quiz.overrides",
};

const TYPE_LABELS = {
  single: "单选",
  multiple: "多选",
  judgment: "判断",
};

const state = {
  dataset: null,
  questionsById: new Map(),
  currentSession: null,
  wrongbook: loadJson(STORAGE_KEYS.wrongbook, {}),
  overrides: loadJson(STORAGE_KEYS.overrides, {}),
  wrongbookTypeFilter: "all",
};

const elements = {
  datasetSummary: document.querySelector("#datasetSummary"),
  statsGrid: document.querySelector("#statsGrid"),
  questionCard: document.querySelector("#questionCard"),
  wrongbookList: document.querySelector("#wrongbookList"),
  typeFilters: document.querySelector("#typeFilters"),
  wrongbookTypeFilters: document.querySelector("#wrongbookTypeFilters"),
  unitFilters: document.querySelector("#unitFilters"),
  scopeMode: document.querySelector("#scopeMode"),
  orderMode: document.querySelector("#orderMode"),
  startBtn: document.querySelector("#startBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  resetBtn: document.querySelector("#resetBtn"),
};

init();

async function init() {
  state.dataset = window.__QUESTION_DATA__;
  if (!state.dataset) {
    const response = await fetch("./data/questions.json");
    state.dataset = await response.json();
  }
  state.dataset.questions.forEach((question) => {
    state.questionsById.set(question.id, hydrateQuestion(question));
  });

  renderFilters();
  wireEvents();
  restoreSession();
  renderStats();
  renderWrongbook();
  renderQuestion();
  renderDatasetSummary();
}

function hydrateQuestion(question) {
  const override = state.overrides[question.id];
  return {
    ...question,
    answer: override ?? question.answer,
    answerSource: override ? "override" : question.answerSource,
  };
}

function renderDatasetSummary() {
  const { questionCount, countsByType, questionsWithoutAnswers } = state.dataset.meta;
  elements.datasetSummary.innerHTML = [
    `共 ${questionCount} 题`,
    `单选 ${countsByType.single} · 多选 ${countsByType.multiple} · 判断 ${countsByType.judgment}`,
    `待补录答案 ${questionsWithoutAnswers} 题`,
  ].join("<br />");
}

function renderFilters() {
  renderTypeChips(elements.typeFilters, getSelectedTypesFromSession() ?? ["single", "multiple", "judgment"], togglePracticeType);
  renderTypeChips(elements.wrongbookTypeFilters, [state.wrongbookTypeFilter], setWrongbookTypeFilter, true);

  elements.unitFilters.innerHTML = "";
  state.dataset.units.forEach((unit) => {
    const wrapper = document.createElement("label");
    wrapper.className = "unit-pill";
    const checked = isUnitSelected(unit.index);
    wrapper.innerHTML = `
      <input type="checkbox" data-unit-index="${unit.index}" ${checked ? "checked" : ""} />
      <span>${unit.name}</span>
    `;
    elements.unitFilters.appendChild(wrapper);
  });
}

function renderTypeChips(container, selected, handler, includeAll = false) {
  const chips = includeAll ? [{ key: "all", label: "全部" }, ...Object.entries(TYPE_LABELS).map(([key, label]) => ({ key, label }))] : Object.entries(TYPE_LABELS).map(([key, label]) => ({ key, label }));
  container.innerHTML = "";
  chips.forEach(({ key, label }) => {
    const button = document.createElement("button");
    button.className = `chip ${selected.includes(key) ? "active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => handler(key));
    container.appendChild(button);
  });
}

function wireEvents() {
  elements.startBtn.addEventListener("click", () => {
    const questions = getFilteredQuestions();
    if (!questions.length) {
      alert("当前筛选条件下没有题目可练习。");
      return;
    }

    state.currentSession = createSession(questions);
    persistSession();
    renderStats();
    renderQuestion();
  });

  elements.resumeBtn.addEventListener("click", () => {
    if (!restoreSession()) {
      alert("还没有可恢复的进度。");
    }
  });

  elements.resetBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.session);
    state.currentSession = null;
    renderStats();
    renderQuestion();
  });

  elements.scopeMode.addEventListener("change", () => {
    if (elements.scopeMode.value !== "wrongOnly") {
      renderFilters();
    }
  });

  elements.unitFilters.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const unitIndex = Number(target.dataset.unitIndex);
    const next = new Set(getSelectedUnitIndices());
    if (target.checked) {
      next.add(unitIndex);
    } else {
      next.delete(unitIndex);
    }
    setPendingUnitSelection([...next]);
  });
}

function createSession(questions) {
  const randomizedIds = elements.orderMode.value === "random" ? shuffle([...questions]) : [...questions].sort((a, b) => a.unitIndex - b.unitIndex || a.numberInUnit - b.numberInUnit);

  return {
    config: {
      scopeMode: elements.scopeMode.value,
      orderMode: elements.orderMode.value,
      selectedTypes: getSelectedTypesFromSession() ?? ["single", "multiple", "judgment"],
      selectedUnits: getSelectedUnitIndices(),
    },
    queue: randomizedIds.map((question) => ({
      id: question.id,
      optionOrder: shuffle(question.options.map((option) => option.label)),
    })),
    currentIndex: 0,
    results: {},
    createdAt: new Date().toISOString(),
  };
}

function renderQuestion() {
  const question = getCurrentQuestion();
  if (!question) {
    elements.questionCard.innerHTML = `<div class="question-empty">点击“开始练习”后，这里会显示题目。</div>`;
    return;
  }

  const queueItem = state.currentSession.queue[state.currentSession.currentIndex];
  normalizeQueueItemOptions(queueItem, question);
  const result = state.currentSession.results[question.id];
  const shuffledOptions = queueItem.optionOrder
    .map((label) => question.options.find((option) => option.label === label))
    .filter(Boolean);

  const selection = result?.selected ?? [];
  const canSubmit =
    question.type === "judgment" ? selection.length === 1 : selection.length > 0;

  elements.questionCard.innerHTML = `
    <div class="question-meta">
      <span class="meta-badge">${question.unit}</span>
      <span class="meta-badge">${TYPE_LABELS[question.type]}</span>
      <span class="meta-badge">第 ${state.currentSession.currentIndex + 1} / ${state.currentSession.queue.length} 题</span>
      <span class="meta-badge">${question.answer ? "可自动判分" : "需手动判定或补录答案"}</span>
    </div>
    <h2 class="question-stem">${escapeHtml(question.stem)}</h2>
    ${question.hint ? `<div class="feedback-box"><p><strong>题干内提示：</strong>${escapeHtml(question.hint)}</p></div>` : ""}
    <div class="option-list">
      ${renderOptionButtons(question, shuffledOptions, selection, result)}
    </div>
    <div class="question-actions">
      <button class="secondary" id="submitAnswerBtn" ${result?.status || !canSubmit ? "disabled" : ""}>提交答案</button>
      <button class="ghost" id="showAnswerEditorBtn">补录这题答案</button>
      <button class="secondary" id="prevQuestionBtn" ${state.currentSession.currentIndex === 0 ? "disabled" : ""}>上一题</button>
      <button class="secondary" id="nextQuestionBtn" ${state.currentSession.currentIndex >= state.currentSession.queue.length - 1 ? "disabled" : ""}>下一题</button>
    </div>
    ${renderFeedback(question, result)}
    ${renderAnswerEditor(question)}
  `;

  bindQuestionEvents(question, shuffledOptions);
}

function renderOptionButtons(question, options, selection, result) {
  if (question.type === "judgment") {
    const choices = [
      { label: "true", text: "正确" },
      { label: "false", text: "错误" },
    ];
    return choices
      .map((option) => {
        const isActive = selection.includes(option.label);
        const statusClass = getChoiceStatus(question, result, option.label);
        return `
          <button class="option-btn ${isActive ? "active" : ""} ${statusClass}" data-choice="${option.label}">
            <span class="option-label">${option.text[0]}</span>
            <span>${option.text}</span>
          </button>
        `;
      })
      .join("");
  }

  return options
    .map((option) => {
      const isActive = selection.includes(option.label);
      const statusClass = getChoiceStatus(question, result, option.label);
      return `
        <button class="option-btn ${isActive ? "active" : ""} ${statusClass}" data-choice="${option.label}">
          <span class="option-label">${option.label}</span>
          <span>${escapeHtml(option.text)}</span>
        </button>
      `;
    })
    .join("");
}

function getChoiceStatus(question, result, label) {
  if (!result || !question.answer) {
    return "";
  }

  const correctLabels = Array.isArray(question.answer) ? question.answer : [question.answer];
  if (correctLabels.includes(label)) {
    return "correct";
  }
  if ((result.selected ?? []).includes(label)) {
    return "wrong";
  }
  return "";
}

function renderFeedback(question, result) {
  if (!result?.status) {
    return "";
  }

  if (result.status === "pending-manual") {
    return `
      <div class="feedback-box">
        <p class="feedback-title">这题暂无标准答案</p>
        <p>你已提交作答：${formatSelectedAnswer(result.selected, question)}。请手动确认是否答对，系统会据此记录错题本。</p>
        <div class="feedback-actions">
          <button class="primary" id="markCorrectBtn">我答对了</button>
          <button class="secondary" id="markWrongBtn">记为错题</button>
        </div>
      </div>
    `;
  }

  const good = result.status === "correct";
  const answerText = formatCanonicalAnswer(question);
  return `
    <div class="feedback-box ${good ? "good" : "bad"}">
      <p class="feedback-title">${good ? "回答正确" : "回答错误"}</p>
      <p>你的答案：${formatSelectedAnswer(result.selected, question)}</p>
      <p>标准答案：${answerText}</p>
      ${question.explanation ? `<p>解析：${escapeHtml(question.explanation)}</p>` : ""}
    </div>
  `;
}

function renderAnswerEditor(question) {
  const editorId = `editor-${question.id}`;
  const labels = question.type === "judgment"
    ? [
        { value: "true", text: "正确" },
        { value: "false", text: "错误" },
      ]
    : question.options.map((option) => ({ value: option.label, text: `${option.label}. ${option.text}` }));

  const inputType = question.type === "multiple" ? "checkbox" : "radio";
  const existing = question.answer ? (Array.isArray(question.answer) ? question.answer : [question.answer]) : [];

  return `
    <div class="answer-editor" id="${editorId}" hidden>
      <p>补录后会保存在当前浏览器，下次这题就能自动判分。</p>
      ${labels
        .map(
          (item) => `
            <label>
              <input type="${inputType}" name="answer-editor-${question.id}" value="${item.value}" ${existing.includes(item.value) ? "checked" : ""} />
              <span>${escapeHtml(item.text)}</span>
            </label>
          `
        )
        .join("")}
      <div class="answer-editor-actions">
        <button class="primary" data-save-answer="${question.id}">保存答案</button>
        <button class="ghost" data-cancel-answer="${question.id}">取消</button>
      </div>
    </div>
  `;
}

function bindQuestionEvents(question) {
  elements.questionCard.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSelection(question, button.dataset.choice);
      renderQuestion();
    });
  });

  elements.questionCard.querySelector("#submitAnswerBtn")?.addEventListener("click", () => {
    submitAnswer(question);
  });

  elements.questionCard.querySelector("#showAnswerEditorBtn")?.addEventListener("click", () => {
    toggleAnswerEditor(question.id, true);
  });

  elements.questionCard.querySelector("[data-save-answer]")?.addEventListener("click", () => {
    saveAnswerOverride(question);
  });

  elements.questionCard.querySelector("[data-cancel-answer]")?.addEventListener("click", () => {
    toggleAnswerEditor(question.id, false);
  });

  elements.questionCard.querySelector("#prevQuestionBtn")?.addEventListener("click", () => {
    state.currentSession.currentIndex -= 1;
    persistSession();
    renderStats();
    renderQuestion();
  });

  elements.questionCard.querySelector("#nextQuestionBtn")?.addEventListener("click", () => {
    state.currentSession.currentIndex += 1;
    persistSession();
    renderStats();
    renderQuestion();
  });

  elements.questionCard.querySelector("#markCorrectBtn")?.addEventListener("click", () => {
    finalizeManualResult(question, true);
  });

  elements.questionCard.querySelector("#markWrongBtn")?.addEventListener("click", () => {
    finalizeManualResult(question, false);
  });
}

function updateSelection(question, choice) {
  const questionResult = state.currentSession.results[question.id] ?? { selected: [], status: null };
  let selected = [...questionResult.selected];

  if (question.type === "multiple") {
    selected = selected.includes(choice)
      ? selected.filter((item) => item !== choice)
      : [...selected, choice];
  } else {
    selected = [choice];
  }

  state.currentSession.results[question.id] = {
    ...questionResult,
    selected,
  };
  persistSession();
}

function submitAnswer(question) {
  const result = state.currentSession.results[question.id];
  if (!result || !(result.selected ?? []).length) {
    return;
  }

  if (!question.answer) {
    result.status = "pending-manual";
    result.answeredAt = new Date().toISOString();
    persistSession();
    renderStats();
    renderQuestion();
    return;
  }

  const isCorrect = compareAnswer(question, result.selected);
  result.status = isCorrect ? "correct" : "wrong";
  result.answeredAt = new Date().toISOString();
  state.currentSession.results[question.id] = result;

  if (!isCorrect) {
    addWrongbookEntry(question, result.selected);
  }

  persistSession();
  renderStats();
  renderWrongbook();
  renderQuestion();
}

function compareAnswer(question, selected) {
  if (!question.answer) {
    return false;
  }
  const expected = Array.isArray(question.answer) ? [...question.answer].sort() : [question.answer];
  const actual = [...selected].sort();
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function finalizeManualResult(question, isCorrect) {
  const result = state.currentSession.results[question.id];
  if (!result) {
    return;
  }

  result.status = isCorrect ? "correct" : "wrong";
  result.manual = true;
  if (!isCorrect) {
    addWrongbookEntry(question, result.selected);
  }

  persistSession();
  renderStats();
  renderWrongbook();
  renderQuestion();
}

function saveAnswerOverride(question) {
  const inputs = Array.from(elements.questionCard.querySelectorAll(`input[name="answer-editor-${question.id}"]:checked`));
  const values = inputs.map((input) => input.value);
  if (!values.length) {
    alert("请至少选择一个正确答案。");
    return;
  }

  state.overrides[question.id] = question.type === "multiple" ? values.sort() : values[0];
  localStorage.setItem(STORAGE_KEYS.overrides, JSON.stringify(state.overrides));
  state.questionsById.set(question.id, hydrateQuestion({ ...question, answer: question.answer, answerSource: question.answerSource }));
  const updatedQuestion = state.questionsById.get(question.id);
  const existingResult = state.currentSession?.results?.[question.id];
  if (updatedQuestion && existingResult?.selected?.length && existingResult.status !== "correct" && existingResult.status !== "wrong") {
    const isCorrect = compareAnswer(updatedQuestion, existingResult.selected);
    existingResult.status = isCorrect ? "correct" : "wrong";
    if (!isCorrect) {
      addWrongbookEntry(updatedQuestion, existingResult.selected);
    }
  }
  persistSession();
  renderStats();
  renderWrongbook();
  renderQuestion();
}

function toggleAnswerEditor(questionId, visible) {
  const editor = document.querySelector(`#editor-${questionId}`);
  if (editor) {
    editor.hidden = !visible;
  }
}

function addWrongbookEntry(question, selected) {
  const entry = state.wrongbook[question.id] ?? {
    id: question.id,
    unit: question.unit,
    type: question.type,
    stem: question.stem,
    wrongCount: 0,
  };
  entry.selected = selected;
  entry.answer = question.answer;
  entry.lastUpdatedAt = new Date().toISOString();
  entry.wrongCount += 1;
  state.wrongbook[question.id] = entry;
  localStorage.setItem(STORAGE_KEYS.wrongbook, JSON.stringify(state.wrongbook));
}

function renderWrongbook() {
  const entries = Object.values(state.wrongbook)
    .filter((item) => state.wrongbookTypeFilter === "all" || item.type === state.wrongbookTypeFilter)
    .sort((a, b) => new Date(b.lastUpdatedAt) - new Date(a.lastUpdatedAt));

  renderTypeChips(elements.wrongbookTypeFilters, [state.wrongbookTypeFilter], setWrongbookTypeFilter, true);

  if (!entries.length) {
    elements.wrongbookList.innerHTML = `<div class="question-empty">当前还没有错题记录。</div>`;
    return;
  }

  elements.wrongbookList.innerHTML = entries
    .map(
      (entry) => `
        <article class="wrong-item">
          <h3>${escapeHtml(entry.stem)}</h3>
          <div class="meta-row">
            <span class="meta-badge">${entry.unit}</span>
            <span class="meta-badge">${TYPE_LABELS[entry.type]}</span>
            <span class="meta-badge">错了 ${entry.wrongCount} 次</span>
          </div>
          <p>最近一次作答：${formatSelectedAnswer(entry.selected ?? [], state.questionsById.get(entry.id))}</p>
          <p>标准答案：${state.questionsById.get(entry.id)?.answer ? formatCanonicalAnswer(state.questionsById.get(entry.id)) : "暂未补录"}</p>
          ${state.questionsById.get(entry.id)?.hint ? `<p>题干内提示：${escapeHtml(state.questionsById.get(entry.id).hint)}</p>` : ""}
          <div class="actions">
            <button class="mini" data-practice-wrong="${entry.id}">只练这题</button>
            <button class="mini" data-remove-wrong="${entry.id}">移出错题本</button>
          </div>
        </article>
      `
    )
    .join("");

  elements.wrongbookList.querySelectorAll("[data-remove-wrong]").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.wrongbook[button.dataset.removeWrong];
      localStorage.setItem(STORAGE_KEYS.wrongbook, JSON.stringify(state.wrongbook));
      renderWrongbook();
    });
  });

  elements.wrongbookList.querySelectorAll("[data-practice-wrong]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = state.questionsById.get(button.dataset.practiceWrong);
      state.currentSession = createSession([question]);
      persistSession();
      renderStats();
      renderQuestion();
    });
  });
}

function renderStats() {
  const total = state.currentSession?.queue.length ?? 0;
  const results = Object.values(state.currentSession?.results ?? {});
  const answered = results.filter((item) => item.status).length;
  const correct = results.filter((item) => item.status === "correct").length;
  const wrong = results.filter((item) => item.status === "wrong").length;
  const accuracy = answered ? `${Math.round((correct / answered) * 100)}%` : "--";

  elements.statsGrid.innerHTML = [
    { label: "当前题量", value: total || "--" },
    { label: "已完成", value: answered || "--" },
    { label: "正确率", value: accuracy },
    { label: "错题本", value: Object.keys(state.wrongbook).length || "--" },
  ]
    .map(
      (item) => `
        <article class="stat-card">
          <p>${item.label}</p>
          <strong>${item.value}</strong>
        </article>
      `
    )
    .join("");
}

function getFilteredQuestions() {
  const scopeMode = elements.scopeMode.value;
  const selectedTypes = getSelectedTypesFromSession() ?? ["single", "multiple", "judgment"];
  const selectedUnits = getSelectedUnitIndices();

  if (scopeMode === "wrongOnly") {
    return Object.keys(state.wrongbook)
      .map((id) => state.questionsById.get(id))
      .filter((question) => question && selectedTypes.includes(question.type));
  }

  return state.dataset.questions
    .map((question) => state.questionsById.get(question.id))
    .filter((question) => selectedTypes.includes(question.type))
    .filter((question) => scopeMode === "all" || selectedUnits.includes(question.unitIndex));
}

function getCurrentQuestion() {
  if (!state.currentSession?.queue.length) {
    return null;
  }
  const queueItem = state.currentSession.queue[state.currentSession.currentIndex];
  return state.questionsById.get(queueItem.id);
}

function persistSession() {
  if (!state.currentSession) {
    return;
  }
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.currentSession));
}

function restoreSession() {
  const session = loadJson(STORAGE_KEYS.session, null);
  if (!session?.queue?.length) {
    return false;
  }

  state.currentSession = session;
  state.currentSession.queue = state.currentSession.queue.map((item) => {
    const question = state.questionsById.get(item.id);
    if (!question) {
      return item;
    }
    return normalizeQueueItemOptions(item, question);
  });
  persistSession();
  elements.scopeMode.value = session.config.scopeMode;
  elements.orderMode.value = session.config.orderMode;
  renderFilters();
  renderStats();
  renderWrongbook();
  renderQuestion();
  return true;
}

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function shuffle(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function normalizeQueueItemOptions(queueItem, question) {
  const validLabels = question.options.map((option) => option.label);
  if (!validLabels.length) {
    return queueItem;
  }

  const current = Array.isArray(queueItem.optionOrder) ? queueItem.optionOrder : [];
  const sameLength = current.length === validLabels.length;
  const sameMembers = sameLength && validLabels.every((label) => current.includes(label));

  if (sameMembers) {
    return queueItem;
  }

  queueItem.optionOrder = shuffle(validLabels);
  return queueItem;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSelectedAnswer(selected, question) {
  if (!selected?.length) {
    return "未作答";
  }
  if (question.type === "judgment") {
    return selected.map((item) => (item === "true" ? "正确" : "错误")).join(" / ");
  }
  return selected.join("、");
}

function formatCanonicalAnswer(question) {
  if (!question.answer) {
    return "暂未补录";
  }
  if (question.type === "judgment") {
    return question.answer === "true" ? "正确" : "错误";
  }
  return Array.isArray(question.answer) ? question.answer.join("、") : question.answer;
}

function togglePracticeType(typeKey) {
  const selected = new Set(getSelectedTypesFromSession() ?? ["single", "multiple", "judgment"]);
  if (selected.has(typeKey) && selected.size > 1) {
    selected.delete(typeKey);
  } else {
    selected.add(typeKey);
  }
  setPendingTypeSelection([...selected]);
  renderFilters();
}

function setWrongbookTypeFilter(typeKey) {
  state.wrongbookTypeFilter = typeKey;
  renderWrongbook();
}

function getSelectedTypesFromSession() {
  return state.currentSession?.config?.selectedTypes ?? state.pendingTypeSelection;
}

function setPendingTypeSelection(types) {
  state.pendingTypeSelection = types;
  if (state.currentSession?.config) {
    state.currentSession.config.selectedTypes = types;
    persistSession();
  }
}

function getSelectedUnitIndices() {
  return state.currentSession?.config?.selectedUnits ?? state.pendingUnitSelection ?? state.dataset.units.map((unit) => unit.index);
}

function setPendingUnitSelection(unitIndices) {
  state.pendingUnitSelection = unitIndices;
  if (state.currentSession?.config) {
    state.currentSession.config.selectedUnits = unitIndices;
    persistSession();
  }
}

function isUnitSelected(index) {
  return getSelectedUnitIndices().includes(index);
}
