/* =====================================================================
   Квиз «Прайм тур» — движок.
   Контент не здесь, а в quiz-config.js. Здесь только логика:
   рендер экранов, состояние, валидация, телефон, отправка на бэкенд.

   Режимы (mode):
     tg   — запуск внутри Telegram (есть подписанный initData);
     web  — обычный браузер/сайт (второй этап, подпись заменяется
            honeypot + проверкой Origin на стороне GAS).
   ===================================================================== */
(function () {
  "use strict";

  var CFG = window.QUIZ_CONFIG;
  var TG = (window.Telegram && window.Telegram.WebApp) || null;
  var IS_DEV = !!(TG && TG.__dev);
  var DEV_POST = /[?&]post=1/.test(location.search); // в dev по умолчанию не отправляем
  // Демо: настоящий Telegram и настоящий requestContact, но заявка никуда не уходит.
  // Нужен, пока бэкенд не задеплоен: ?demo=1 в адресе Mini App.
  var IS_DEMO = /[?&]demo=1/.test(location.search);
  var STORE_KEY = "primetour_quiz_v" + CFG.version;

  var app = document.getElementById("app");
  // Нижнюю кнопку рендер-функции складывают сюда, а render() добавляет её
  // ПОСЛЕ очистки контейнера — иначе она стирается вместе со старым экраном.
  var pendingFooter = null;

  /* ---------- Состояние ---------- */
  var state = {
    mode: TG && TG.initData ? "tg" : "web",
    idx: -1, // -1 = интро, 0..n-1 = шаги, n = контакт, n+1 = финал
    answers: {}, // { destination: "turkey", priorities: ["ai","spa"], when: {...}, ... }
    contact: { name: "", phone: "", comment: "", pd: false, marketing: false },
    phoneSource: null, // "telegram" | "manual"
    contactResponse: null, // подписанная строка от requestContact — её проверит сервер
    sending: false,
    serverError: "",
  };

  /* ---------- Утилиты ---------- */
  function el(tag, className, html) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function tpl(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] != null ? vars[k] : "";
    });
  }

  function haptic(type) {
    try {
      if (!TG || !TG.HapticFeedback) return;
      if (type === "select") TG.HapticFeedback.selectionChanged();
      else TG.HapticFeedback.notificationOccurred(type);
    } catch (e) { /* не критично */ }
  }

  /* Картинка: сначала .webp, если её нет — .svg-заглушка. */
  function imageNode(name, alt) {
    var img = el("img");
    img.loading = "lazy";
    img.alt = alt || "";
    img.src = "img/" + name + ".webp";
    img.onerror = function () {
      img.onerror = null;
      img.src = "img/" + name + ".svg";
    };
    return img;
  }

  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        idx: state.idx, answers: state.answers, contact: state.contact,
        phoneSource: state.phoneSource,
      }));
    } catch (e) { /* приватный режим — переживём */ }
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && typeof data.idx === "number" && data.idx >= 0) {
        state.answers = data.answers || {};
        state.contact = data.contact || state.contact;
        state.phoneSource = data.phoneSource || null;
        // Телефон из Telegram переподтверждаем заново: подпись не храним.
        if (state.phoneSource === "telegram") {
          state.phoneSource = null;
          state.contact.phone = "";
        }
        state.idx = Math.min(data.idx, CFG.steps.length); // не восстанавливаем экран «спасибо»
      }
    } catch (e) { /* битые данные — начинаем сначала */ }
  }

  /* ---------- Видимые шаги (с учётом showIf) ---------- */
  function isVisible(step) {
    if (!step.showIf) return true;
    return Object.keys(step.showIf).every(function (key) {
      var need = step.showIf[key];
      var got = state.answers[key];
      return Array.isArray(need) ? need.indexOf(got) >= 0 : got === need;
    });
  }

  function visibleSteps() {
    return CFG.steps.filter(isVisible);
  }

  function currentStep() {
    return CFG.steps[state.idx];
  }

  /* Следующий/предыдущий индекс с пропуском невидимых шагов */
  function moveIdx(dir) {
    var i = state.idx + dir;
    while (i >= 0 && i < CFG.steps.length && !isVisible(CFG.steps[i])) i += dir;
    return i;
  }

  /* ---------- Валидация текущего шага ---------- */
  function stepReady() {
    var step = currentStep();
    if (!step) return true;
    var a = state.answers[step.id];
    switch (step.type) {
      case "cards":
      case "list":
        return !!a;
      case "chips":
        return step.multi ? !!(a && a.length) : !!a;
      case "when":
        return !!(a && a.month);
      case "who":
        return !!(a && a.adults >= 1);
      case "groups":
        return step.groups.every(function (g) {
          var val = a && a[g.id];
          if (!val) return false;
          if (g.otherId && val === g.otherId) return !!(a[g.id + "_other"] || "").trim();
          return true;
        });
      default:
        return true;
    }
  }

  /* ---------- Рендер: общая обвязка ---------- */
  function render() {
    var prev = app.firstElementChild;
    if (prev) prev.classList.add("leave");

    pendingFooter = null;
    var frag = document.createDocumentFragment();
    var steps = visibleSteps();
    var isStep = state.idx >= 0 && state.idx < CFG.steps.length;
    var isContact = state.idx === CFG.steps.length;
    var isDone = state.idx > CFG.steps.length;

    // Шапка с прогрессом — на шагах и на контакте
    if (isStep || isContact) {
      var pos = isContact ? steps.length + 1 : steps.indexOf(currentStep()) + 1;
      var total = steps.length + 1; // + экран контакта
      var top = el("div", "top");
      var bar = el("div", "progress");
      var fill = el("i");
      bar.appendChild(fill);
      top.appendChild(bar);
      var row = el("div", "top-row");
      row.appendChild(el("span", "step", tpl(CFG.ui.stepOf, { n: pos, total: total })));
      top.appendChild(row);
      frag.appendChild(top);
      setTimeout(function () { fill.style.width = (pos / total * 100) + "%"; }, 20);
    }

    var screen = el("div", "screen");
    if (state.idx === -1) renderIntro(screen);
    else if (isStep) renderStep(screen, currentStep());
    else if (isContact) renderContact(screen);
    else if (isDone) renderDone(screen);
    frag.appendChild(screen);

    app.innerHTML = "";
    app.appendChild(frag);
    if (pendingFooter) app.appendChild(pendingFooter);
    window.scrollTo(0, 0);
    syncBackButton();
  }

  /** Ставит нижнюю кнопку текущего экрана (добавится в конце render). */
  function setFooter(node) {
    pendingFooter = node;
  }

  function footer(label, onClick, opts) {
    opts = opts || {};
    var wrap = el("div", "footer");
    var inner = el("div", "footer-inner");
    var btn = el("button", "btn");
    btn.type = "button";
    btn.innerHTML = label;
    btn.disabled = !!opts.disabled;
    btn.onclick = onClick;
    inner.appendChild(btn);
    if (opts.extra) inner.appendChild(opts.extra);
    wrap.appendChild(inner);
    return wrap;
  }

  /* ---------- Экран: интро ---------- */
  function renderIntro(root) {
    var brand = el("div", "brand");
    brand.appendChild(el("span", "dot"));
    brand.appendChild(el("span", null, esc(CFG.brand.name)));
    root.appendChild(brand);

    var hero = el("div", "hero");
    hero.appendChild(imageNode(CFG.intro.image, CFG.intro.title));
    root.appendChild(hero);

    root.appendChild(el("h1", null, esc(CFG.intro.title)));
    root.appendChild(el("p", "subtitle", esc(CFG.intro.subtitle)));

    setFooter(footer(esc(CFG.intro.button), function () {
      haptic("select");
      state.idx = isVisible(CFG.steps[0]) ? 0 : moveIdx(1);
      if (state.idx < 0) state.idx = 0;
      save();
      render();
    }));
  }

  /* ---------- Экран: шаг ---------- */
  function renderStep(root, step) {
    root.appendChild(el("h1", null, esc(step.title)));
    if (step.subtitle) root.appendChild(el("p", "subtitle", esc(step.subtitle)));

    var body =
      step.type === "cards" ? renderCards(step) :
      step.type === "chips" ? renderChips(step) :
      step.type === "list" ? renderList(step) :
      step.type === "when" ? renderWhen(step) :
      step.type === "who" ? renderWho(step) :
      step.type === "groups" ? renderGroups(step) : el("div");
    root.appendChild(body);

    setFooter(footer(esc(CFG.ui.next), next, { disabled: !stepReady() }));
  }

  function refreshFooterState() {
    var btn = app.querySelector(".footer .btn");
    if (btn) btn.disabled = !stepReady();
  }

  function pick(step, value, autoNext) {
    state.answers[step.id] = value;
    // Смена направления сбрасывает бюджет: у направления может быть своя шкала
    if (step.id === "destination") delete state.answers.budget;
    haptic("select");
    save();
    if (autoNext) setTimeout(next, 180);
    else render();
  }

  function toggle(step, id) {
    var arr = state.answers[step.id] || [];
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    state.answers[step.id] = arr;
    haptic("select");
    save();
  }

  /* Карточки с картинками (направления) */
  function renderCards(step) {
    var grid = el("div", "cards");
    step.options.forEach(function (opt) {
      var card = el("button", "card" + (state.answers[step.id] === opt.id ? " selected" : ""));
      card.type = "button";
      var imgBox = el("div", "img");
      imgBox.appendChild(imageNode(opt.image, opt.label));
      card.appendChild(imgBox);
      var txt = el("div", "txt");
      txt.appendChild(el("div", "label", esc(opt.label)));
      if (opt.hint) txt.appendChild(el("div", "hint", esc(opt.hint)));
      card.appendChild(txt);
      card.appendChild(el("span", "check", "✓"));
      card.onclick = function () { pick(step, opt.id, true); };
      grid.appendChild(card);
    });
    return grid;
  }

  /* Чипы: мультивыбор или один */
  function renderChips(step) {
    var box = el("div", "chips");
    step.options.forEach(function (opt) {
      var selected = step.multi
        ? (state.answers[step.id] || []).indexOf(opt.id) >= 0
        : state.answers[step.id] === opt.id;
      var chip = el("button", "chip" + (selected ? " selected" : ""));
      chip.type = "button";
      if (opt.emoji) chip.appendChild(el("span", "emoji", opt.emoji));
      chip.appendChild(el("span", null, esc(opt.label)));
      chip.onclick = function () {
        if (step.multi) {
          toggle(step, opt.id);
          chip.classList.toggle("selected");
          refreshFooterState();
        } else {
          pick(step, opt.id, true);
        }
      };
      box.appendChild(chip);
    });
    return box;
  }

  /* Список-радио (бюджет) */
  function budgetOptions(step) {
    var dest = state.answers.destination;
    if (step.byDestination && dest && step.byDestination[dest]) return step.byDestination[dest];
    return step.options;
  }

  function renderList(step) {
    var box = el("div", "list");
    budgetOptions(step).forEach(function (opt) {
      var row = el("button", "row" + (state.answers[step.id] === opt.id ? " selected" : ""));
      row.type = "button";
      row.appendChild(el("span", null, esc(opt.label)));
      row.appendChild(el("span", "radio"));
      row.onclick = function () { pick(step, opt.id, true); };
      box.appendChild(row);
    });
    return box;
  }

  /* Когда: месяцы + длительность */
  function renderWhen(step) {
    var box = el("div");
    var a = state.answers[step.id] || {};
    var now = new Date();

    var months = el("div", "chips grid3");
    for (var i = 0; i < step.monthsAhead; i++) {
      (function () {
        var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        var label = CFG.ui.months[d.getMonth()].slice(0, 3) +
          (d.getFullYear() !== now.getFullYear() ? " " + String(d.getFullYear()).slice(2) : "");
        var chip = el("button", "chip" + (a.month === key ? " selected" : ""));
        chip.type = "button";
        chip.textContent = label;
        chip.onclick = function () {
          a.month = key;
          a.monthLabel = CFG.ui.months[d.getMonth()] + " " + d.getFullYear();
          state.answers[step.id] = a;
          haptic("select");
          save();
          render();
        };
        months.appendChild(chip);
      })();
    }
    box.appendChild(months);

    var unknown = el("button", "chip" + (a.month === "unknown" ? " selected" : ""));
    unknown.type = "button";
    unknown.style.marginTop = "10px";
    unknown.textContent = step.unknownLabel;
    unknown.onclick = function () {
      a.month = "unknown";
      a.monthLabel = step.unknownLabel;
      state.answers[step.id] = a;
      haptic("select");
      save();
      render();
    };
    box.appendChild(unknown);

    box.appendChild(el("div", "group-title", esc(step.nightsTitle)));
    var nights = el("div", "chips grid4");
    step.nights.forEach(function (opt) {
      var chip = el("button", "chip" + (a.nights === opt.id ? " selected" : ""));
      chip.type = "button";
      chip.textContent = opt.label;
      chip.onclick = function () {
        a.nights = opt.id;
        a.nightsLabel = opt.label;
        state.answers[step.id] = a;
        haptic("select");
        save();
        render();
      };
      nights.appendChild(chip);
    });
    box.appendChild(nights);
    return box;
  }

  /* Кто едет: степперы + возрасты детей */
  function renderWho(step) {
    var box = el("div");
    var a = state.answers[step.id] || { adults: 2, children: 0, ages: [] };
    state.answers[step.id] = a;

    function stepper(label, key, max, min) {
      var row = el("div", "stepper-row");
      row.appendChild(el("span", null, esc(label)));
      var ctl = el("div", "stepper");
      var minus = el("button", null, "−");
      minus.type = "button";
      var val = el("span", "val", String(a[key]));
      var plus = el("button", null, "+");
      plus.type = "button";
      minus.disabled = a[key] <= min;
      plus.disabled = a[key] >= max;
      minus.onclick = function () {
        if (a[key] > min) { a[key]--; haptic("select"); save(); render(); }
      };
      plus.onclick = function () {
        if (a[key] < max) { a[key]++; haptic("select"); save(); render(); }
      };
      ctl.appendChild(minus); ctl.appendChild(val); ctl.appendChild(plus);
      row.appendChild(ctl);
      return row;
    }

    box.appendChild(stepper(step.adultsLabel, "adults", step.maxAdults, 1));
    box.appendChild(stepper(step.childrenLabel, "children", step.maxChildren, 0));

    if (a.children > 0) {
      box.appendChild(el("div", "group-title", esc(step.agesTitle)));
      var ages = el("div", "chips");
      step.ages.forEach(function (opt) {
        var count = (a.ages || []).filter(function (x) { return x === opt.id; }).length;
        var chip = el("button", "chip" + (count ? " selected" : ""));
        chip.type = "button";
        chip.textContent = opt.label + (count > 1 ? " ×" + count : "");
        chip.onclick = function () {
          a.ages = a.ages || [];
          if (a.ages.length >= a.children && count === 0) a.ages.shift();
          a.ages.push(opt.id);
          if (a.ages.length > a.children) a.ages = a.ages.slice(-a.children);
          haptic("select");
          save();
          render();
        };
        ages.appendChild(chip);
      });
      box.appendChild(ages);
      var left = a.children - (a.ages || []).length;
      if (left > 0) box.appendChild(el("p", "muted", "Осталось указать: " + left));
    }
    return box;
  }

  /* Несколько групп чипов на одном экране (город вылета + срочность) */
  function renderGroups(step) {
    var box = el("div");
    var a = state.answers[step.id] || {};
    state.answers[step.id] = a;

    step.groups.forEach(function (g) {
      box.appendChild(el("div", "group-title", esc(g.title)));
      var chips = el("div", "chips");
      g.options.forEach(function (opt) {
        var chip = el("button", "chip" + (a[g.id] === opt.id ? " selected" : ""));
        chip.type = "button";
        chip.textContent = opt.label;
        chip.onclick = function () {
          a[g.id] = opt.id;
          a[g.id + "_label"] = opt.label;
          haptic("select");
          save();
          render();
        };
        chips.appendChild(chip);
      });
      box.appendChild(chips);

      if (g.otherId && a[g.id] === g.otherId) {
        var input = el("input", "input");
        input.type = "text";
        input.placeholder = g.otherPlaceholder || "";
        input.value = a[g.id + "_other"] || "";
        input.style.marginTop = "10px";
        input.oninput = function () {
          a[g.id + "_other"] = input.value;
          save();
          refreshFooterState();
        };
        box.appendChild(input);
      }
    });
    return box;
  }

  /* ---------- Экран: контакт ---------- */
  function renderContact(root) {
    var C = CFG.contact;
    root.appendChild(el("h1", null, esc(C.title)));
    root.appendChild(el("p", "subtitle", esc(C.subtitle)));

    // Имя
    var nameField = el("div", "field");
    nameField.appendChild(el("label", null, esc(C.nameLabel)));
    var nameInput = el("input", "input");
    nameInput.type = "text";
    nameInput.placeholder = C.namePlaceholder;
    nameInput.value = state.contact.name || prefillName();
    state.contact.name = nameInput.value;
    nameInput.oninput = function () {
      state.contact.name = nameInput.value;
      nameInput.classList.remove("error");
      save();
    };
    nameField.appendChild(nameInput);
    root.appendChild(nameField);

    // Телефон
    var phoneField = el("div", "field");
    phoneField.appendChild(el("label", null, esc(C.phoneLabel)));
    var canShare = state.mode === "tg" && TG && TG.requestContact && safeVersion("6.9");

    if (state.phoneSource === "telegram" && state.contact.phone) {
      var ok = el("div", "phone-ok");
      var left = el("div");
      left.appendChild(el("b", null, esc(state.contact.phone)));
      left.appendChild(el("small", null, esc(C.phoneShared)));
      ok.appendChild(left);
      var change = el("button", "link", esc(C.changePhone));
      change.type = "button";
      change.onclick = function () {
        state.phoneSource = null;
        state.contact.phone = "";
        state.contactResponse = null;
        save();
        render();
      };
      ok.appendChild(change);
      phoneField.appendChild(ok);
    } else if (canShare && state.phoneSource !== "manual") {
      var share = el("button", "btn-share", esc(C.shareButton));
      share.type = "button";
      share.onclick = askContact;
      phoneField.appendChild(share);
      var manual = el("button", "link", esc(C.manualLink));
      manual.type = "button";
      manual.style.marginTop = "10px";
      manual.onclick = function () { state.phoneSource = "manual"; render(); };
      phoneField.appendChild(manual);
    } else {
      var phoneInput = el("input", "input");
      phoneInput.type = "tel";
      phoneInput.inputMode = "tel";
      phoneInput.placeholder = C.phonePlaceholder;
      phoneInput.value = state.contact.phone || "";
      phoneInput.oninput = function () {
        phoneInput.value = maskPhone(phoneInput.value);
        state.contact.phone = phoneInput.value;
        state.phoneSource = "manual";
        phoneInput.classList.remove("error");
        save();
      };
      phoneField.appendChild(phoneInput);
      if (canShare) {
        var backToShare = el("button", "link", esc(C.shareButton));
        backToShare.type = "button";
        backToShare.style.marginTop = "10px";
        backToShare.onclick = function () { state.phoneSource = null; render(); };
        phoneField.appendChild(backToShare);
      }
    }
    root.appendChild(phoneField);

    // Комментарий
    var commentField = el("div", "field");
    commentField.appendChild(el("label", null, esc(C.commentLabel)));
    var comment = el("textarea", "input");
    comment.placeholder = C.commentPlaceholder;
    comment.value = state.contact.comment || "";
    comment.oninput = function () { state.contact.comment = comment.value; save(); };
    commentField.appendChild(comment);
    root.appendChild(commentField);

    // Honeypot — для режима «сайт»: боты заполняют, люди не видят
    var hp = el("input", "hp");
    hp.type = "text";
    hp.name = "company";
    hp.tabIndex = -1;
    hp.autocomplete = "off";
    hp.id = "hp-field";
    root.appendChild(hp);

    // Согласия
    var pdRow = el("div", "check-row");
    var pdBox = el("input");
    pdBox.type = "checkbox";
    pdBox.checked = !!state.contact.pd;
    pdBox.id = "pd";
    pdBox.onchange = function () {
      state.contact.pd = pdBox.checked;
      var e = root.querySelector(".err-consent");
      if (e) e.remove();
      save();
    };
    var pdLabel = el("label");
    pdLabel.htmlFor = "pd";
    pdLabel.innerHTML = esc(CFG.consent.pdText) +
      ' — <a href="' + esc(CFG.consent.policyUrl) + '" target="_blank" rel="noopener">' +
      esc(CFG.consent.policyLinkText) + "</a>";
    pdRow.appendChild(pdBox);
    pdRow.appendChild(pdLabel);
    root.appendChild(pdRow);

    var mkRow = el("div", "check-row");
    var mkBox = el("input");
    mkBox.type = "checkbox";
    mkBox.checked = !!state.contact.marketing;
    mkBox.id = "mk";
    mkBox.onchange = function () { state.contact.marketing = mkBox.checked; save(); };
    var mkLabel = el("label");
    mkLabel.htmlFor = "mk";
    mkLabel.textContent = CFG.consent.marketingText;
    mkRow.appendChild(mkBox);
    mkRow.appendChild(mkLabel);
    root.appendChild(mkRow);

    if (state.serverError) {
      var box = el("div", "server-err");
      box.innerHTML = esc(state.serverError) +
        ' <a href="' + esc(CFG.brand.channelUrl) + '" target="_blank" rel="noopener">' +
        esc(CFG.brand.channelUrl.replace("https://", "")) + "</a>";
      root.appendChild(box);
    }

    setFooter(footer(
      state.sending ? '<span class="spinner"></span>' + esc(C.sending) : esc(C.submit),
      submit,
      { disabled: state.sending }
    ));
  }

  function prefillName() {
    try {
      var u = TG && TG.initDataUnsafe && TG.initDataUnsafe.user;
      return u && u.first_name ? u.first_name : "";
    } catch (e) { return ""; }
  }

  function safeVersion(v) {
    try { return TG.isVersionAtLeast(v); } catch (e) { return false; }
  }

  function maskPhone(raw) {
    var d = String(raw).replace(/\D/g, "");
    if (!d) return "";
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] !== "7" && d.length <= 10) d = "7" + d;
    d = d.slice(0, 11);
    var out = "+" + d[0];
    if (d.length > 1) out += " " + d.slice(1, 4);
    if (d.length > 4) out += " " + d.slice(4, 7);
    if (d.length > 7) out += "-" + d.slice(7, 9);
    if (d.length > 9) out += "-" + d.slice(9, 11);
    return out;
  }

  /* Запрос телефона у Telegram. Телефон, которому мы верим, — только отсюда:
     в пакет уходит подписанная строка response, её проверяет GAS. */
  function askContact() {
    var handled = false;
    function accept(data) {
      if (handled) return;
      handled = true;
      TG.offEvent("contactRequested", accept);
      if (!data || data.status !== "sent") {
        state.phoneSource = "manual"; // отказ — показываем ручной ввод
        render();
        return;
      }
      var phone = "";
      try { phone = data.responseUnsafe.contact.phone_number; } catch (e) { /* ниже */ }
      if (!phone) { state.phoneSource = "manual"; render(); return; }
      state.contact.phone = phone.charAt(0) === "+" ? phone : "+" + phone;
      state.phoneSource = "telegram";
      state.contactResponse = data.response || null;
      haptic("success");
      save();
      render();
      if (TG.requestWriteAccess) { try { TG.requestWriteAccess(function () {}); } catch (e) {} }
    }
    try {
      TG.onEvent("contactRequested", accept);
      TG.requestContact(function (shared, data) {
        accept(data || (shared ? { status: "sent" } : { status: "cancelled" }));
      });
    } catch (e) {
      state.phoneSource = "manual";
      render();
    }
  }

  /* ---------- Экран: спасибо ---------- */
  function renderDone(root) {
    var D = CFG.done;
    root.classList.add("center");
    var hero = el("div", "hero");
    hero.appendChild(imageNode(D.image, D.title));
    root.appendChild(hero);
    root.appendChild(el("h1", null, esc(tpl(D.title, { name: state.contact.name }))));
    var text = state.duplicate ? D.duplicateText : D.text;
    root.appendChild(el("p", "lead", esc(tpl(text, {
      workHours: CFG.brand.workHours, phone: CFG.brand.phone,
    }))));

    var extra = null;
    if (state.mode === "web" || !TG) {
      extra = el("a", "btn secondary");
      extra.href = CFG.brand.channelUrl;
      extra.target = "_blank";
      extra.rel = "noopener";
      extra.textContent = D.channelButton;
      extra.style.display = "block";
      extra.style.textAlign = "center";
      extra.style.textDecoration = "none";
      extra.style.boxSizing = "border-box";
    }

    setFooter(footer(esc(D.closeButton), function () {
      if (TG && TG.close) TG.close();
      else window.location.href = CFG.brand.channelUrl;
    }, { extra: extra }));
  }

  /* ---------- Навигация ---------- */
  function next() {
    if (state.idx >= 0 && state.idx < CFG.steps.length && !stepReady()) return;
    var i = moveIdx(1);
    state.idx = i > CFG.steps.length ? CFG.steps.length : i;
    haptic("select");
    save();
    render();
  }

  function back() {
    if (state.idx <= -1) return;
    if (state.idx === CFG.steps.length) {
      // с экрана контакта — на последний видимый шаг
      var vs = visibleSteps();
      state.idx = CFG.steps.indexOf(vs[vs.length - 1]);
    } else {
      state.idx = moveIdx(-1);
    }
    if (state.idx < -1) state.idx = -1;
    save();
    render();
  }

  function syncBackButton() {
    if (!TG || !TG.BackButton) return;
    try {
      if (state.idx >= 0 && state.idx <= CFG.steps.length) TG.BackButton.show();
      else TG.BackButton.hide();
    } catch (e) { /* старый клиент */ }
  }

  /* ---------- Сборка пакета и отправка ---------- */
  function buildPayload() {
    var budgetStep = CFG.steps.filter(function (s) { return s.id === "budget"; })[0];
    var budgetOpt = null;
    if (budgetStep) {
      budgetOpt = budgetOptions(budgetStep).filter(function (o) {
        return o.id === state.answers.budget;
      })[0] || null;
    }
    var labels = {};
    CFG.steps.forEach(function (step) {
      var a = state.answers[step.id];
      if (a == null) return;
      if (step.options) {
        var byId = {};
        (step.id === "budget" ? budgetOptions(step) : step.options).forEach(function (o) { byId[o.id] = o.label; });
        labels[step.id] = Array.isArray(a) ? a.map(function (x) { return byId[x] || x; }) : (byId[a] || a);
      }
    });

    return {
      action: "submit",
      channel: state.mode === "tg" ? "telegram" : "site",
      quizVersion: CFG.version,
      initData: state.mode === "tg" ? (TG ? TG.initData : "") : "",
      contactResponse: state.contactResponse || "", // подписанный телефон из Telegram
      startParam: startParam(),
      utm: utmFromUrl(),
      hp: (document.getElementById("hp-field") || {}).value || "",
      answers: state.answers,
      labels: labels,             // человекочитаемые подписи — чтобы GAS не знал контента
      budgetValue: budgetOpt ? budgetOpt.uonBudget : 0,
      budgetLabel: budgetOpt ? budgetOpt.label : "",
      phoneSource: state.phoneSource,
      contact: {
        name: (state.contact.name || "").trim(),
        phone: (state.contact.phone || "").trim(),
        comment: (state.contact.comment || "").trim(),
      },
      consent: {
        pd: !!state.contact.pd,
        marketing: !!state.contact.marketing,
        version: CFG.consent.version,
        at: new Date().toISOString(),
      },
      client: {
        platform: TG ? TG.platform : "browser",
        tgVersion: TG ? TG.version : "",
        lang: (navigator.language || "").slice(0, 5),
      },
    };
  }

  function startParam() {
    try {
      if (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) return TG.initDataUnsafe.start_param;
    } catch (e) { /* ниже */ }
    return new URLSearchParams(location.search).get("campaign") || "";
  }

  function utmFromUrl() {
    var p = new URLSearchParams(location.search);
    var out = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
      if (p.get(k)) out[k] = p.get(k);
    });
    return out;
  }

  function submit() {
    if (state.sending) return;
    var C = CFG.contact;
    var root = app.querySelector(".screen");
    var firstBad = null;
    root.querySelectorAll(".err").forEach(function (n) { n.remove(); });

    if (!(state.contact.name || "").trim()) {
      var nameInput = root.querySelector('input[type="text"]:not(.hp)');
      if (nameInput) { nameInput.classList.add("error"); nameInput.parentNode.appendChild(el("div", "err", C.errors.name)); }
      firstBad = firstBad || nameInput;
    }
    var digits = (state.contact.phone || "").replace(/\D/g, "");
    if (digits.length < 11) {
      var phoneInput = root.querySelector('input[type="tel"]');
      if (phoneInput) { phoneInput.classList.add("error"); phoneInput.parentNode.appendChild(el("div", "err", C.errors.phone)); }
      else {
        var pf = root.querySelectorAll(".field")[1];
        if (pf) pf.appendChild(el("div", "err", C.errors.phone));
      }
      firstBad = firstBad || phoneInput;
    }
    if (!state.contact.pd) {
      var pdRow = root.querySelector(".check-row");
      if (pdRow) pdRow.parentNode.insertBefore(el("div", "err err-consent", C.errors.consent), pdRow.nextSibling);
      firstBad = firstBad || pdRow;
    }
    if (firstBad) {
      haptic("error");
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    var payload = buildPayload();

    if ((IS_DEV && !DEV_POST) || IS_DEMO) {
      console.log("[quiz] Пакет для бэкенда:", payload);
      console.log("[quiz] JSON:", JSON.stringify(payload, null, 2));
      // В демо главное — проверить телефон: пришёл ли он из Telegram и есть ли подпись,
      // которую потом проверит сервер. Консоли на телефоне нет, поэтому показываем в окне.
      var src = payload.phoneSource === "telegram" ? "из Telegram" : (payload.phoneSource === "manual" ? "введён вручную" : "неизвестно");
      var sig = payload.contactResponse ? ("есть, " + payload.contactResponse.length + " симв.") : "НЕТ";
      var note = "Демо-режим: заявка не отправлена.\n\nТелефон: " + (payload.contact.phone || "пусто") +
        "\nИсточник: " + src + "\nПодпись Telegram: " + sig;
      if (IS_DEV && !IS_DEMO) note = "dev-режим: пакет напечатан в консоль, на сервер не отправлен.\nДобавьте &post=1 в адрес, чтобы отправить.";
      if (IS_DEMO && TG && TG.showAlert) { try { TG.showAlert(note); } catch (e) { alert(note); } }
      else alert(note);
      state.duplicate = false;
      haptic("success");
      state.idx = CFG.steps.length + 1;
      render();
      return;
    }

    state.sending = true;
    state.serverError = "";
    render();

    // Content-Type: text/plain — чтобы браузер не слал preflight (GAS его не умеет)
    fetch(CFG.backendUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var data;
        try { data = JSON.parse(t); } catch (e) { data = { ok: false, error: "bad_response" }; }
        state.sending = false;
        if (data.ok) {
          state.duplicate = !!data.duplicate;
          try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
          haptic("success");
          state.idx = CFG.steps.length + 1;
          render();
        } else {
          haptic("error");
          state.serverError = CFG.contact.errors.server;
          render();
        }
      })
      .catch(function () {
        state.sending = false;
        haptic("error");
        state.serverError = CFG.contact.errors.network;
        render();
      });
  }

  /* ---------- Старт ---------- */
  function init() {
    if (TG) {
      try {
        TG.ready();
        TG.expand();
        if (TG.BackButton) TG.BackButton.onClick(back);
      } catch (e) { /* старый клиент — работаем как есть */ }
    }
    restore();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
