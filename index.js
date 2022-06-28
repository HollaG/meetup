const { subDays, differenceInDays, isSameDay } = require("date-fns");
const { Telegraf } = require("telegraf");
const Calendar = require("telegraf-calendar-telegram");
const {
    sendErrorMessage,
    formatDate,
    editErrorHandler,
    keyFilterByProperty,
} = require("./functions");

require('dotenv').config();
const bot = new Telegraf(process.env.BOT_TOKEN);
const dates = {};
const messageIdsForDeletion = {};

const groups = {};
// availablility status
// 0 / not present: Unavailable
// 1: Available (full day)
// 2: Available (morning/afternoon)
// 3: Available (evening/night)

const availabilityMap = ["(Unavailable)", "", "(Day)", "(Night)"];

const DEFAULT_USER_OBJECT = {
    dates: {},
    messageIdsForDeletion: [],
    stage: 0,
    info_message: null,
    scheduleByDate: {
        // userId: {
        //     date: 1,
        // },
        date: {
            userId: 1,
        },
    },
    scheduleByMember: {
        userId: {
            date: 1,
        },
    },
    creator: {
        userId: 0,
        username: 0,
    },
};

const memberNameMap = {};
// {
//     "memberId": "memberName"
// }

const groupNameMap = {};
// {
//     "groupId": "groupName"
// }

const memberToGroupMap = {};
// {
//     "memberId": "groupId"
// }

let memberTimeout = {};
// {
//     "memberId": setTimeout()
// }

const rangeCalendar = new Calendar(bot, {
    minDate: new Date(),
});

const pmExplainerText = `\n\nPlease click on the dates on which you are available. \nIf you are only available in the <b>day</b>, click <b>once (1)</b> more.\nIf you are only available in the <b>night</b>, click <b>twice (2)</b> more instead.\nTo reset, click the date <b>three (3)</b> times.\n\nUpdates will take ~1 second to be reflected - this is to prevent spam.\n\n<b><u>Available dates</u></b>\n`;

rangeCalendar.setDateListener(async (ctx, date) => {
    // handle calendar in groups
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {

        if (!groups[ctx.chat.id]) return sendErrorMessage(ctx, "Sorry, there was an unexpected error. Have you started the bot with /start?")

        // check if the person who clicked is the person who started the calendar
        if (ctx.from.id !== groups[ctx.chat.id].creator.userId)
            return sendErrorMessage(
                ctx,
                `Sorry, only the calendar creator can perform this action.`
            );

        if (!groups[ctx.chat.id].dates.start) {
            groups[ctx.chat.id].dates.start = date;
            ctx.replyWithHTML(
                `You selected <u><b>${formatDate(
                    date
                )}</b></u> as the start date.\nPlease select the end date now.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "Reset",
                                    callback_data: "rst",
                                },
                            ],
                        ],
                    },
                }
            ).then((message) =>
                groups[ctx.chat.id].messageIdsForDeletion.push(
                    message.message_id
                )
            );
        } else {
            // if selected end date is before the start date, then swap them
            if (new Date(groups[ctx.chat.id].dates.start) > new Date(date)) {
                ctx.replyWithHTML(
                    `End date <u><b>(${formatDate(
                        date
                    )})</b></u> cannot be earlier than the start date (${
                        groups[ctx.chat.id].dates.start
                    })!`
                ).then((message) =>
                    groups[ctx.chat.id].messageIdsForDeletion.push(
                        message.message_id
                    )
                );
            } else {
                groups[ctx.chat.id].dates.end = date;
                ctx.replyWithHTML(
                    `You selected <b><u>${formatDate(
                        date
                    )}</u></b> as the end date.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: "Reset",
                                        callback_data: "rst",
                                    },

                                    {
                                        text: "Confirm",
                                        callback_data: "cfm",
                                    },
                                ],
                            ],
                        },
                    }
                ).then((message) =>
                    groups[ctx.chat.id].messageIdsForDeletion.push(
                        message.message_id
                    )
                );
            }
        }
    } else {
        // Calendar in private chat (users are picking the dates where they're available / not)
        // how to determine what group the user is linked to?

        const user = ctx.chat;
        const userId = user.id;
        const linkedGroupId = memberToGroupMap[userId];

        memberNameMap[userId] = {
            name: user.first_name,
            username: user.username,
        };

        if (!linkedGroupId)
            return sendErrorMessage(
                ctx,
                "Please press the start button at the bottom of your screen first!"
            );
        const linkedGroupName = groupNameMap[linkedGroupId];

        const { start, end } = groups[linkedGroupId].dates;

        if (new Date(date) < new Date(start) || new Date(date) > new Date(end))
            return sendErrorMessage(
                ctx,
                `Error: Date is out of range! Please use the latest calendar to choose your dates.`
            );

        if (!groups[linkedGroupId].scheduleByDate[date])
            // if user hasn't typed anything yet, add it here
            groups[linkedGroupId].scheduleByDate[date] = {};
        if (!groups[linkedGroupId].scheduleByMember[userId])
            groups[linkedGroupId].scheduleByMember[userId] = {};

        if (!groups[linkedGroupId].scheduleByDate[date][userId]) {
            // user is now free on this date
            groups[linkedGroupId].scheduleByDate[date][userId] = 1;
            groups[linkedGroupId].scheduleByMember[userId][date] = 1;
        } else {
            if (groups[linkedGroupId].scheduleByDate[date][userId] === 3) {
                delete groups[linkedGroupId].scheduleByDate[date][userId];
                delete groups[linkedGroupId].scheduleByMember[userId][date];
            } else {
                groups[linkedGroupId].scheduleByDate[date][userId]++;
                groups[linkedGroupId].scheduleByMember[userId][date]++;
            }
        }

        let message = `<i>Indicating dates for <b><u>${
            groupNameMap[linkedGroupId]
        }</u></b></i>\n\nHello! @${
            groups[linkedGroupId].creator.username
        } requests that you indicate your available dates from <b><u>${formatDate(
            start
        )}</u></b> to <b><u>${formatDate(end)}</u></b>.${pmExplainerText}`;
        for (let date of Object.keys(
            groups[linkedGroupId].scheduleByMember[userId]
        ).sort((a, b) => new Date(a) - new Date(b))) {
            message += `${formatDate(date)} ${
                availabilityMap[
                    groups[linkedGroupId].scheduleByMember[userId][date]
                ]
            }\n`;
        }

        // message += selectedDatesGenerator(
        //     Object.keys(groups[linkedGroupId].scheduleByMember[userId])
        // );

        const totalMembers = await ctx.getChatMembersCount();

        clearTimeout(memberTimeout[userId]);
        memberTimeout[userId] = setTimeout(() => {
            // after 1 seconds, update the messages
            console.log("Updating messages...");
            memberTimeout[userId] = null;

            // edit message in DM - let the user know their availability
            ctx.editMessageText(message, {
                reply_markup: ctx.update.callback_query.message.reply_markup,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }).catch(editErrorHandler);

            // edit message in group - let everyone know
            let updatedMessage =
                `Gathering availability information for\n<b><u>${formatDate(
                    start
                )}</u></b> to <b><u>${formatDate(
                    end
                )}</u></b>.\n\nMembers, please indicate your available dates by clicking on the button below.\n\n@${
                    groups[linkedGroupId].creator.username
                }: Type /stop when you are done collecting info.\n\n` +
                listOfPeopleFormatGenerator(
                    groups[linkedGroupId].scheduleByDate,
                    memberNameMap,
                    totalMembers
                ) +
                `👥 Responses: ${
                    Object.keys(groups[linkedGroupId].scheduleByMember).length
                }/${totalMembers}`;
            ctx.telegram
                .editMessageText(
                    groups[linkedGroupId].info_message.chat.id,
                    groups[linkedGroupId].info_message.message_id,

                    null,
                    updatedMessage,

                    {
                        reply_markup:
                            groups[linkedGroupId].info_message.reply_markup,
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                    }
                )
                .catch(editErrorHandler);
        }, 1000);
    }

    return;
});

bot.start(async (ctx) => {
    const chat = ctx.chat;
    const message = ctx.update.message;
    if (chat.type === "private") {
        const linkedGroupId = ctx.startPayload;

        if (!linkedGroupId) {
            ctx.reply("Add this bot to a group to start scheduling!", {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Choose a group",
                                url: `https://t.me/meetup_plannerbot?startgroup=_`,
                            },
                        ],
                    ],
                },
            });
            return;
        }

        if (memberToGroupMap[ctx.chat.id] === linkedGroupId) {
            // user already did /start, get them to reuse the old calendar
        }

        memberToGroupMap[ctx.chat.id] = linkedGroupId;

        const group = groups[linkedGroupId];
        const { start, end } = group.dates;
        if (!group) return console.log("error");

        rangeCalendar.setMinDate(new Date(start));
        rangeCalendar.setMaxDate(new Date(end));

        // for future - when adding refresh button when ability to change date range is implemented
        // const calendarMarkup = rangeCalendar.getCalendar().reply_markup.inline_keyboard
        // const finalMarkup = [[{
        //     text: "Refresh",
        //     callback_data: "refresh",
        // }], ...calendarMarkup]

        ctx.replyWithHTML(
            `<i>Indicating dates for <b><u>${
                groupNameMap[linkedGroupId]
            }</u></b></i>\n\nHello! @${
                group.creator.username
            } requests that you indicate your available dates from <b><u>${formatDate(
                start
            )}</u></b> to <b><u>${formatDate(end)}</u></b>.${pmExplainerText}`,

            rangeCalendar.getCalendar()
        );
    } else if (chat.type === "group" || chat.type === "supergroup") {
        // Check if there already is a running calendar in the group
        if (groups[chat.id]) {
            const msg = await ctx.reply(
                `There is already a calendar running in this group. Please use /stop to stop it before trying again.`
            );
            setTimeout(() => {
                ctx.deleteMessage(msg.message_id);
                // Bot can't delete ppl's messages without permission
                // ctx.deleteMessage(message.message_id)
            }, 5000);
            return;
        }

        rangeCalendar.setMinDate(new Date());
        rangeCalendar.setMaxDate(undefined);
        groups[ctx.chat.id] = {
            dates: {},
            messageIdsForDeletion: [],
            stage: 0,
            scheduleByDate: {},
            scheduleByMember: {},
            info_message: null,
            creator: { userId: ctx.from.id, username: ctx.from.username },
        };

        groupNameMap[chat.id] = chat.title;

        const msg = await ctx.replyWithHTML(
            `
                Hello, ${ctx.from.first_name}!\nPlease choose the date range you want to gather data for by clicking on the <b>start date</b>, and then the <b>end date</b>.\n\nType /stop to cancel.
        `,
            rangeCalendar.getCalendar()
        );
        groups[ctx.chat.id].messageIdsForDeletion.push(msg.message_id);
    }
});

bot.command("stop", async (ctx) => {
    // stop can only run in a group and only the group owner can stop the calendar (todo)
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        const groupId = ctx.chat.id;

        // check if this group has an active runnin calendar
        if (groups[groupId]) {
            // yes, stop it

            // check if the sender has perms
            const senderId = ctx.from.id;
            if (senderId === groups[groupId].creator.userId) {
                // yes, stop it
                // delete the calendar
                // ctx.telegram.editMessageText(groupId, groups[groupId].info_message.message_id, undefined, "Calendar stopped, todo - add the ");

                let text = "Calendar stopped. Thank you for using!\n\n";
                let totalMembers = await ctx.getChatMembersCount();

                if (groups[groupId].dates.start && groups[groupId].dates.end) {
                    // user cancelled after choosing start and end
                    let addText =
                        `<b><u>${formatDate(
                            groups[groupId].dates.start
                        )}</u></b> to <b><u>${formatDate(
                            groups[groupId].dates.end
                        )}</u></b>\n\n` +
                        listOfPeopleFormatGenerator(
                            groups[groupId].scheduleByDate,
                            memberNameMap,
                            totalMembers
                        );
                    text += addText;
                }
                const finalMsg = await ctx.replyWithHTML(text, { disable_web_page_preview: true });              
                ctx.telegram.editMessageText(ctx.chat.id, groups[groupId].info_message.message_id, null, `Availability gathering has stopped. Please refer to the latest message by the bot!`, {
                    parse_mode: "HTML"
                })
                delete groups[groupId];
            } else {
                ctx.reply(
                    `Sorry, only the calendar creator can stop this calendar.`
                );
            }
        } else {
            // no
            ctx.reply(
                `There is no calendar running in this group! Type /start to start one.`
            );
        }
    }
});

bot.on("callback_query", (ctx) => {
    // ctx.reply(`You chose ${ctx.update.callback_query.data}`);

    switch (ctx.update.callback_query.data) {
        case "rst": {
            resetRange(ctx);
            break;
        }
        case "cfm": {
            launchWaitingForOthers(ctx);
            break;
        }
    }
});

const resetRange = async (ctx) => {
    // groups[ctx.chat.id].messageIdsForDeletion.forEach((msgId) => {
    //     try {
    //         ctx.deleteMessage(msgId).catch(console.log);
    //     } catch (e) {
    //         console.log(e);
    //     }
    // });
    groups[ctx.chat.id] = {
        ...groups[ctx.chat.id],
        dates: {},
    };
    await ctx
        .reply(
            `Dates have been reset. Please select the start date.`
            // rangeCalendar.getCalendar()
        )
        .then((message) => {
            groups[ctx.chat.id].messageIdsForDeletion.push(message.message_id);
        });
};

const launchWaitingForOthers = async (ctx) => {
    if (!groups[ctx.chat.id]?.dates.start || !groups[ctx.chat.id]?.dates.end) {
        sendErrorMessage(ctx, `Error: Missing start and end dates!`);
        return;
    }

    // delete old messages
    groups[ctx.chat.id].messageIdsForDeletion.forEach((msgId) => {
        try {
            ctx.deleteMessage(msgId).catch(console.log);
            groups[ctx.chat.id].messageIdsForDeletion = [];
        } catch (e) {
            console.log(e);
        }
    });

    const { start, end } = groups[ctx.chat.id].dates;

    // send message to group which will contain the people info
    const msg = await ctx.replyWithHTML(
        `Gathering availability information for\n<b><u>${formatDate(
            start
        )}</u></b> to <b><u>${formatDate(
            end
        )}</u></b>.\n\nMembers, please indicate your available dates in this range by clicking on the button below.\n\n@${
            groups[ctx.chat.id].creator.username
        }: Type /stop when you are done collecting info.\n\n`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "Indicate availability",
                            url: `https://t.me/meetup_plannerbot?start=${ctx.chat.id}`,
                        },
                    ],
                ],
            },
        }
    );

    groups[ctx.chat.id].info_message = msg;
};

// unused for now
const selectedDatesGenerator = (dates) => {
    // dates: "yyyy-MM-dd"[] (unsorted)
    const sortedDates = dates
        .sort((a, b) => new Date(a) - new Date(b))
        .map((date) => new Date(date));

    // for each date, check if the index n+1 is the next day
    let tempGroup = [null, null, null]; // [start, temp, end]
    let groups = [];
    for (let i = 0; i < sortedDates.length; i++) {
        let curDate = sortedDates[i];
        if (!tempGroup[0]) {
            tempGroup[0] = curDate;
            tempGroup[1] = curDate;
            continue;
        }

        let prevDate = sortedDates[i - 1];
        if (differenceInDays(curDate, tempGroup[1]) === 1) {
            // this is the next day
            tempGroup[1] = curDate;
        } else {
            // this is the first day of a new group
            groups.push({ start: tempGroup[0], end: tempGroup[1] });

            tempGroup = [curDate, curDate, null];
        }

        if (i === sortedDates.length - 1) {
            // last date
            tempGroup[1] = curDate;
            groups.push({ start: tempGroup[0], end: tempGroup[1] });
        }
    }

    console.log({ groups });
    let text = "";
    for (let group of groups) {
        if (isSameDay(group.start, group.end)) {
            // start and end same day
            text += `${formatDate(group.start)}\n`;
        } else {
            // start and end different days
            text += `${formatDate(group.start)} - ${formatDate(group.end)}\n`;
        }
    }

    return text;
};

const listOfPeopleFormatGenerator = (
    scheduleByDate,
    memberNameMap,
    totalMembers
) => {
    let listOfPeople = "<b><u>Availability list</u></b>\n";
    for (let date of Object.keys(scheduleByDate).sort(
        (a, b) => new Date(a) - new Date(b)
    )) {
        let numberOfAttendeesOnThisDate = Object.keys(
            scheduleByDate[date]
        ).length;
        // skip empty days
        if (numberOfAttendeesOnThisDate > 0) {
            let text = `<b>${formatDate(date)}</b> `;

            let numberAttending = keyFilterByProperty(scheduleByDate[date], [1]).length // returns array of ids where the person is attending the whole
            let numberAttendingDay = keyFilterByProperty(scheduleByDate[date], [1, 2]).length // returns ids of persons attending either whole or day
            let numberAttendingNight = keyFilterByProperty(scheduleByDate[date], [1, 3]).length // returns ids of persons attending either whole or night
            
            let percentAttending = Math.floor(
                (numberAttending / totalMembers) * 100
            );
            let percentAttendingDay = Math.floor(
                (numberAttendingDay / totalMembers) * 100
            );

            let percentAttendingNight = Math.floor(
                (numberAttendingNight / totalMembers) * 100
            );

            // take the highest of the 3
            let finalPercent = Math.max(percentAttendingDay, percentAttendingNight, percentAttending);

            if (finalPercent === 100) text += "😄";
            else if (finalPercent >= 75) text += "😀";
            else if (finalPercent >= 50) text += "🙂";

            text += "\n";

            for (let userId in scheduleByDate[date]) {
                text += `<a href='t.me/${memberNameMap[userId].username}'>${
                    memberNameMap[userId].name
                }</a> ${availabilityMap[scheduleByDate[date][userId]]}\n`;
            }
            listOfPeople += text;
            listOfPeople += `\n`;
        }
    }
    return listOfPeople;
    // for (let member in scheduleByDate) {
    //     listOfPeople += `${memberNameMap[member]} is available on ${Object.keys(scheduleByDate[member])}`
    //     listOfPeople += "\n"
    // }
    // return listOfPeople
};

bot.launch().then(() => console.log("Bot is running!"));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))