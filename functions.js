// import { format } from "date-fns";
const format = require("date-fns/format");

const sendErrorMessage = (ctx, message, extras = {}) => {
    ctx.replyWithHTML(message, extras).then((msg) =>
        setTimeout(() => ctx.deleteMessage(msg.message_id), 5000)
    );
    // ctx.answerCbQuery();
};

const sendAutoDeleteMessage = (ctx, message, delay) => {
    // Plain text only
    ctx.replyWithHTML(message).then((msg) =>
        setTimeout(() => ctx.deleteMessage(msg.message_id), delay)
    );
};

const formatDate = (date) => {
    //date: yyyy-MM-dd

    return format(new Date(date), "EEE dd MMM yyyy");
};

const formatDateShort = (date) => {
    return format(new Date(date), "d MMM");
};

const editErrorHandler = (e, ctx) => {
    console.log(e);
    if (e.response.error_code === 429) {
        // too many requests, timeout and try again
        let retryTime = (e.response.parameters.retry_after + 1) * 1000;

        setTimeout(() => {
            ctx.telegram.editMessageText(
                e.on.payload.chat_id,
                e.on.payload.message_id,
                e.on.payload.inline_message_id,
                e.on.payload.text,
                {
                    parse_mode: e.on.payload.parse_mode,
                    disable_web_page_preview:
                        e.on.payload.disable_web_page_preview,
                    reply_markup: e.on.payload.reply_markup,
                }
            );
        }, retryTime);
    }
};

const keyFilterByProperty = (object, comparison) => {
    // comparison: number[]
    return Object.keys(object).filter((key) =>
        comparison.includes(object[key])
    );
};

const advancedMarkupGenerator = (userId, groupId, groups) => {
    /*
        [Date]          | [ Day] | [Available Night] | [Custom]
        [29 April 2022] | [☑]    | [❌]             | [Custom]

    */

    const advancedMarkup = [
        [
            {
                text: "🙁 I can't make it",
                callback_data: "cmi",
            },
        ],
        [
            { text: "Date", callback_data: "adv_ignore_date" },
            { text: "Day ☀️", callback_data: "adv_ignore_day" },
            { text: "Night 🌑", callback_data: "adv_ignore_night" },
            { text: "Custom 🔧", callback_data: "adv_ignore_custom" },
        ],
    ];

    // if (!groups[groupId].scheduleByMember[userId]) return false
    let dates = Object.keys(
        groups[groupId].scheduleByMember[userId] || []
    ).sort((a, b) => new Date(a) - new Date(b));

    dates.forEach((date) => {
        // for each date, push one row to the markup
        let availablilityType = groups[groupId].scheduleByMember[userId][date];
        advancedMarkup.push([
            {
                text: formatDateShort(date),
                callback_data: `adv_ignore_${date}`,
            },
            {
                text:
                    availablilityType === 1 || availablilityType === 2
                        ? "✅"
                        : "❌",
                callback_data: `adv_day_${date}_${userId}`,
            },
            {
                text:
                    availablilityType === 1 || availablilityType === 3
                        ? "✅"
                        : "❌",
                callback_data: `adv_night_${date}_${userId}`,
            },
            {
                text: typeof availablilityType === "string" ? "✅" : "❌",
                callback_data: `adv_custom_${date}_${userId}`,
            },
        ]);
    });

    return advancedMarkup;
};

const formatCalendarWithSelectedDates = (inline_keyboard, dates) => {
    // Currently bugged, not in use
    // bug: when the calendar switches months, this function is not called again. Hence the new month display will not be annotated.

    // dates is an array of dates in yyyy-MM-dd format
    // inline_keyboard is the result of rangeCalendar.getCalendar()

    // deep copy 
    let inline_keyboard_copied = JSON.parse(JSON.stringify(inline_keyboard));
   

    for (let row of inline_keyboard_copied) {
        for (let button of row) { 
            let buttonDate = button.callback_data.split("-")
            buttonDate.splice(0, 3)
            let newDate = buttonDate.join("-")

            if (dates.includes(newDate) && !button.text.includes('《')) {
                button.text = `《 ${button.text} 》`
            }
        }
    }

    console.log(inline_keyboard_copied)
    return inline_keyboard_copied;

};

module.exports = {
    sendErrorMessage,
    formatDate,
    editErrorHandler,
    keyFilterByProperty,
    advancedMarkupGenerator,
    sendAutoDeleteMessage,
    formatCalendarWithSelectedDates
};
