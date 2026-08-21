/* Заглушка Telegram.WebApp для локальной отладки в обычном браузере.
   Подключается только при index.html?dev=1 (см. index.html).
   Что делает: подставляет фейковый initData (подпись невалидная — бэкенд её отвергнет,
   поэтому в dev-режиме app.js по умолчанию НЕ отправляет запрос, а печатает пакет в консоль;
   добавьте &post=1, чтобы всё-таки отправить).
*/
(function () {
  var user = { id: 123456789, first_name: "Тест", last_name: "Тестов", username: "test_user", language_code: "ru" };
  var params = new URLSearchParams(location.search);
  var initData =
    "query_id=AAHdF6IQAAAAAN0XohDhrOrc" +
    "&user=" + encodeURIComponent(JSON.stringify(user)) +
    "&auth_date=" + Math.floor(Date.now() / 1000) +
    (params.get("campaign") ? "&start_param=" + encodeURIComponent(params.get("campaign")) : "") +
    "&hash=dev-fake-hash";

  function log() { console.log.apply(console, ["[tg-shim]"].concat([].slice.call(arguments))); }

  var handlers = {};
  window.Telegram = window.Telegram || {};
  window.Telegram.WebApp = {
    __dev: true,
    initData: initData,
    initDataUnsafe: { user: user, auth_date: Math.floor(Date.now() / 1000), start_param: params.get("campaign") || "" },
    version: "8.0",
    platform: "dev",
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    themeParams: {},
    isExpanded: true,
    isVersionAtLeast: function () { return true; },
    ready: function () { log("ready"); },
    expand: function () { log("expand"); },
    close: function () { log("close()"); alert("Здесь Telegram закрыл бы приложение"); },
    setHeaderColor: function () {},
    setBackgroundColor: function () {},
    onEvent: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    offEvent: function (name, fn) { handlers[name] = (handlers[name] || []).filter(function (f) { return f !== fn; }); },
    BackButton: {
      isVisible: false,
      _cb: null,
      show: function () { this.isVisible = true; log("BackButton.show"); },
      hide: function () { this.isVisible = false; log("BackButton.hide"); },
      onClick: function (fn) { this._cb = fn; },
      offClick: function () { this._cb = null; },
    },
    HapticFeedback: {
      selectionChanged: function () {},
      impactOccurred: function () {},
      notificationOccurred: function (t) { log("haptic", t); },
    },
    requestContact: function (cb) {
      var ok = confirm("[dev] Поделиться номером +7 900 000-00-00 с ботом?");
      var data;
      if (ok) {
        var contact = { phone_number: "+79000000000", first_name: user.first_name, last_name: user.last_name, user_id: user.id };
        var authDate = Math.floor(Date.now() / 1000);
        data = {
          status: "sent",
          response: "contact=" + encodeURIComponent(JSON.stringify(contact)) + "&auth_date=" + authDate + "&hash=dev-fake-hash",
          responseUnsafe: { contact: contact, auth_date: authDate, hash: "dev-fake-hash" },
        };
      } else {
        data = { status: "cancelled" };
      }
      setTimeout(function () {
        if (cb) cb(ok, data);
        (handlers.contactRequested || []).forEach(function (f) { f(data); });
      }, 200);
    },
    requestWriteAccess: function (cb) {
      var ok = confirm("[dev] Разрешить боту писать вам?");
      setTimeout(function () { if (cb) cb(ok); }, 100);
    },
    openTelegramLink: function (url) { log("openTelegramLink", url); window.open(url, "_blank"); },
    openLink: function (url) { window.open(url, "_blank"); },
  };
  log("Telegram.WebApp подменён заглушкой. user:", user);
})();
