/* =====================================================================
   Квиз «Прайм тур» — ВЕСЬ контент здесь.
   Тексты, варианты, картинки, вилки бюджета, города вылета.
   Менять можно смело: движок (app.js) читает только эту структуру.

   Картинки: поле image — имя файла без расширения в папке img/.
   Движок сначала ищет img/<name>.webp, если нет — img/<name>.svg (заглушка).
   ===================================================================== */
window.QUIZ_CONFIG = {
  version: "2026-08-26b",

  // Куда уходят ответы: URL веб-приложения Google Apps Script (кончается на /exec).
  backendUrl: "https://script.google.com/macros/s/AKfycbzjILOl0xIL4UuB_0lKLAeTKPnsvcIwKHRI3DPc54IywS50KsMqTVhcaSGLqul00I0o/exec",

  brand: {
    name: "Прайм тур",
    phone: "+7 906 823-04-74",
    phoneHref: "tel:+79068230474",
    channelUrl: "https://t.me/primetour",
  },

  consent: {
    version: "v1-2026-08-20", // менять при изменении текста согласия
    /* Адрес именно /pod — так политика лежит в Joomla. Проверено 26.08.2026:
       /privacy отдаёт главную страницу, то есть галочка согласия вела в никуда. */
    policyUrl: "https://primetour.pro/pod",
    pdText: "Согласен(а) на обработку персональных данных",
    policyLinkText: "политика",
    marketingText: "Хочу получать подборки и акции «Прайм тур»",
  },

  /* ---------- Экраны ---------- */
  intro: {
    image: "hero",
    title: "Подберём отдых за минуту",
    subtitle: "7 коротких вопросов — и менеджер «Прайм тур» вернётся не с уточнениями, а с вариантами.",
    button: "Поехали",
  },

  steps: [
    {
      id: "destination",
      type: "cards",
      title: "Куда хочется?",
      subtitle: "Одно направление. Не определились — поможем.",
      options: [
        { id: "turkey", label: "Турция", hint: "Всё включено и море", image: "dest-turkey" },
        { id: "egypt", label: "Египет", hint: "Красное море круглый год", image: "dest-egypt" },
        { id: "thailand", label: "Таиланд", hint: "Экзотика и улыбки", image: "dest-thailand" },
        { id: "vietnam", label: "Вьетнам", hint: "Бухты и уличная еда", image: "dest-vietnam" },
        { id: "maldives", label: "Мальдивы", hint: "Острова и тишина", image: "dest-maldives" },
        { id: "uae", label: "ОАЭ", hint: "Город будущего и пляжи", image: "dest-uae" },
        { id: "china", label: "Китай", hint: "Другая планета", image: "dest-china" },
        { id: "southafrica", label: "ЮАР", hint: "Сафари и океан", image: "dest-southafrica" },
        { id: "any", label: "Помогите выбрать", hint: "Подскажем под ваш запрос", image: "dest-any" },
      ],
    },
    {
      id: "vibe",
      type: "chips",
      multi: true,
      showIf: { destination: "any" }, // только если направление не выбрано
      title: "Какой отдых вам ближе?",
      subtitle: "Можно несколько.",
      options: [
        { id: "sea", label: "Море и лень", emoji: "🌊" },
        { id: "excursions", label: "Экскурсии и города", emoji: "🏛" },
        { id: "exotic", label: "Экзотика", emoji: "🌴" },
        { id: "family", label: "С детьми спокойно", emoji: "🧸" },
        { id: "nature", label: "Горы и природа", emoji: "⛰" },
        { id: "luxury", label: "Красиво и премиально", emoji: "✨" },
      ],
    },
    {
      id: "when",
      type: "when",
      title: "Когда планируете?",
      subtitle: "Примерно — точные даты обсудим.",
      monthsAhead: 12,
      unknownLabel: "Пока не знаю",
      nightsTitle: "На сколько ночей?",
      nights: [
        { id: "7", label: "7" },
        { id: "10", label: "10" },
        { id: "14", label: "14+" },
        { id: "any", label: "Не решили" },
      ],
    },
    {
      id: "who",
      type: "who",
      title: "Кто едет?",
      subtitle: "Состав влияет на отель и перелёт.",
      adultsLabel: "Взрослые",
      childrenLabel: "Дети до 18",
      maxAdults: 8,
      maxChildren: 5,
      agesTitle: "Возраст детей",
      ages: [
        { id: "0-2", label: "до 2" },
        { id: "3-6", label: "3–6" },
        { id: "7-12", label: "7–12" },
        { id: "13-17", label: "13–17" },
      ],
    },
    {
      id: "budget",
      type: "list",
      title: "Какой бюджет закладываете?",
      subtitle: "На всех, за всю поездку: перелёт и отель. Примерно — чтобы сразу предлагать подходящее.",
      options: [
        { id: "b150", label: "до 150 тыс. ₽", uonBudget: 150000 },
        { id: "b300", label: "150–300 тыс. ₽", uonBudget: 300000 },
        { id: "b500", label: "300–500 тыс. ₽", uonBudget: 500000 },
        { id: "b1000", label: "500 тыс. – 1 млн ₽", uonBudget: 1000000 },
        { id: "b1000plus", label: "от 1 млн ₽", uonBudget: 1500000 },
        { id: "unknown", label: "Пока не знаю, подскажите", uonBudget: 0 },
      ],
      // Своя шкала под направление (необязательно). Ключ — id направления.
      // Раскомментировать и поправить суммы:
      // byDestination: {
      //   maldives: [
      //     { id: "b300", label: "до 300 тыс. ₽", uonBudget: 300000 },
      //     { id: "b500", label: "300–500 тыс. ₽", uonBudget: 500000 },
      //     { id: "b1000", label: "500 тыс. – 1 млн ₽", uonBudget: 1000000 },
      //     { id: "b1000plus", label: "от 1 млн ₽", uonBudget: 1500000 },
      //     { id: "unknown", label: "Пока не знаю, подскажите", uonBudget: 0 },
      //   ],
      // },
    },
    {
      id: "priorities",
      type: "chips",
      multi: true,
      title: "Что важно в поездке?",
      subtitle: "Отметьте всё, что откликается.",
      options: [
        { id: "ai", label: "Всё включено", emoji: "🍽" },
        { id: "quiet", label: "Тихий отель без толп", emoji: "🌿" },
        { id: "kids", label: "Детский клуб и анимация", emoji: "🎈" },
        { id: "spa", label: "Спа и wellness", emoji: "💆" },
        { id: "excursions", label: "Экскурсии", emoji: "🗺" },
        { id: "beach", label: "Первая линия", emoji: "🏖" },
        { id: "direct", label: "Прямой перелёт", emoji: "✈️" },
        { id: "villa", label: "Вилла или большой номер", emoji: "🏡" },
      ],
    },
    {
      id: "logistics",
      type: "groups",
      title: "Откуда летим и когда решаете?",
      groups: [
        {
          id: "city",
          title: "Город вылета",
          otherId: "other", // у этого варианта появится поле ввода
          otherPlaceholder: "Какой город?",
          options: [
            { id: "moscow", label: "Москва" },
            { id: "spb", label: "Санкт-Петербург" },
            { id: "novosibirsk", label: "Новосибирск" },
            { id: "sochi", label: "Сочи" },
            { id: "other", label: "Другой" },
          ],
        },
        {
          id: "decision",
          title: "Когда планируете определиться?",
          options: [
            { id: "week", label: "На этой неделе" },
            { id: "month", label: "В этом месяце" },
            { id: "later", label: "Пока присматриваюсь" },
          ],
        },
      ],
    },
  ],

  contact: {
    title: "Куда прислать варианты?",
    subtitle: "Менеджер напишет в Telegram или позвонит — как удобнее.",
    nameLabel: "Как к вам обращаться",
    namePlaceholder: "Имя",
    phoneLabel: "Телефон",
    shareButton: "Поделиться номером из Telegram",
    manualLink: "или ввести вручную",
    phonePlaceholder: "+7 900 000-00-00",
    phoneShared: "Номер получен из Telegram",
    changePhone: "изменить",
    commentLabel: "Комментарий",
    commentPlaceholder: "Даты, пожелания, особые запросы — всё, что поможет подобрать точнее",
    submit: "Отправить заявку",
    sending: "Отправляем…",
    errors: {
      name: "Подскажите, как к вам обращаться",
      phone: "Нужен телефон — иначе менеджер не сможет связаться",
      consent: "Без согласия на обработку данных заявку отправить нельзя",
      network: "Не получилось отправить. Проверьте интернет и попробуйте ещё раз.",
      server: "Что-то пошло не так на нашей стороне. Напишите нам напрямую: ",
    },
  },

  done: {
    image: "done",
    title: "Спасибо, {name}!",
    text: "Заявка у менеджеров «Прайм тур». У нас точно есть идеи, как спланировать ваше путешествие — менеджер напишет вам в Telegram или позвонит в ближайшее рабочее время.",
    duplicateText: "Вашу заявку мы уже получили раньше. Менеджер свяжется в ближайшее рабочее время.",
    closeButton: "Закрыть",
    channelButton: "В канал «Прайм тур»",
  },

  ui: {
    next: "Дальше",
    back: "Назад",
    stepOf: "{n} из {total}",
    months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  },
};
