const { subDays, differenceInDays, isSameDay } = require("date-fns");
const { Telegraf } = require("telegraf");
const Calendar = require("telegraf-calendar-telegram");
const {
    sendErrorMessage,
    formatDate,
    editErrorHandler,
    keyFilterByProperty,
    advancedMarkupGenerator,
    sendAutoDeleteMessage,
} = require("./functions");

require("dotenv").config();

const sanitizeHtml = require("sanitize-html");
const sanitizeOptions = {
    allowedTags: [],
    allowedAttributes: {},
};

const bot = new Telegraf(process.env.BOT_TOKEN);
const dates = {};
const messageIdsForDeletion = {};

const groups = {};
// availablility status
// 0 / not present: Unavailable
// 1: Available (full day)
// 2: Available (morning/afternoon)
// 3: Available (evening/night)

const availabilityArrayMap = ["(Unavailable)", "", "(Day)", "(Night)"];
const availabilityMap = (availablilityType) => {
    // availabilityType can be 0, 1, 2, 3, or string (when custom reason)
    if (typeof availablilityType === "string") {
        return `(${availablilityType})`;
    } else {
        return availabilityArrayMap[availablilityType];
    }
};

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

let memberActionableMessages = {};
// {
//     "memberId": {
//         "select_dates": "message",
//         "advanced": "message",
//         "custom_prompt": "message"
//     }
// }

let memberInputCustomMessage = {};
// {
//     "memberId": {
//         "date": "yyyy-MM-yy",
//         "messageId": ""
//     }
// }

const memberMessageIDsToEditAfterStop = {};
// {
//     "memberId": ["messageId"]
// }

const rangeCalendar = new Calendar(bot, {
    minDate: new Date(),
});

const selectDatesExplainerText = `\n\nPlease click on the dates on which you are available.\nTo reset, click the date again.\n\nℹ Updates will take ~1 second to be reflected - this is to prevent spam.\n\n<b><u>Available dates</u></b>\n`;
const advancedExplainerText = `<i><b><u>⚙️ Advanced options for dates ⚙️</u></b></i>\n\nℹ At least one date must be selected above!\n\n🕐 Click on the specific time for each date to <b><u>toggle your available state</u></b>.\nIf you are available for the whole day, do not click on any button.\n\n🔧 To specify a custom message, click on the <b>《 Custom 🔧 》</b> button, then enter your message.`;

rangeCalendar.setDateListener((ctx, date) => {
    // handle calendar in groups
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        if (!groups[ctx.chat.id])
            return sendErrorMessage(
                ctx,
                "❗️ Error: Have you started the bot with /start?"
            );

        // check if the person who clicked is the person who started the calendar
        if (ctx.from.id !== groups[ctx.chat.id].creator.userId)
            return sendErrorMessage(
                ctx,
                `Sorry, only the calendar creator can perform this action.`
            );

        if (!groups[ctx.chat.id].dates.start) {
            groups[ctx.chat.id].dates.start = date;
            ctx.replyWithHTML(
                `✅ You selected <u><b>${formatDate(
                    date
                )}</b></u> as the start date.\nPlease select the end date now.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "Reset 🔁",
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
                    `✅ You selected <b><u>${formatDate(
                        date
                    )}</u></b> as the end date.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: "Reset 🔁",
                                        callback_data: "rst",
                                    },

                                    {
                                        text: "Confirm ✅",
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

        if (!groups[linkedGroupId]) {
            return sendErrorMessage(
                ctx,
                "❗️ Error: No running calendar found!\n\nCheck if the calendar in the group has been stopped."
            );
        }
        const { start, end } = groups[linkedGroupId].dates;

        if (new Date(date) < new Date(start) || new Date(date) > new Date(end))
            return sendErrorMessage(
                ctx,
                `❗️ Error: Date is out of range! Please use the latest calendar to choose your dates.`
            );

        // Clicking on the calendar toggles the user between 'free' and 'not free'.
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
            delete groups[linkedGroupId].scheduleByDate[date][userId];
            delete groups[linkedGroupId].scheduleByMember[userId][date];

            // if (groups[linkedGroupId].scheduleByDate[date][userId] === 3) {
            //     delete groups[linkedGroupId].scheduleByDate[date][userId];
            //     delete groups[linkedGroupId].scheduleByMember[userId][date];
            // } else {
            //     groups[linkedGroupId].scheduleByDate[date][userId]++;
            //     groups[linkedGroupId].scheduleByMember[userId][date]++;
            // }
        }

        // const totalMembers = await ctx.getChatMembersCount();

        // Handle response to user
        // if (!memberTimeout[userId]) ctx.replyWithChatAction("typing");
        
        clearTimeout(memberTimeout[userId]);
        memberTimeout[userId] = setTimeout(() => {
            // after 1 seconds, update the messages
            console.log("Updating messages...");

            memberTimeout[userId] = null;

            // edit message in DM - let the user know their availability
            updateDmDateMessage(
                ctx,
                groups,
                linkedGroupId,
                availabilityMap,
                userId
            );

            // edit message in group - let everyone know
            updateGroupMessage(
                ctx,

                groups,
                linkedGroupId,
                memberNameMap
            );

            // update the advanced message
            updateDmAdvancedMessage(
                ctx,
                userId,
                memberActionableMessages,
                linkedGroupId,
                groups
            );
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
            return sendErrorMessage(ctx, `❗️ You have already started the calendar!`)
        }

        memberToGroupMap[ctx.chat.id] = linkedGroupId;
        memberActionableMessages[ctx.chat.id] = {};

        const group = groups[linkedGroupId];
        if (!group) return sendErrorMessage(ctx, `❗️ Error: No running calendar found!\n\nCheck if the calendar in the group has been stopped`)
        const { start, end } = group.dates;

        rangeCalendar.setMinDate(new Date(start));
        rangeCalendar.setMaxDate(new Date(end));

        // const calendarMarkup =
        //     rangeCalendar.getCalendar().reply_markup.inline_keyboard;
        // const finalMarkup = [
        //     [
        //         {
        //             text: "Update advanced options 🔄",
        //             callback_data: "adv",
        //         },
        //     ],
        //     ...calendarMarkup,
        // ];

        const selectDatesMsg = await ctx.replyWithHTML(
            `🗓 <i>Indicating dates for <b><u>${
                groupNameMap[linkedGroupId]
            }</u></b></i> 🗓\n\nHello! @${
                group.creator.username
            } requests that you indicate your available dates from <b><u>${formatDate(
                start
            )}</u></b> to <b><u>${formatDate(
                end
            )}</u></b>.${selectDatesExplainerText}`,

            rangeCalendar.getCalendar()
        );
        memberActionableMessages[ctx.chat.id].select_dates = selectDatesMsg;

        const advancedMsg = await ctx.replyWithHTML(
            `${advancedExplainerText}`
            // {
            //     reply_markup: {
            //         inline_keyboard: [
            //             [
            //                 {
            //                     text: "Update advanced options 🔄",
            //                     callback_data: "adv",
            //                 },
            //             ],
            //         ],
            //     },
            // }
        );
        memberActionableMessages[ctx.chat.id].advanced = advancedMsg;

        // add these two messages to the messagesToEdit
        memberMessageIDsToEditAfterStop[ctx.chat.id] = [
            selectDatesMsg.message_id,
            advancedMsg.message_id,
        ];
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
                Hello, ${ctx.from.first_name}!\nPlease choose the date range you want to gather data for by clicking on 1️⃣ the <b>start date</b>, and then 2️⃣ the <b>end date</b>.\n\n⏹ Type /stop to cancel.
        `,
            rangeCalendar.getCalendar()
        );
        groups[ctx.chat.id].messageIdsForDeletion.push(msg.message_id);
    }
});

bot.command("stop", async (ctx) => {
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
                const finalMsg = await ctx.replyWithHTML(text, {
                    disable_web_page_preview: true,
                });
                ctx.telegram.editMessageText(
                    ctx.chat.id,
                    groups[groupId].info_message.message_id,
                    null,
                    `Availability gathering has stopped. Please refer to the latest message by the bot for the compiled availability list!`,
                    {
                        parse_mode: "HTML",
                    }
                );

                // edit all the messages sent to members
                const memberIDs = Object.keys(groups[groupId].scheduleByMember);
                memberIDs.forEach((memberId) => {
                    if (memberMessageIDsToEditAfterStop[memberId]) {
                        memberMessageIDsToEditAfterStop[memberId].forEach(
                            (messageId) => {
                                ctx.telegram.editMessageText(
                                    memberId,
                                    messageId,
                                    null,
                                    `Availability gathering has stopped. Please refer to the latest message by the bot for the compiled availability list!`,
                                    {
                                        parse_mode: "HTML",
                                    }
                                );
                            }
                        );
                    }
                });

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

bot.command("cancel", async (ctx) => {
    // only run in private
    if (ctx.chat.type === "private") {
        // only run if there is a pending prompt in memberInputCustomMessage
        if (memberInputCustomMessage[ctx.chat.id]) {
            // yes, cancel it
            ctx.telegram.deleteMessage(
                ctx.chat.id,
                memberInputCustomMessage[ctx.chat.id].messageId
            );
            delete memberInputCustomMessage[ctx.chat.id];
            ctx.deleteMessage();
        }
    }
});

bot.on("callback_query", (ctx) => {
    // ctx.reply(`You chose ${ctx.update.callback_query.data}`);
    // console.log("Recieved callback button", ctx.update.callback_query);

    const identifier = ctx.update.callback_query.data;
    if (identifier.startsWith("adv_ignore")) return ctx.answerCbQuery();

    if (identifier.startsWith("adv_")) {
        manageAdvanced(ctx, identifier);
    }

    switch (identifier) {
        case "rst": {
            resetRange(ctx);
            break;
        }
        case "cfm": {
            launchWaitingForOthers(ctx);
            break;
        }
        case "adv": {
            launchAdvanced(ctx);
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
            `🔁 Dates have been reset. Please select the start date.`
            // rangeCalendar.getCalendar()
        )
        .then((message) => {
            groups[ctx.chat.id].messageIdsForDeletion.push(message.message_id);
        });

    ctx.answerCbQuery()
};

const launchWaitingForOthers = async (ctx) => {
    if (!groups[ctx.chat.id]?.dates.start || !groups[ctx.chat.id]?.dates.end) {
        sendErrorMessage(ctx, `❗️ Error: Missing start and end dates!`);
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
        `Gathering availability information for\n🗓 <b><u>${formatDate(
            start
        )}</u></b> to <b><u>${formatDate(
            end
        )}</u></b> 🗓\n\nMembers, please indicate your available dates in this range by clicking on the button below.\n\n⏹ @${
            groups[ctx.chat.id].creator.username
        }: Type /stop when you are done collecting info.\n\n`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "🗓 Indicate availability",
                            url: `https://t.me/meetup_plannerbot?start=${ctx.chat.id}`,
                        },
                    ],
                ],
            },
        }
    );

    groups[ctx.chat.id].info_message = msg;
    ctx.answerCbQuery()
};

const launchAdvanced = (ctx) => {
    // refresh the advanced message
    const userId = ctx.chat.id;
    const groupId = memberToGroupMap[userId];

    if (!groupId) return sendErrorMessage(ctx, `❗️ Error: no linked group!`);

    const advancedMarkup = advancedMarkupGenerator(userId, groupId, groups);

    if (!advancedMarkup)
        return sendErrorMessage(ctx, `Please select a date first!`);

    updateDmAdvancedMessage(
        ctx,
        userId,
        memberActionableMessages,
        groupId,
        groups
    );

    ctx.answerCbQuery()
};

const manageAdvanced = async (ctx, identifier) => {
    let [_, type, date, userId] = identifier.split("_");

    const groupId = memberToGroupMap[userId];

    if (!groupId) return sendErrorMessage(ctx, `❗️ Error: no linked group!`);
    if (!groups[groupId]) {
        return sendErrorMessage(
            ctx,
            `❗️ Error: No running calendar found!\n\nCheck if the calendar in the group has been stopped.`
        );
    }
    let status1 = groups[groupId]?.scheduleByDate?.[date]?.[userId];

    if (!status1) {
        return sendErrorMessage(
            ctx,
            `❗️ Error: Please do not re-use old calendars!`
        );
    }

    // console.log("-----------------------")
    // console.log(groups[groupId])
    // console.log("Type is ", type, status1, status2)

    let finalStatus;
    if (type === "day") {
        // toggle the 'day' status
        // if status was 1 (full), set to 3
        // if status was 2 (day), set to 0
        // if status was 3 (night), set to 1
        // if status was text (custom), set to 2

        if (status1 === 1) {
            finalStatus = 3;
        } else if (status1 === 2) {
            finalStatus = 0;
        } else if (status1 === 3) {
            finalStatus = 1;
        } else {
            finalStatus = 2;
        }
    } else if (type === "night") {
        // toggle the 'night' status
        // if status was 1 (full), set to 2
        // if status was 2 (day), set to 1
        // if status was 3 (night), set to 0
        // if status was text (custom), set to 3

        if (status1 === 1) {
            finalStatus = 2;
        } else if (status1 === 2) {
            finalStatus = 1;
        } else if (status1 === 3) {
            finalStatus = 0;
        } else {
            finalStatus = 3;
        }
    } else if (type === "custom") {
        finalStatus === -1;

        if (memberInputCustomMessage[userId]) {
            // already prompted to, tell them to cancel first

            sendAutoDeleteMessage(
                ctx,
                `Please cancel the current action with /cancel first!.`,
                5000
            );
        } else {
            ctx.replyWithHTML(
                `Please type your custom message for <b><u>${formatDate(
                    date
                )}</u></b> now.\n\nType /cancel to cancel this action.`
            ).then((msg) => {
                memberInputCustomMessage[userId] = {
                    messageId: msg.message_id,
                    date: date,
                };

                // setTimeout(
                //     () => {
                //         if (memberInputCustomMessage[userId]) {
                //             // might've already been deleted by other means (when the user enters their own message)
                //             ctx.deleteMessage(msg.message_id);

                //             if (memberInputCustomMessage[userId].date === date) {
                //                 delete memberInputCustomMessage[userId];
                //             }
                //         }
                //     },
                //     30000,
                //     date,
                //     msg
                // );
            });
        }
        ctx.answerCbQuery()
        return;
    }

    // if user ends up not attending, delete
    if (finalStatus === 0) {
        delete groups[groupId].scheduleByDate[date][userId];
        delete groups[groupId].scheduleByMember[userId][date];
    } else if (finalStatus !== -1) {
        groups[groupId].scheduleByDate[date][userId] = finalStatus;
        groups[groupId].scheduleByMember[userId][date] = finalStatus;
    }

    ctx.answerCbQuery("✅ Status updated!");

    // console.log("-----------------------")
    // console.log(groups[groupId])

    // todo add timeouts

    clearTimeout(memberTimeout[userId]);
    memberTimeout[userId] = setTimeout(() => {
        delete memberTimeout[userId];
        updateDmAdvancedMessage(
            ctx,
            userId,
            memberActionableMessages,
            groupId,
            groups
        );
        updateDmDateMessage(ctx, groups, groupId, availabilityMap, userId);
        updateGroupMessage(ctx, groups, groupId, memberNameMap);
    }, 1000);
};

bot.on("text", (ctx) => {
    // listener, only activate if 1) is DM, 2) userId in memberInputCustomMessage
    const userId = ctx.chat.id;

    if (ctx.chat.type === "private" && memberInputCustomMessage[ctx.chat.id]) {
        // todo - add sanitization and checks
        ctx.deleteMessage();
        const sanitizedMessage = sanitizeHtml(
            ctx.message.text,
            sanitizeOptions
        ).trim();
        if (sanitizedMessage.length > 64) {
            return sendErrorMessage(
                ctx,
                `Custom message too long! Maximum of 64 characters allowed. Please try again.`
            );
        }

        if (sanitizedMessage.length === 0) {
            return sendErrorMessage(
                ctx,
                `Custom message cannot be empty! Please try again.`
            );
        }
        const groupId = memberToGroupMap[userId];

        if (!groups[groupId]) {
            // no group linked - the calendar could have been stopped?

            sendErrorMessage(
                ctx,
                `❗️ Error: No running calendar found!\n\nCheck if the calendar in the group has been stopped.`
            );
            delete memberInputCustomMessage[userId];
            delete memberActionableMessages[userId].custom_prompt;
            return;
        }

        const date = memberInputCustomMessage[userId].date;

        if (
            sanitizedMessage === groups[groupId].scheduleByMember[userId][date]
        ) {
            return sendErrorMessage(
                ctx,
                `New custom message cannot be the same as the old one!`
            );
        }

        sendAutoDeleteMessage(
            ctx,
            `Your custom message for ${formatDate(
                date
            )} has been received.\n\n${sanitizedMessage}`,
            5000
        );

        ctx.telegram.deleteMessage(
            userId,
            memberInputCustomMessage[userId].messageId
        );

        delete memberInputCustomMessage[userId];
        delete memberActionableMessages[userId].custom_prompt;
        if (!groupId) return sendErrorMessage(ctx, `❗️ Error: no linked group!`);

        groups[groupId].scheduleByMember[userId][date] = sanitizedMessage;
        groups[groupId].scheduleByDate[date][userId] = sanitizedMessage;

        updateDmAdvancedMessage(
            ctx,
            userId,
            memberActionableMessages,
            groupId,
            groups
        );
        updateDmDateMessage(ctx, groups, groupId, availabilityMap, userId);
        updateGroupMessage(ctx, groups, groupId, memberNameMap);
    }
});

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

const updateGroupMessage = (ctx, groups, linkedGroupId, memberNameMap) => {
    const { start, end } = groups[linkedGroupId].dates;

    // edit message in group - let everyone know
    let updatedMessage =
        `Gathering availability information for\n🗓 <b><u>${formatDate(
            start
        )}</u></b> to <b><u>${formatDate(
            end
        )}</u></b> 🗓\n\nMembers, please indicate your available dates by clicking on the button below.\n\n⏹ @${
            groups[linkedGroupId].creator.username
        }: Type /stop when you are done collecting info.\n\n` +
        listOfPeopleFormatGenerator(
            groups[linkedGroupId].scheduleByDate,
            memberNameMap,
            10 // TODO
        ) +
        `👥 Responses: ${
            Object.keys(groups[linkedGroupId].scheduleByMember).length
        }`;
    ctx.telegram
        .editMessageText(
            groups[linkedGroupId].info_message.chat.id,
            groups[linkedGroupId].info_message.message_id,

            null,
            updatedMessage,

            {
                reply_markup: groups[linkedGroupId].info_message.reply_markup,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }
        )
        .catch((e) => editErrorHandler(e, ctx));
};

const updateDmDateMessage = (
    ctx,
    groups,
    linkedGroupId,
    availabilityMap,

    userId
) => {
    const { start, end } = groups[linkedGroupId].dates;

    let message = `🗓 <i>Indicating dates for <b><u>${
        groupNameMap[linkedGroupId]
    }</u></b></i>\n\nHello! @${
        groups[linkedGroupId].creator.username
    } requests that you indicate your available dates from <b><u>${formatDate(
        start
    )}</u></b> to <b><u>${formatDate(end)}</u></b>.${selectDatesExplainerText}`;
    for (let date of Object.keys(
        groups[linkedGroupId].scheduleByMember[userId]
    ).sort((a, b) => new Date(a) - new Date(b))) {
        message += `${formatDate(date)} ${availabilityMap(
            groups[linkedGroupId].scheduleByMember[userId][date]
        )}\n`;
    }

    // message += selectedDatesGenerator(
    //     Object.keys(groups[linkedGroupId].scheduleByMember[userId])
    // );

    // edit message in DM - let the user know their availability

    ctx.telegram
        .editMessageText(
            ctx.chat.id,
            memberActionableMessages[ctx.chat.id].select_dates.message_id,
            null,
            message,
            {
                reply_markup:
                    memberActionableMessages[ctx.chat.id].select_dates
                        .reply_markup,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            }
        )
        .catch((e) => editErrorHandler(e, ctx));
};

const updateDmAdvancedMessage = (
    ctx,
    userId,
    memberActionableMessages,
    groupId,
    groups
) => {
    // Update the advanced text message
    const advancedMarkup = advancedMarkupGenerator(userId, groupId, groups);
    if (!advancedMarkup)
        return sendErrorMessage(ctx, `Please select a date first!`);

    ctx.telegram
        .editMessageText(
            userId,
            memberActionableMessages[userId].advanced.message_id,
            null,
            memberActionableMessages[userId].advanced.text,
            {
                reply_markup: {
                    inline_keyboard: advancedMarkup,
                },
                entities: memberActionableMessages[userId].advanced.entities,
            }
        )
        .catch((e) => editErrorHandler(e, ctx));
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

            let numberAttending = keyFilterByProperty(scheduleByDate[date], [
                1,
            ]).length; // returns array of ids where the person is attending the whole
            let numberAttendingDay = keyFilterByProperty(
                scheduleByDate[date],
                [1, 2]
            ).length; // returns ids of persons attending either whole or day
            let numberAttendingNight = keyFilterByProperty(
                scheduleByDate[date],
                [1, 3]
            ).length; // returns ids of persons attending either whole or night

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
            let finalPercent = Math.max(
                percentAttendingDay,
                percentAttendingNight,
                percentAttending
            );

            if (finalPercent === 100) text += "😄";
            else if (finalPercent >= 75) text += "😀";
            else if (finalPercent >= 50) text += "🙂";

            text += "\n";

            for (let userId in scheduleByDate[date]) {
                text += `<a href='t.me/${memberNameMap[userId].username}'>${
                    memberNameMap[userId].name
                }</a> ${availabilityMap(scheduleByDate[date][userId])}\n`;
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
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

process.on("uncaughtException", console.log)
process.on("unhandledRejection", console.log)
process.on("warning", console.log)
process.on("error", console.log)